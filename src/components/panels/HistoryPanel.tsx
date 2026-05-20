import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchWalletPositions } from '../../api';
import type { WalletPosition } from '../../api';
import { useAppStore } from '../../stores/appStore';
import { useMarketLookupSnapshot } from '../../hooks/useMarketLookupSnapshot';
import { useTradingWalletAddress } from '../../hooks/useTradingWalletAddress';
import {
  WalletLatestMarketsTradedTable,
  buildMarketByIdRecord,
  sortWalletPositionsByDisplayedDateDesc,
} from '../WalletLatestMarketsTradedTable';
import { lazyWithChunkReload } from '../../utils/lazyWithChunkReload';

const WalletInfoDialogLazy = lazyWithChunkReload(() =>
  import('../ToxicFlowDialog').then((m) => ({ default: m.WalletInfoDialog })),
);

const HISTORY_PANEL_REFRESH_MS = 30_000;

export function HistoryPanel() {
  const tradingWallet = useTradingWalletAddress();
  const marketLookup = useMarketLookupSnapshot();
  const [markets, setMarkets] = useState<WalletPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshBump, setRefreshBump] = useState(0);
  const [walletInfoOpen, setWalletInfoOpen] = useState(false);
  const [walletInfoMarketId, setWalletInfoMarketId] = useState('');
  const loadEpochRef = useRef(0);
  const tradingWalletKey = tradingWallet.trim().toLowerCase();

  const marketById = useMemo(() => buildMarketByIdRecord(marketLookup), [marketLookup]);

  useLayoutEffect(() => {
    loadEpochRef.current += 1;
    setMarkets([]);
    setLoading(Boolean(tradingWalletKey));
    setWalletInfoOpen(false);
    setWalletInfoMarketId('');
  }, [tradingWalletKey]);

  const load = useCallback(async (options?: { showLoading?: boolean }) => {
    const showLoading = options?.showLoading !== false;
    const w = tradingWalletKey;
    const epochAtStart = loadEpochRef.current;
    if (!w) {
      setMarkets([]);
      return;
    }
    if (showLoading) setLoading(true);
    try {
      const byId = buildMarketByIdRecord(useAppStore.getState().marketLookup);
      const p = await fetchWalletPositions({ wallet: w, limit: 1000, ledger: true, order: 'end_date_desc' });
      if (epochAtStart !== loadEpochRef.current) return;
      const sorted = sortWalletPositionsByDisplayedDateDesc(p.positions || [], byId);
      setMarkets(sorted);
    } catch {
      if (epochAtStart !== loadEpochRef.current) return;
      setMarkets([]);
    } finally {
      if (showLoading && epochAtStart === loadEpochRef.current) setLoading(false);
    }
  }, [tradingWalletKey]);

  useEffect(() => {
    void load();
  }, [load, refreshBump]);

  useEffect(() => {
    if (!tradingWalletKey) return;
    const id = window.setInterval(() => {
      void load({ showLoading: false });
    }, HISTORY_PANEL_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [tradingWalletKey, load]);

  const displayWallet = tradingWalletKey;

  const onHistoryRowClick = useCallback(
    (marketId: string) => {
      if (!displayWallet || !marketId.trim()) return;
      setWalletInfoMarketId(marketId.trim());
      setWalletInfoOpen(true);
    },
    [displayWallet],
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
          <button
            type="button"
            className="shrink-0 p-1 rounded text-gray-500 hover:text-white hover:bg-gray-700 disabled:opacity-40"
            title="Refresh"
            aria-label="Refresh wallet markets"
            disabled={!tradingWalletKey || loading}
            onClick={(e) => {
              e.stopPropagation();
              setRefreshBump((b) => b + 1);
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="panel-body text-[10px] flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="text-[10px] text-gray-500 mb-1 shrink-0">Latest Markets Traded</div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded border border-gray-700/80 bg-gray-900/50">
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto p-1.5">
          <div className="min-h-full">
          <WalletLatestMarketsTradedTable
            markets={markets}
            marketById={marketById}
            loading={loading}
            horizontalCellPadding
            selectedMarketId={walletInfoOpen ? walletInfoMarketId : undefined}
            onRowClick={displayWallet ? onHistoryRowClick : undefined}
          />
          </div>
          </div>
        </div>
      </div>
      {walletInfoOpen && displayWallet ? (
        <Suspense fallback={null}>
          <WalletInfoDialogLazy
            open
            wallet={displayWallet}
            initialMarketId={walletInfoMarketId}
            onClose={() => {
              setWalletInfoOpen(false);
              setWalletInfoMarketId('');
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
