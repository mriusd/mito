import { memo, useMemo } from 'react';
import type { Market } from '../types';
import { findToxicFlowWalletPosition, marketConditionKeysEqual } from '../lib/toxicFlowWs';
import { useSidebarToxicFlowData } from '../lib/sidebarToxicFlowStore';
import { WalletSelectedMarketPositionStrip } from './WalletLatestMarketsTradedTable';
import type { WalletPosition } from '../api';
import { resolveWalletInfoMarketPosition } from '../lib/walletInfoChartMarket';

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

  const selectedMarketPosition = useMemo(
    () => resolveWalletInfoMarketPosition(wallet, selectedMarketId, markets, toxicFlowData, toxicFlowMarketId),
    [markets, selectedMarketId, toxicFlowData, toxicFlowMarketId, wallet],
  );

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
