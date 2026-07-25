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
import { WEATHER_CITIES } from '../lib/weatherCities';
import { type WeatherMetric } from '../lib/weatherMarketsGrid';

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;
const MARKET_VIEW_MODES = ['crypto', 'weather'] as const;
const WEATHER_METRICS = ['high', 'low'] as const;
const MARKETS_PAGE_SIZE = 100;
/** Onchain weather rows per city (~hundreds); API max is 1000. */
const WEATHER_MARKETS_PAGE_SIZE = 1000;
const TRADERS_PAGE_SIZE = 100;
const MARKET_VIEW_TRADERS_SORT_COL_KEY = 'polybot-market-view-traders-sort-col';
const MARKET_VIEW_TRADERS_SORT_ORDER_KEY = 'polybot-market-view-traders-pnl-order';

export type MarketViewTradersSortCol = 'pnl' | 'staked';

function readMarketViewTradersSortCol(): MarketViewTradersSortCol {
  try {
    const v = localStorage.getItem(MARKET_VIEW_TRADERS_SORT_COL_KEY);
    if (v === 'pnl' || v === 'staked') return v;
  } catch {
    /* */
  }
  return 'pnl';
}

function persistMarketViewTradersSortCol(col: MarketViewTradersSortCol): void {
  try {
    localStorage.setItem(MARKET_VIEW_TRADERS_SORT_COL_KEY, col);
  } catch {
    /* */
  }
}

function readMarketViewTradersSortOrder(): 'asc' | 'desc' {
  try {
    const v = localStorage.getItem(MARKET_VIEW_TRADERS_SORT_ORDER_KEY);
    if (v === 'asc' || v === 'desc') return v;
  } catch {
    /* */
  }
  return 'desc';
}

function persistMarketViewTradersSortOrder(order: 'asc' | 'desc'): void {
  try {
    localStorage.setItem(MARKET_VIEW_TRADERS_SORT_ORDER_KEY, order);
  } catch {
    /* */
  }
}

type Asset = (typeof ASSETS)[number];
type Timeframe = (typeof TIMEFRAMES)[number];
type MarketViewMode = (typeof MARKET_VIEW_MODES)[number];
type LoadedTimeframe = Timeframe | 'weather';

function onchainMarketToMarket(m: OnchainMarketListItem): Market {
  const id = (m.conditionId || '').trim();
  return {
    id,
    conditionId: id,
    question: (m.question || '').trim() || id,
    endDate: (m.endDate || '').trim(),
    eventSlug: m.eventSlug,
    groupItemTitle: m.squareLabel,
    clobTokenIds: Array.isArray(m.clobTokenIds) ? m.clobTokenIds : [],
  };
}

function weatherMetricNeedle(metric: WeatherMetric): string {
  return metric === 'high' ? 'highest-temperature' : 'lowest-temperature';
}

/** Temp bucket label for Market View squares (from question, else slug). */
function weatherSquareLabelFromOnchain(m: OnchainMarketListItem): string {
  const q = (m.question || '').trim();
  let mm = q.match(/be\s+between\s+([\d.]+-[\d.]+°[CF])/i);
  if (mm) return mm[1];
  mm = q.match(/be\s+([\d.]+°[CF]\s+or\s+(?:below|higher|lower|above))/i);
  if (mm) return mm[1];
  mm = q.match(/be\s+([\d.]+°[CF])/i);
  if (mm) return mm[1];

  const slug = (m.slug || '').trim().toLowerCase();
  const tail = slug.match(/-(\d+(?:-\d+)?[cf]|[\d]+for(?:below|higher))$/i);
  if (tail) {
    const t = tail[1];
    const below = t.match(/^(\d+)forbelow$/i);
    if (below) return `${below[1]}°F or below`;
    const higher = t.match(/^(\d+)forhigher$/i);
    if (higher) return `${higher[1]}°F or higher`;
    const rangeF = t.match(/^(\d+-\d+)f$/i);
    if (rangeF) return `${rangeF[1]}°F`;
    const rangeC = t.match(/^(\d+-\d+)c$/i);
    if (rangeC) return `${rangeC[1]}°C`;
    const oneF = t.match(/^(\d+)f$/i);
    if (oneF) return `${oneF[1]}°F`;
    const oneC = t.match(/^(\d+)c$/i);
    if (oneC) return `${oneC[1]}°C`;
  }
  return '';
}

function annotateWeatherOnchainItem(m: OnchainMarketListItem): OnchainMarketListItem {
  return {
    ...m,
    timeframe: 'weather',
    squareLabel: weatherSquareLabelFromOnchain(m) || m.squareLabel,
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
  const [draftMode, setDraftMode] = useState<MarketViewMode>('crypto');
  const [draftAsset, setDraftAsset] = useState<Asset>('BTC');
  const [draftTimeframe, setDraftTimeframe] = useState<Timeframe>('5m');
  const [draftCity, setDraftCity] = useState(WEATHER_CITIES[0]?.slug ?? 'london');
  const [draftMetric, setDraftMetric] = useState<WeatherMetric>('high');
  const [loadedMode, setLoadedMode] = useState<MarketViewMode | null>(null);
  const [loadedAsset, setLoadedAsset] = useState<Asset | null>(null);
  const [loadedTimeframe, setLoadedTimeframe] = useState<LoadedTimeframe | null>(null);
  const [loadedCity, setLoadedCity] = useState<string | null>(null);
  const [loadedMetric, setLoadedMetric] = useState<WeatherMetric | null>(null);

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
  const [tradersSortCol, setTradersSortCol] = useState<MarketViewTradersSortCol>(readMarketViewTradersSortCol);
  const [tradersSortOrder, setTradersSortOrder] = useState<'asc' | 'desc'>(readMarketViewTradersSortOrder);
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

  const loadWeatherMarketsPage = useCallback(
    async (city: string, metric: WeatherMetric, offset: number, append: boolean) => {
      const needle = weatherMetricNeedle(metric);
      const data = await fetchOnchainMarkets({
        asset: city,
        expired_only: false,
        limit: WEATHER_MARKETS_PAGE_SIZE,
        offset,
      });
      const batch = (data.markets ?? [])
        .filter((m) => (m.eventSlug || '').includes(needle))
        .map(annotateWeatherOnchainItem);
      setMarketsTotal(data.total);
      setMarketsOffset(offset + (data.count ?? (data.markets ?? []).length));
      setLoadedMarkets((prev) => (append ? mergeMarketsById(prev, batch) : batch));
    },
    [],
  );

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
    setLoadedMode(draftMode);
    if (draftMode === 'weather') {
      setLoadedCity(draftCity);
      setLoadedMetric(draftMetric);
      setLoadedAsset(null);
      setLoadedTimeframe('weather');
    } else {
      setLoadedAsset(draftAsset);
      setLoadedTimeframe(draftTimeframe);
      setLoadedCity(null);
      setLoadedMetric(null);
    }
    setMarketsError('');
    setLoadedMarkets([]);
    setMarketsOffset(0);
    setMarketsTotal(-1);
    setSelectedMarketId(null);
    setSelectedWallet(null);
    setMarketsLoadSeq((n) => n + 1);
  }, [draftMode, draftAsset, draftTimeframe, draftCity, draftMetric]);

  useEffect(() => {
    if (!open) {
      setSelectedMarketId(null);
      setSelectedWallet(null);
      setTraders([]);
      setTradersError('');
      setTradersOffset(0);
      setTradersTotal(-1);
      setLoadingTraders(false);
      setLoadedMarkets([]);
      setMarketsOffset(0);
      setMarketsTotal(-1);
      setLoadingMarkets(false);
      setLoadingMoreMarkets(false);
      setMarketsError('');
      setLoadingTrades(false);
      setMarketsLoadSeq(0);
      setLoadedMode(null);
      setLoadedAsset(null);
      setLoadedTimeframe(null);
      setLoadedCity(null);
      setLoadedMetric(null);
      setDraftMode('crypto');
      setDraftAsset('BTC');
      setDraftTimeframe('5m');
      setDraftCity(WEATHER_CITIES[0]?.slug ?? 'london');
      setDraftMetric('high');
      return;
    }
    setDraftMode('crypto');
    setDraftAsset('BTC');
    setDraftTimeframe('5m');
    setLoadedMode('crypto');
    setLoadedAsset('BTC');
    setLoadedTimeframe('5m');
    setMarketsLoadSeq((n) => n + 1);
  }, [open]);

  useEffect(() => {
    if (!open || !loadedMode || !loadedTimeframe) {
      setLoadedMarkets([]);
      setMarketsOffset(0);
      setMarketsTotal(-1);
      setLoadingMarkets(false);
      setMarketsError('');
      return;
    }

    if (loadedMode === 'weather') {
      if (!loadedCity || !loadedMetric) return;
      let cancelled = false;
      setLoadingMarkets(true);
      setMarketsError('');
      void loadWeatherMarketsPage(loadedCity, loadedMetric, 0, false)
        .catch((e) => {
          if (cancelled) return;
          setLoadedMarkets([]);
          setMarketsError(e instanceof Error ? e.message : 'Failed to load weather markets');
        })
        .finally(() => {
          if (!cancelled) setLoadingMarkets(false);
        });
      return () => {
        cancelled = true;
      };
    }

    if (!loadedAsset) return;
    let cancelled = false;
    setLoadingMarkets(true);
    setMarketsError('');
    void loadMarketsPage(loadedAsset, loadedTimeframe as Timeframe, 0, false)
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
  }, [
    open,
    loadedMode,
    loadedAsset,
    loadedTimeframe,
    loadedCity,
    loadedMetric,
    marketsLoadSeq,
    loadMarketsPage,
    loadWeatherMarketsPage,
  ]);

  const onLoadMoreMarkets = useCallback(() => {
    if (loadingMoreMarkets || loadingMarkets || !hasMoreMarkets) return;
    if (loadedMode === 'weather') {
      if (!loadedCity || !loadedMetric) return;
      setLoadingMoreMarkets(true);
      setMarketsError('');
      void loadWeatherMarketsPage(loadedCity, loadedMetric, marketsOffset, true)
        .catch((e) => {
          setMarketsError(e instanceof Error ? e.message : 'Failed to load more markets');
        })
        .finally(() => {
          setLoadingMoreMarkets(false);
        });
      return;
    }
    if (!loadedAsset || !loadedTimeframe) return;
    setLoadingMoreMarkets(true);
    setMarketsError('');
    void loadMarketsPage(loadedAsset, loadedTimeframe as Timeframe, marketsOffset, true)
      .catch((e) => {
        setMarketsError(e instanceof Error ? e.message : 'Failed to load more markets');
      })
      .finally(() => {
        setLoadingMoreMarkets(false);
      });
  }, [
    loadedMode,
    loadedAsset,
    loadedTimeframe,
    loadedCity,
    loadedMetric,
    loadingMoreMarkets,
    loadingMarkets,
    hasMoreMarkets,
    marketsOffset,
    loadMarketsPage,
    loadWeatherMarketsPage,
  ]);

  useEffect(() => {
    if (!open || !selectedMarketId) {
      setTraders([]);
      setTradersError('');
      setTradersOffset(0);
      setTradersTotal(-1);
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
      sort: tradersSortCol,
      order: tradersSortOrder,
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
  }, [open, selectedMarketId, tradersOffset, tradersSortCol, tradersSortOrder]);

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

  const onTradersSortClick = useCallback(
    (col: MarketViewTradersSortCol) => {
      beginTradersLoad();
      setTradersOffset(0);
      if (tradersSortCol === col) {
        setTradersSortOrder((o) => {
          const next = o === 'desc' ? 'asc' : 'desc';
          persistMarketViewTradersSortOrder(next);
          return next;
        });
        return;
      }
      setTradersSortCol(col);
      persistMarketViewTradersSortCol(col);
      setTradersSortOrder('desc');
      persistMarketViewTradersSortOrder('desc');
    },
    [beginTradersLoad, tradersSortCol],
  );

  const onSelectMarket = useCallback(
    (id: string) => {
      setSelectedMarketId(id);
      setTradersTotal(-1);
      setTradersOffset(0);
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
            Type
            <select
              className="bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-[11px] text-white"
              value={draftMode}
              onChange={(e) => setDraftMode(e.target.value as MarketViewMode)}
            >
              <option value="crypto">Crypto</option>
              <option value="weather">Weather</option>
            </select>
          </label>
          {draftMode === 'crypto' ? (
            <>
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
            </>
          ) : (
            <>
              <label className="flex items-center gap-1 text-[10px] text-gray-400">
                City
                <select
                  className="bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-[11px] text-white max-w-[9rem]"
                  value={draftCity}
                  onChange={(e) => setDraftCity(e.target.value)}
                >
                  {WEATHER_CITIES.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-[10px] text-gray-400">
                Metric
                <select
                  className="bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-[11px] text-white"
                  value={draftMetric}
                  onChange={(e) => setDraftMetric(e.target.value as WeatherMetric)}
                >
                  {WEATHER_METRICS.map((m) => (
                    <option key={m} value={m}>
                      {m === 'high' ? 'High' : 'Low'}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button
            type="button"
            className="rounded bg-blue-600 hover:bg-blue-500 px-2.5 py-0.5 text-[11px] font-bold text-white"
            onClick={onLoad}
          >
            Load
          </button>
          {loadedMode === 'crypto' && loadedAsset && loadedTimeframe ? (
            <span className="text-[10px] text-gray-500 ml-1">
              {loadedAsset} · {loadedTimeframe} · {loadedMarkets.length}
              {marketsTotal >= 0 ? ` / ${marketsTotal} expired` : ''}
              {marketViewUsesGrid(loadedTimeframe) ? ' (+ open)' : ''}
            </span>
          ) : null}
          {loadedMode === 'weather' && loadedCity && loadedMetric ? (
            <span className="text-[10px] text-gray-500 ml-1">
              {WEATHER_CITIES.find((c) => c.slug === loadedCity)?.label ?? loadedCity} ·{' '}
              {loadedMetric === 'high' ? 'High' : 'Low'} · {loadedMarkets.length}
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
            {marketViewUsesGrid(loadedTimeframe ?? (draftMode === 'weather' ? 'weather' : draftTimeframe)) ? (
              <MarketViewMarketsLegend />
            ) : null}
            {!loadedMode || !loadedTimeframe ? (
              <div className="flex flex-1 items-center justify-center text-gray-500 text-[10px]">
                Loading markets…
              </div>
            ) : marketsError ? (
              <div className="flex flex-1 items-center justify-center text-red-400 text-[10px] px-2 text-center">
                {marketsError}
              </div>
            ) : loadingMarkets && loadedMarkets.length === 0 ? (
              <div className="flex flex-1 min-h-0" />
            ) : loadedMarkets.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-gray-500 text-[10px]">
                {loadedMode === 'weather' ? 'No weather markets for this city.' : 'No expired markets.'}
              </div>
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
                marketId={selectedMarketId}
                onRowClick={onSelectTraderRow}
                onOpenWallet={onOpenTraderWallet}
                offset={tradersOffset}
                total={tradersTotal}
                sortCol={tradersSortCol}
                sortOrder={tradersSortOrder}
                onSortClick={onTradersSortClick}
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
            {!selectedMarketId ? (
              <div className="flex flex-1 items-center justify-center text-gray-500 text-[10px]">Select a market.</div>
            ) : (
              <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
                <WalletMarketTradesSection
                  open={open}
                  wallet={selectedWallet ?? ''}
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
