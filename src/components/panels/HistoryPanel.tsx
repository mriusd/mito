import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchWalletPositions } from '../../api';
import type { WalletPosition } from '../../api';
import { useAppStore } from '../../stores/appStore';
import { useMarketLookupSnapshot } from '../../hooks/useMarketLookupSnapshot';
import { useTradingWalletAddress } from '../../hooks/useTradingWalletAddress';
import {
  refreshSidebarOnchainWallet,
  useSidebarOnchainWalletHistory,
  useSidebarOnchainWalletHistoryHydrated,
} from '../../lib/sidebarOnchainTradesStore';
import type { Market } from '../../types';
import {
  WalletLatestMarketsTradedTable,
  buildMarketByIdRecord,
  sortWalletPositionsByDisplayedDateDesc,
  walletNetInventorySidebarOutcome,
} from '../WalletLatestMarketsTradedTable';

export function HistoryPanel() {
  const tradingWallet = useTradingWalletAddress();
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const marketLookup = useMarketLookupSnapshot();
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const wsHistory = useSidebarOnchainWalletHistory();
  const wsHistoryHydrated = useSidebarOnchainWalletHistoryHydrated();
  const onchainMode = liveTradesSource === 'onchain';

  const [restMarkets, setRestMarkets] = useState<WalletPosition[]>([]);
  const [restLoading, setRestLoading] = useState(false);
  const [refreshBump, setRefreshBump] = useState(0);
  const loadEpochRef = useRef(0);
  const tradingWalletKey = tradingWallet.trim().toLowerCase();

  const marketById = useMemo(() => buildMarketByIdRecord(marketLookup), [marketLookup]);

  useLayoutEffect(() => {
    loadEpochRef.current += 1;
    setRestMarkets([]);
    setRestLoading(false);
  }, [tradingWalletKey]);

  const loadRest = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading !== false;
    const w = tradingWalletKey;
    const epochAtStart = loadEpochRef.current;
    if (!w) {
      setRestMarkets([]);
      return;
    }
    if (showLoading) setRestLoading(true);
    try {
      const byId = buildMarketByIdRecord(useAppStore.getState().marketLookup);
      const p = await fetchWalletPositions({ wallet: w, limit: 1000, ledger: true, order: 'end_date_desc' });
      if (epochAtStart !== loadEpochRef.current) return;
      setRestMarkets(sortWalletPositionsByDisplayedDateDesc(p.positions || [], byId));
    } catch {
      if (epochAtStart !== loadEpochRef.current) return;
      setRestMarkets([]);
    } finally {
      if (showLoading && epochAtStart === loadEpochRef.current) setRestLoading(false);
    }
  }, [tradingWalletKey]);

  useEffect(() => {
    if (onchainMode) return;
    void loadRest();
  }, [onchainMode, loadRest, refreshBump]);

  useEffect(() => {
    if (!onchainMode || !tradingWalletKey) return;
    refreshSidebarOnchainWallet();
  }, [onchainMode, tradingWalletKey]);

  const markets = useMemo(() => {
    if (!onchainMode) return restMarkets;
    return sortWalletPositionsByDisplayedDateDesc(wsHistory, marketById);
  }, [onchainMode, restMarkets, wsHistory, marketById]);

  const loading =
    !!tradingWalletKey &&
    (onchainMode ? !wsHistoryHydrated : restLoading && markets.length === 0);

  const displayWallet = tradingWalletKey;

  const selectedMarketId = useMemo(() => {
    if (!selectedMarket) return undefined;
    return (selectedMarket.conditionId || selectedMarket.id || '').trim() || undefined;
  }, [selectedMarket?.conditionId, selectedMarket?.id]);

  const onHistoryRowClick = useCallback(
    (marketId: string) => {
      const mid = marketId.trim();
      if (!mid) return;
      const lc = mid.toLowerCase();
      const market = marketById[mid] || marketById[lc];
      if (!market) return;
      const row = markets.find((m) => {
        const rid = String(m.marketId || '').trim();
        return rid === mid || rid.toLowerCase() === lc;
      });
      const side = walletNetInventorySidebarOutcome(row);
      setSelectedMarket(market as Market);
      if (side) setSidebarOutcome(side);
      setSidebarOpen(true);
    },
    [marketById, markets, setSelectedMarket, setSidebarOutcome, setSidebarOpen],
  );

  const onRefresh = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onchainMode) {
        refreshSidebarOnchainWallet();
        return;
      }
      setRefreshBump((b) => b + 1);
    },
    [onchainMode],
  );

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0">
      <div className="panel-header flex items-center justify-between gap-2 mb-2 cursor-grab flex-wrap shrink-0">
        <span className="text-xs font-semibold text-white">History</span>
        <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
          {displayWallet ? (
            <span className="text-[10px] font-mono text-gray-400 truncate max-w-[min(100%,14rem)]" title={displayWallet}>
              {displayWallet}
            </span>
          ) : (
            <span className="text-[10px] text-amber-500/90">No trading wallet</span>
          )}
          {onchainMode ? (
            <span className="text-[9px] font-bold text-purple-300/90 shrink-0" title="Live via walletHistory WS">
              CHAIN
            </span>
          ) : null}
          <button
            type="button"
            className="shrink-0 p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700 disabled:opacity-40"
            title="Refresh"
            aria-label="Refresh wallet markets"
            disabled={!tradingWalletKey || loading}
            onClick={onRefresh}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="panel-body text-[10px] flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded border border-gray-700/80 bg-gray-900/50 p-1.5">
          <WalletLatestMarketsTradedTable
            markets={markets}
            marketById={marketById}
            loading={loading}
            horizontalCellPadding
            stickyHeader
            selectedMarketId={selectedMarketId}
            onRowClick={onHistoryRowClick}
          />
        </div>
      </div>
    </div>
  );
}
