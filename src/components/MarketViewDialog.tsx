import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { OnchainMarketListItem } from '../api';
import { fetchMarketWalletPositions, fetchOnchainMarkets } from '../api';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';
import { MarketViewMarketsPanel, marketViewUsesGrid, MarketViewMarketsLegend } from './MarketViewMarketsPanel';
import { MarketViewColumnLoadBar } from './MarketViewColumnLoadBar';
import { MarketViewTradersTable } from './MarketViewTradersTable';
import { WalletMarketTradesSection } from './WalletMarketTradesSection';

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;
const MARKETS_PAGE_SIZE = 100;
const TRADERS_PAGE_SIZE = 100;

type Asset = (typeof ASSETS)[number];
type Timeframe = (typeof TIMEFRAMES)[number];

function onchainMarketToMarket(m: OnchainMarketListItem): Market {
  const id = (m.conditionId || '').trim();
  return {
    id,
    conditionId: id,
    question: (m.question || '').trim() || id,
    endDate: (m.endDate || '').trim(),
    eventSlug: m.eventSlug,
    clobTokenIds: [],
  };
}

function marketEndMs(m: OnchainMarketListItem): number {
  const t = Date.parse((m.endDate || '').trim());
  return Number.isNaN(t) ? 0 : t;
}

function mergeMarketsById(...groups: OnchainMarketListItem[][]): OnchainMarketListItem[] {
  const byId = new Map<string, OnchainMarketListItem>();
  for (const group of groups) {
    for (const m of group) {
      const id = (m.conditionId || '').trim().toLowerCase();
      if (id) byId.set(id, m);
    }
  }
  return Array.from(byId.values());
}

export function MarketViewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openWalletInfoOverlay = useAppStore((s) => s.openWalletInfoOverlay);
  const [draftAsset, setDraftAsset] = useState<Asset>('BTC');
  const [draftTimeframe, setDraftTimeframe] = useState<Timeframe>('5m');
  const [loadedAsset, setLoadedAsset] = useState<Asset | null>(null);
  const [loadedTimeframe, setLoadedTimeframe] = useState<Timeframe | null>(null);

  const [loadedMarkets, setLoadedMarkets] = useState<OnchainMarketListItem[]>([]);
  const [marketsOffset, setMarketsOffset] = useState(0);
  const [marketsTotal, setMarketsTotal] = useState(-1);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [loadingMoreMarkets, setLoadingMoreMarkets] = useState(false);
  const [marketsError, setMarketsError] = useState('');
  const [marketsLoadSeq, setMarketsLoadSeq] = useState(0);

  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [traders, setTraders] = useState<Awaited<ReturnType<typeof fetchMarketWalletPositions>>['positions']>([]);
  const [tradersOffset, setTradersOffset] = useState(0);
  const [tradersTotal, setTradersTotal] = useState(-1);
  const [tradersPnlOrder, setTradersPnlOrder] = useState<'asc' | 'desc'>('desc');
  const [loadingTraders, setLoadingTraders] = useState(false);
  const [tradersError, setTradersError] = useState('');
  const [loadingTrades, setLoadingTrades] = useState(false);

  const selectedMarket = useMemo(() => {
    if (!selectedMarketId) return null;
    const lc = selectedMarketId.trim().toLowerCase();
    const row =
      loadedMarkets.find((m) => (m.conditionId || '').trim().toLowerCase() === lc) ||
      loadedMarkets.find((m) => m.conditionId === selectedMarketId) ||
      null;
    return row ? onchainMarketToMarket(row) : null;
  }, [loadedMarkets, selectedMarketId]);

  const hasMoreMarkets = marketsTotal >= 0 && marketsOffset < marketsTotal;

  const loadMarketsPage = useCallback(
    async (asset: Asset, timeframe: Timeframe, offset: number, append: boolean) => {
      const useGrid = marketViewUsesGrid(timeframe);
      if (useGrid) {
        const expiredData = await fetchOnchainMarkets({
          asset,
          timeframe,
          expired_only: true,
          limit: MARKETS_PAGE_SIZE,
          offset,
        });
        const expiredBatch = expiredData.markets ?? [];
        setMarketsTotal(expiredData.total);
        setMarketsOffset(offset + (expiredData.count ?? expiredBatch.length));
        if (append) {
          setLoadedMarkets((prev) => mergeMarketsById(prev, expiredBatch));
          return;
        }
        const openData = await fetchOnchainMarkets({
          asset,
          timeframe,
          expired_only: false,
          limit: MARKETS_PAGE_SIZE,
          offset: 0,
        });
        const now = Date.now();
        const openBatch = (openData.markets ?? []).filter((m) => marketEndMs(m) > now);
        setLoadedMarkets(mergeMarketsById(openBatch, expiredBatch));
        return;
      }

      const data = await fetchOnchainMarkets({
        asset,
        timeframe,
        expired_only: true,
        limit: MARKETS_PAGE_SIZE,
        offset,
      });
      setMarketsTotal(data.total);
      setMarketsOffset(offset + (data.count ?? 0));
      setLoadedMarkets((prev) => (append ? [...prev, ...(data.markets ?? [])] : (data.markets ?? [])));
    },
    [],
  );

  const onLoad = useCallback(() => {
    setLoadedAsset(draftAsset);
    setLoadedTimeframe(draftTimeframe);
    setMarketsError('');
    setLoadedMarkets([]);
    setMarketsOffset(0);
    setMarketsTotal(-1);
    setMarketsLoadSeq((n) => n + 1);
  }, [draftAsset, draftTimeframe]);

  useEffect(() => {
    if (!open) {
      setSelectedMarketId(null);
      setSelectedWallet(null);
      setTraders([]);
      setTradersError('');
      setTradersOffset(0);
      setTradersTotal(-1);
      setTradersPnlOrder('desc');
      setLoadingTraders(false);
      setLoadedMarkets([]);
      setMarketsOffset(0);
      setMarketsTotal(-1);
      setLoadingMarkets(false);
      setLoadingMoreMarkets(false);
      setMarketsError('');
      setLoadingTrades(false);
      setMarketsLoadSeq(0);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !loadedAsset || !loadedTimeframe) {
      setLoadedMarkets([]);
      setMarketsOffset(0);
      setMarketsTotal(-1);
      setLoadingMarkets(false);
      setMarketsError('');
      return;
    }
    let cancelled = false;
    setLoadingMarkets(true);
    setMarketsError('');
    void loadMarketsPage(loadedAsset, loadedTimeframe, 0, false)
      .catch((e) => {
        if (cancelled) return;
        setLoadedMarkets([]);
        setMarketsError(e instanceof Error ? e.message : 'Failed to load markets');
      })
      .finally(() => {
        if (!cancelled) setLoadingMarkets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, loadedAsset, loadedTimeframe, marketsLoadSeq, loadMarketsPage]);

  const onLoadMoreMarkets = useCallback(() => {
    if (!loadedAsset || !loadedTimeframe || loadingMoreMarkets || loadingMarkets || !hasMoreMarkets) return;
    setLoadingMoreMarkets(true);
    setMarketsError('');
    void loadMarketsPage(loadedAsset, loadedTimeframe, marketsOffset, true)
      .catch((e) => {
        setMarketsError(e instanceof Error ? e.message : 'Failed to load more markets');
      })
      .finally(() => {
        setLoadingMoreMarkets(false);
      });
  }, [
    loadedAsset,
    loadedTimeframe,
    loadingMoreMarkets,
    loadingMarkets,
    hasMoreMarkets,
    marketsOffset,
    loadMarketsPage,
  ]);

  useEffect(() => {
    if (!open || !selectedMarketId) {
      setTraders([]);
      setTradersError('');
      setTradersOffset(0);
      setTradersTotal(-1);
      setTradersPnlOrder('desc');
      setLoadingTraders(false);
      return;
    }
    let cancelled = false;
    setLoadingTraders(true);
    setTradersError('');
    void fetchMarketWalletPositions({
      market_id: selectedMarketId,
      limit: TRADERS_PAGE_SIZE,
      offset: tradersOffset,
      sort: 'pnl',
      order: tradersPnlOrder,
    })
      .then((data) => {
        if (cancelled) return;
        setTraders(data.positions ?? []);
        setTradersTotal(data.total ?? -1);
      })
      .catch((e) => {
        if (cancelled) return;
        setTraders([]);
        setTradersTotal(-1);
        setTradersError(e instanceof Error ? e.message : 'Failed to load traders');
      })
      .finally(() => {
        if (!cancelled) setLoadingTraders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedMarketId, tradersOffset, tradersPnlOrder]);

  const onSelectTraderRow = useCallback((wallet: string) => {
    const addr = wallet.trim();
    if (!addr) return;
    setSelectedWallet(addr);
  }, []);

  const onOpenTraderWallet = useCallback(
    (wallet: string) => {
      const addr = wallet.trim();
      if (!addr) return;
      setSelectedWallet(addr);
      openWalletInfoOverlay(addr, selectedMarketId?.trim() || '');
    },
    [openWalletInfoOverlay, selectedMarketId],
  );

  const beginTradersLoad = useCallback(() => {
    setTraders([]);
    setTradersError('');
    setLoadingTraders(true);
  }, []);

  const onSelectMarket = useCallback(
    (id: string) => {
      setSelectedMarketId(id);
      setTradersTotal(-1);
      setTradersOffset(0);
      setTradersPnlOrder('desc');
      setSelectedWallet(null);
      beginTradersLoad();
    },
    [beginTradersLoad],
  );

  const tradersLastOffset = useMemo(() => {
    if (tradersTotal < 0) return 0;
    return Math.max(0, Math.floor((tradersTotal - 1) / TRADERS_PAGE_SIZE) * TRADERS_PAGE_SIZE);
  }, [tradersTotal]);

  const selectedTrader = useMemo(() => {
    if (!selectedWallet) return null;
    const lc = selectedWallet.trim().toLowerCase();
    return traders.find((t) => (t.wallet || '').trim().toLowerCase() === lc) ?? null;
  }, [traders, selectedWallet]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60020] bg-black/60 flex items-center justify-center p-2"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl flex flex-col w-[80vw] max-w-[80vw] h-[88vh] min-h-[88vh] max-h-[88vh] overflow-hidden">
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-700 bg-gray-900/80">
          <div className="text-sm font-bold text-yellow-400 mr-2">Market View</div>
          <label className="flex items-center gap-1 text-[10px] text-gray-400">
            Asset
            <select
              className="bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-[11px] text-white"
              value={draftAsset}
              onChange={(e) => setDraftAsset(e.target.value as Asset)}
            >
              {ASSETS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[10px] text-gray-400">
            Timeframe
            <select
              className="bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-[11px] text-white"
              value={draftTimeframe}
              onChange={(e) => setDraftTimeframe(e.target.value as Timeframe)}
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded bg-blue-600 hover:bg-blue-500 px-2.5 py-0.5 text-[11px] font-bold text-white"
            onClick={onLoad}
          >
            Load
          </button>
          {loadedAsset && loadedTimeframe ? (
            <span className="text-[10px] text-gray-500 ml-1">
              {loadedAsset} · {loadedTimeframe} · {loadedMarkets.length}
              {marketsTotal >= 0 ? ` / ${marketsTotal} expired` : ''}
              {marketViewUsesGrid(loadedTimeframe) ? ' (+ open)' : ''}
            </span>
          ) : null}
          <button type="button" className="ml-auto text-gray-500 hover:text-white" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-[minmax(18rem,28rem)_minmax(0,1.45fr)_minmax(0,1fr)] gap-2 p-2 overflow-hidden">
          <div className="bg-gray-900 rounded p-2 flex flex-col min-h-0 min-w-0 w-full overflow-hidden">
            <div className="text-[10px] text-gray-400 font-bold mb-0.5 shrink-0">Markets</div>
            <MarketViewColumnLoadBar active={loadingMarkets || loadingMoreMarkets} />
            {marketViewUsesGrid(loadedTimeframe ?? draftTimeframe) ? <MarketViewMarketsLegend /> : null}
            {!loadedAsset || !loadedTimeframe ? (
              <div className="flex flex-1 items-center justify-center text-gray-500 text-[10px]">
                Pick asset + timeframe, then Load.
              </div>
            ) : marketsError ? (
              <div className="flex flex-1 items-center justify-center text-red-400 text-[10px] px-2 text-center">
                {marketsError}
              </div>
            ) : loadingMarkets && loadedMarkets.length === 0 ? (
              <div className="flex flex-1 min-h-0" />
            ) : loadedMarkets.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-gray-500 text-[10px]">No expired markets.</div>
            ) : (
              <MarketViewMarketsPanel
                markets={loadedMarkets}
                timeframe={loadedTimeframe}
                selectedMarketId={selectedMarketId}
                onSelectMarket={onSelectMarket}
                hasMoreMarkets={hasMoreMarkets}
                loadingMoreMarkets={loadingMoreMarkets}
                onLoadMoreMarkets={onLoadMoreMarkets}
              />
            )}
          </div>

          <div className="bg-gray-900 rounded p-2 flex flex-col min-h-0 min-w-0 overflow-hidden">
            <div className="text-[10px] text-gray-400 font-bold mb-0.5 shrink-0">Traders</div>
            <MarketViewColumnLoadBar active={!!selectedMarketId && loadingTraders} />
            {!selectedMarketId ? (
              <div className="flex flex-1 items-center justify-center text-gray-500 text-[10px]">Select a market.</div>
            ) : tradersError ? (
              <div className="flex flex-1 items-center justify-center text-red-400 text-[10px] px-2 text-center">
                {tradersError}
              </div>
            ) : (
              <MarketViewTradersTable
                traders={traders}
                loading={loadingTraders}
                selectedWallet={selectedWallet}
                onRowClick={onSelectTraderRow}
                onOpenWallet={onOpenTraderWallet}
                offset={tradersOffset}
                total={tradersTotal}
                pnlOrder={tradersPnlOrder}
                onPnlOrderToggle={() => {
                  beginTradersLoad();
                  setTradersOffset(0);
                  setTradersPnlOrder((o) => (o === 'desc' ? 'asc' : 'desc'));
                }}
                onFirstPage={() => {
                  if (tradersOffset === 0) return;
                  beginTradersLoad();
                  setTradersOffset(0);
                }}
                onPrevPage={() => {
                  if (tradersOffset === 0) return;
                  beginTradersLoad();
                  setTradersOffset((o) => Math.max(0, o - TRADERS_PAGE_SIZE));
                }}
                onNextPage={() => {
                  beginTradersLoad();
                  setTradersOffset((o) => o + TRADERS_PAGE_SIZE);
                }}
                onLastPage={() => {
                  if (tradersTotal < 0 || tradersOffset >= tradersLastOffset) return;
                  beginTradersLoad();
                  setTradersOffset(tradersLastOffset);
                }}
              />
            )}
          </div>

          <div className="bg-gray-900 rounded p-2 flex flex-col min-h-0 min-w-0 overflow-hidden">
            <div className="text-[10px] text-gray-400 font-bold mb-0.5 shrink-0">Trades</div>
            <MarketViewColumnLoadBar active={!!selectedMarketId && !!selectedWallet && loadingTrades} />
            {!selectedMarketId || !selectedWallet ? (
              <div className="flex flex-1 items-center justify-center text-gray-500 text-[10px]">Select a trader.</div>
            ) : (
              <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
                <WalletMarketTradesSection
                  open={open}
                  wallet={selectedWallet}
                  marketId={selectedMarketId}
                  market={selectedMarket}
                  trader={selectedTrader}
                  onLoadingChange={setLoadingTrades}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
