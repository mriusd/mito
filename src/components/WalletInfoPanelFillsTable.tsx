import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { OnchainFillRow } from '../api';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';
import {
  getOnchainTradesWSShared,
  getWalletMarketPendingStoreRevision,
  getWalletMarketPendingTrades,
  OnchainTradesWSBridge,
  subscribeWalletMarketPendingStore,
  useWalletMarketTradesWS,
} from '../hooks/useOnchainTradesWS';
import { exportWalletFillsCsv } from '../lib/walletInfoCsvExport';
import { mergeWalletInfoPendingTrades } from '../lib/walletInfoPendingTrades';
import { useSidebarOnchainLiveTrades } from '../lib/sidebarOnchainTradesStore';
import { fmtIntEn, wsTradeToFillRow } from '../lib/walletInfoFillRows';
import { capWalletInfoFills } from './WalletInfoFillRow';
import { WalletInfoFillsVirtualTable } from './WalletInfoFillsVirtualTable';

export const WalletInfoPanelFillsTable = memo(function WalletInfoPanelFillsTable({
  open,
  wallet,
  selectedMarketId,
  marketById,
  fillsRefreshToken,
  showPendingTrades = false,
  onLoadingFillsChange,
}: {
  open: boolean;
  wallet: string;
  selectedMarketId: string;
  marketById: Record<string, Market>;
  fillsRefreshToken: number;
  showPendingTrades?: boolean;
  onLoadingFillsChange?: (loading: boolean) => void;
}) {
  const enabled = open && !!wallet && !!selectedMarketId.trim();
  const needsOwnOnchainWs = enabled && getOnchainTradesWSShared() == null;
  const {
    trades: wsMarketTrades,
    loading: loadingFills,
    refresh: refreshMarketTradesWS,
  } = useWalletMarketTradesWS(wallet, selectedMarketId, enabled);
  const pendingStoreRev = useSyncExternalStore(
    subscribeWalletMarketPendingStore,
    getWalletMarketPendingStoreRevision,
    getWalletMarketPendingStoreRevision,
  );
  const onchainTape = useSidebarOnchainLiveTrades();
  const defaultMarket = marketById[selectedMarketId];
  const scopePending = useMemo(
    () => getWalletMarketPendingTrades(wallet, selectedMarketId),
    [wallet, selectedMarketId, pendingStoreRev],
  );
  const pendingCountRef = useRef(0);
  const fills = useMemo(() => {
    const rows = showPendingTrades
      ? mergeWalletInfoPendingTrades(wsMarketTrades, onchainTape, scopePending, wallet, defaultMarket)
      : wsMarketTrades.filter((t) => !t.pending);
    return rows.map((t) => wsTradeToFillRow(t, wallet, selectedMarketId));
  }, [wsMarketTrades, onchainTape, scopePending, wallet, selectedMarketId, showPendingTrades, defaultMarket]);
  const pendingCount = useMemo(() => fills.filter((f) => f.pending).length, [fills]);
  const visibleFills = useMemo(() => capWalletInfoFills(fills), [fills]);
  const scrollBump = pendingCount > pendingCountRef.current ? pendingCount : 0;
  pendingCountRef.current = pendingCount;

  useEffect(() => {
    onLoadingFillsChange?.(enabled && loadingFills);
  }, [enabled, loadingFills, onLoadingFillsChange]);

  useEffect(() => {
    if (!enabled) return;
    refreshMarketTradesWS();
  }, [enabled, wallet, selectedMarketId, fillsRefreshToken, refreshMarketTradesWS]);

  const onExportCsv = useCallback(() => {
    exportWalletFillsCsv(wallet, fills, useAppStore.getState().marketLookup, selectedMarketId);
  }, [wallet, fills, selectedMarketId]);

  return (
    <>
      {needsOwnOnchainWs ? (
        <OnchainTradesWSBridge wallet={wallet} marketId={selectedMarketId} active />
      ) : null}
      <div className="flex items-center justify-end gap-2 mb-1 shrink-0 min-w-0">
        <button
          type="button"
          className="text-[10px] text-blue-400 hover:underline shrink-0 disabled:opacity-40 disabled:pointer-events-none"
          disabled={loadingFills || fills.length === 0 || !selectedMarketId}
          onClick={onExportCsv}
        >
          Export CSV
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden min-w-0">
        <WalletInfoFillsVirtualTable
          fills={visibleFills}
          wallet={wallet}
          marketById={marketById}
          defaultMarket={defaultMarket}
          loading={loadingFills && fills.length === 0}
          empty={!loadingFills && visibleFills.length === 0}
          scrollResetKey={`${wallet}:${selectedMarketId}:${scrollBump}`}
        />
        <div className="mt-2 text-[10px] text-gray-400 shrink-0 pt-1 border-t border-gray-800">
          <span>{fmtIntEn(visibleFills.length)} shown (live WS)</span>
        </div>
      </div>
    </>
  );
});
