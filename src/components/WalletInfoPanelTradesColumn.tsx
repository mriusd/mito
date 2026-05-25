import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useWalletMarketTradesWS } from '../hooks/useOnchainTradesWS';
import { exportWalletFillsCsv } from '../lib/walletInfoCsvExport';
import { wsTradeToFillRow } from '../lib/walletInfoFillRows';
import type { Market } from '../types';
import type { WalletPosition } from '../api';
import { resolveWalletInfoChartMarket } from '../lib/walletInfoChartMarket';
import { WalletInfoPanelLiveChart } from './WalletInfoPanelLiveChart';
import { WalletInfoPanelFillsTable } from './WalletInfoPanelFillsTable';
import { WalletInfoToxicPositionStripHost } from './WalletInfoToxicPositionStripHost';

export const WalletInfoPanelTradesColumn = memo(function WalletInfoPanelTradesColumn({
  open,
  wallet,
  selectedMarketId,
  marketById,
  markets,
  toxicFlowMarketId,
  fillsRefreshToken,
  onLoadingFillsChange,
}: {
  open: boolean;
  wallet: string;
  selectedMarketId: string;
  marketById: Record<string, Market>;
  markets: WalletPosition[];
  toxicFlowMarketId: string;
  fillsRefreshToken: number;
  onLoadingFillsChange?: (loading: boolean) => void;
}) {
  const enabled = open && !!wallet && !!selectedMarketId.trim();
  const {
    trades: wsMarketTrades,
    loading: loadingFills,
    refresh: refreshMarketTradesWS,
  } = useWalletMarketTradesWS(wallet, selectedMarketId, enabled);
  const fills = useMemo(
    () => wsMarketTrades.map((t) => wsTradeToFillRow(t, wallet, selectedMarketId)),
    [wsMarketTrades, wallet, selectedMarketId],
  );

  useEffect(() => {
    onLoadingFillsChange?.(enabled && loadingFills);
  }, [enabled, loadingFills, onLoadingFillsChange]);

  useEffect(() => {
    if (!enabled) return;
    refreshMarketTradesWS();
  }, [enabled, wallet, selectedMarketId, fillsRefreshToken, refreshMarketTradesWS]);

  const selectedMarketMeta = useMemo(
    () => resolveWalletInfoChartMarket(selectedMarketId, marketById, markets),
    [selectedMarketId, marketById, markets],
  );

  const onExportCsv = useCallback(() => {
    exportWalletFillsCsv(wallet, fills, useAppStore.getState().marketLookup, selectedMarketId);
  }, [wallet, fills, selectedMarketId]);

  return (
    <>
      <div className="flex items-center justify-between gap-2 mb-1 shrink-0 min-w-0">
        <div className="text-[10px] text-gray-400 font-bold min-w-0 truncate">
          Trades For Selected Market{' '}
          {selectedMarketId ? <span className="text-gray-500">({selectedMarketId})</span> : null}
        </div>
        <button
          type="button"
          className="text-[10px] text-blue-400 hover:underline shrink-0 disabled:opacity-40 disabled:pointer-events-none"
          disabled={loadingFills || fills.length === 0 || !selectedMarketId}
          onClick={onExportCsv}
        >
          Export CSV
        </button>
      </div>
      <WalletInfoPanelLiveChart
        open={open}
        selectedMarketId={selectedMarketId}
        selectedMarketMeta={selectedMarketMeta}
        ledgerFillsForMarkers={fills}
      />
      <WalletInfoToxicPositionStripHost
        wallet={wallet}
        selectedMarketId={selectedMarketId}
        marketById={marketById}
        markets={markets}
        toxicFlowMarketId={toxicFlowMarketId}
      />
      <WalletInfoPanelFillsTable
        open={open}
        wallet={wallet}
        selectedMarketId={selectedMarketId}
        marketById={marketById}
        fills={fills}
        loadingFills={loadingFills}
      />
    </>
  );
});
