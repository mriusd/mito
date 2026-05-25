import { memo, useMemo } from 'react';
import type { WalletPosition } from '../api';
import { findToxicFlowWalletPosition, marketConditionKeysEqual } from '../lib/toxicFlowWs';
import { useSidebarToxicFlowData } from '../lib/sidebarToxicFlowStore';
import { WalletSelectedMarketPositionStrip } from './WalletLatestMarketsTradedTable';
import type { Market } from '../types';

export const WalletInfoToxicPositionStripHost = memo(function WalletInfoToxicPositionStripHost({
  wallet,
  selectedMarketId,
  marketById,
  markets,
  toxicFlowMarketId,
}: {
  wallet: string;
  selectedMarketId: string;
  marketById: Record<string, Market>;
  markets: WalletPosition[];
  toxicFlowMarketId: string;
}) {
  const toxicFlowData = useSidebarToxicFlowData();

  const selectedMarketPosition = useMemo(() => {
    const raw = selectedMarketId.trim();
    if (!raw) return null;
    const toxicMkt = String(toxicFlowData?.marketId || toxicFlowMarketId || '').trim();
    if (toxicFlowData && toxicMkt && marketConditionKeysEqual(toxicMkt, raw)) {
      const live = findToxicFlowWalletPosition(toxicFlowData, wallet);
      if (live) return live;
    }
    return (
      markets.find((row) => marketConditionKeysEqual(String(row.marketId || ''), raw)) ??
      markets.find((row) => String(row.marketId || '').trim().toLowerCase() === raw.toLowerCase()) ??
      null
    );
  }, [markets, selectedMarketId, toxicFlowData, toxicFlowMarketId, wallet]);

  const toxicMarketMatchesSelected = useMemo(() => {
    const raw = selectedMarketId.trim();
    const toxicMkt = String(toxicFlowData?.marketId || toxicFlowMarketId || '').trim();
    return !!(raw && toxicMkt && marketConditionKeysEqual(toxicMkt, raw));
  }, [selectedMarketId, toxicFlowData, toxicFlowMarketId]);

  return (
    <WalletSelectedMarketPositionStrip
      position={selectedMarketPosition}
      marketId={selectedMarketId}
      marketById={marketById}
      stakedDisplay={toxicMarketMatchesSelected ? 'stakedNet' : 'usdcIn'}
    />
  );
});
