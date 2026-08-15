import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppStore } from '../../stores/appStore';
import { ASSET_COLORS, type AssetName, type Market } from '../../types';
import {
  assetToSymbol,
  formatDateShort,
  formatPrice,
  formatPriceShort,
  normalizeClobTokenId,
  parseStrikeTokenToNumber,
} from '../../utils/format';
import { useExpiryNow } from '../../hooks/useExpiryNow';
import { formatMarketCountdown } from '../../lib/marketCountdown';
import { useThrottledStorePrice } from '../../hooks/useThrottledStorePrice';
import {
  getBidAskMarketRow,
  subscribeBidAskMarketLookup,
  subscribeBidAskMarketLookupGridFlush,
} from '../../lib/bidAskMarketLookup';
import { setChartBidAskExtraTokens } from '../../lib/chartWsShared';
import {
  outcomeBestAskProb,
  outcomeBestBidProb,
  outcomeMidOrOneSideProb,
} from '../../lib/outcomeQuote';

const EMPTY_MARKETS: Market[] = [];
const BAR_MAX_PCT = 1;
const CRYPTO_ASSETS: AssetName[] = ['BTC', 'ETH', 'SOL', 'XRP', 'WTI', 'NG', 'SPY', 'AAPL', 'GOOGL', 'NVDA', 'AMZN'];

/** Bar fill colors aligned with ASSET_COLORS (text-*). */
const ASSET_BAR_COLORS: Record<AssetName, { bar: string; spread: string }> = {
  BTC: { bar: 'bg-orange-400/90', spread: 'bg-orange-400/40' },
  ETH: { bar: 'bg-blue-400/90', spread: 'bg-blue-400/40' },
  SOL: { bar: 'bg-purple-400/90', spread: 'bg-purple-400/40' },
  XRP: { bar: 'bg-cyan-400/90', spread: 'bg-cyan-400/40' },
  WTI: { bar: 'bg-amber-500/90', spread: 'bg-amber-500/40' },
  NG: { bar: 'bg-lime-400/90', spread: 'bg-lime-400/40' },
  SPY: { bar: 'bg-emerald-400/90', spread: 'bg-emerald-400/40' },
  AAPL: { bar: 'bg-gray-200/90', spread: 'bg-gray-200/40' },
  GOOGL: { bar: 'bg-blue-300/90', spread: 'bg-blue-300/40' },
  NVDA: { bar: 'bg-green-400/90', spread: 'bg-green-400/40' },
  AMZN: { bar: 'bg-orange-300/90', spread: 'bg-orange-300/40' },
};

export type CryptoBucketKind = 'above' | 'between' | 'hit';

const KIND_LABELS: Record<CryptoBucketKind, string> = {
  above: 'Above',
  between: 'Between',
  hit: 'Hit',
};

type OutcomeView = 'YES' | 'NO';

type DateCol = {
  slug: string;
  endDate: string;
  title: string;
};

type MarketYesQuote = {
  bid: number | null;
  ask: number | null;
  mid: number | null;
};

function flipProb01(p: number | null): number | null {
  if (p == null || !Number.isFinite(p)) return null;
  return Math.max(0, Math.min(1, 1 - p));
}

function getMarketYesQuote(market: Market): MarketYesQuote {
  const tokenIds = market.clobTokenIds || [];
  const yesTokenId = tokenIds[0] || '';
  const noTokenId = tokenIds[1] || '';
  const yesLive = yesTokenId ? getBidAskMarketRow(yesTokenId) : undefined;
  const noLive = noTokenId ? getBidAskMarketRow(noTokenId) : undefined;
  const lookup: Record<string, Market> = {};
  if (yesTokenId) lookup[yesTokenId] = yesLive ?? market;
  if (noTokenId && noLive) lookup[noTokenId] = noLive;
  const gamma = { bestBid: market.bestBid, bestAsk: market.bestAsk };
  return {
    bid: outcomeBestBidProb(yesTokenId, lookup, gamma),
    ask: outcomeBestAskProb(yesTokenId, lookup, gamma),
    mid: outcomeMidOrOneSideProb(yesTokenId, lookup, gamma),
  };
}

function quoteForOutcomeView(yesQuote: MarketYesQuote, view: OutcomeView): MarketYesQuote {
  if (view === 'YES') return yesQuote;
  const bid = yesQuote.ask != null ? flipProb01(yesQuote.ask) : null;
  const ask = yesQuote.bid != null ? flipProb01(yesQuote.bid) : null;
  let mid = yesQuote.mid != null ? flipProb01(yesQuote.mid) : null;
  if (mid == null) {
    if (bid != null && ask != null) mid = (bid + ask) / 2;
    else mid = bid ?? ask;
  }
  return { bid, ask, mid };
}

function fracToBottomPx(frac: number, maxPct: number, trackPx: number): number {
  if (!(frac > 0) || !(maxPct > 0) || !(trackPx > 0)) return 0;
  return Math.max(0, Math.min(trackPx, (frac / maxPct) * trackPx));
}

function marketBarTipPx(quote: MarketYesQuote, maxPct: number, trackPx: number): number {
  const bidPx = quote.bid != null ? fracToBottomPx(quote.bid, maxPct, trackPx) : 0;
  const askPx = quote.ask != null ? fracToBottomPx(quote.ask, maxPct, trackPx) : 0;
  const midPx = quote.mid != null ? fracToBottomPx(quote.mid, maxPct, trackPx) : 0;
  return Math.max(bidPx, askPx, midPx);
}

function renderMarketSpreadBar(
  quote: MarketYesQuote,
  maxPct: number,
  trackPx: number,
  barColor: string,
  barSpreadColor: string,
): ReactNode {
  const bidPx = quote.bid != null ? fracToBottomPx(quote.bid, maxPct, trackPx) : 0;
  const askPx = quote.ask != null ? fracToBottomPx(quote.ask, maxPct, trackPx) : 0;
  const midPx = quote.mid != null ? fracToBottomPx(quote.mid, maxPct, trackPx) : null;
  const hasSpread = quote.bid != null && quote.ask != null && askPx > bidPx + 0.5;
  const topPx = Math.max(bidPx, askPx, midPx ?? 0);
  if (topPx <= 0) return null;

  const nodes: ReactNode[] = [];
  if (hasSpread) {
    if (bidPx > 0) {
      nodes.push(
        <div
          key="bid"
          className={`absolute bottom-0 left-0 right-0 pointer-events-none ${barColor}`}
          style={{ height: bidPx }}
        />,
      );
    }
    nodes.push(
      <div
        key="spread"
        className={`absolute left-0 right-0 rounded-t-sm pointer-events-none ${barSpreadColor}`}
        style={{ bottom: bidPx, height: askPx - bidPx }}
      />,
    );
  } else if (quote.bid != null && bidPx > 0) {
    nodes.push(
      <div
        key="bid-only"
        className={`absolute bottom-0 left-0 right-0 rounded-t-sm pointer-events-none ${barColor}`}
        style={{ height: bidPx }}
      />,
    );
  } else if (quote.ask != null && askPx > 0) {
    nodes.push(
      <div
        key="ask-only"
        className={`absolute bottom-0 left-0 right-0 rounded-t-sm pointer-events-none ${barSpreadColor}`}
        style={{ height: askPx }}
      />,
    );
  } else if (midPx != null && midPx > 0) {
    nodes.push(
      <div
        key="mid-only"
        className={`absolute bottom-0 left-0 right-0 rounded-t-sm pointer-events-none ${barColor}`}
        style={{ height: midPx }}
      />,
    );
  }

  if (midPx != null && topPx > 2) {
    nodes.push(
      <div
        key="mid-gap"
        className="absolute left-0 right-0 z-[5] pointer-events-none bg-gray-900"
        style={{ bottom: midPx - 1, height: 2 }}
      />,
    );
  }
  return nodes;
}

function strikeSortValue(str: string): number {
  const s = str.replace(/\$/g, '').replace(/,/g, '').trim();
  if (s.startsWith('<') || s.startsWith('↓')) return parseStrikeTokenToNumber(s.slice(1)) - 0.5;
  if (s.startsWith('>') || s.startsWith('↑')) return parseStrikeTokenToNumber(s.slice(1)) + 1_000_000;
  if (s.includes('-')) return parseStrikeTokenToNumber(s.split('-')[0]) || 0;
  return parseStrikeTokenToNumber(s) || 0;
}

function compactBucketLabel(price: string, asset: AssetName): string {
  const short = formatPriceShort(price, asset === 'ETH' ? 'ETH' : undefined);
  return short.replace(/\s+/g, '');
}

function formatDateColHeader(endDate: string): string {
  const dt = new Date(endDate);
  if (Number.isNaN(dt.getTime())) return endDate.slice(0, 10);
  const day = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dt.getDay()];
  return `${day} ${formatDateShort(endDate)}`;
}

function isWeekendEndDate(endDate: string): boolean {
  const dt = new Date(endDate);
  if (Number.isNaN(dt.getTime())) return false;
  const d = dt.getDay();
  return d === 0 || d === 6;
}

function buildBucketGrid(markets: Market[], includePast: boolean) {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const dateMap = new Map<string, DateCol>();
  const priceSet = new Set<string>();
  const marketLookup: Record<string, Market> = {};

  for (const m of markets) {
    const slug = m.eventSlug || '';
    if (!slug) continue;
    if (!dateMap.has(slug)) {
      dateMap.set(slug, { slug, endDate: m.endDate || '', title: m.eventTitle || '' });
    }
  }

  for (const m of markets) {
    const slug = m.eventSlug || '';
    const price = (m.groupItemTitle || '').trim();
    if (!slug || !price) continue;
    priceSet.add(price);
    marketLookup[`${price}_${slug}`] = m;
  }

  let dates = Array.from(dateMap.values())
    .filter((d) => {
      const endTime = d.endDate ? new Date(d.endDate).getTime() : Infinity;
      return endTime > oneDayAgo;
    })
    .sort((a, b) => {
      const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
      const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
      return ta - tb;
    });

  if (!includePast) {
    dates = dates.filter((d) => {
      const endTime = d.endDate ? new Date(d.endDate).getTime() : Infinity;
      return endTime > now;
    });
  }

  const prices = Array.from(priceSet).sort((a, b) => strikeSortValue(a) - strikeSortValue(b));
  return { dates, prices, marketLookup };
}

function readStoredAsset(panelId: string): AssetName {
  const saved = localStorage.getItem(`polybot-crypto-buckets-asset-${panelId}`);
  if (saved && CRYPTO_ASSETS.includes(saved as AssetName)) return saved as AssetName;
  return 'BTC';
}

function readStoredKind(panelId: string): CryptoBucketKind {
  const saved = localStorage.getItem(`polybot-crypto-buckets-kind-${panelId}`);
  if (saved === 'above' || saved === 'between' || saved === 'hit') return saved;
  return 'between';
}

function readStoredOutcome(panelId: string): OutcomeView {
  return localStorage.getItem(`polybot-crypto-buckets-outcome-${panelId}`) === 'NO' ? 'NO' : 'YES';
}

function readStoredDateKey(panelId: string): string {
  return localStorage.getItem(`polybot-crypto-buckets-date-${panelId}`) || '';
}

const CryptoBucketExpiry = memo(function CryptoBucketExpiry({ endDate }: { endDate: string }) {
  const now = useExpiryNow();
  const cd = useMemo(() => {
    if (!endDate) return null;
    return formatMarketCountdown(endDate, now);
  }, [endDate, now]);
  if (!cd?.text) return null;
  const cls =
    cd.text === 'Expired' || cd.remaining < 60_000
      ? 'text-red-400'
      : cd.remaining > 300_000
        ? 'text-green-400'
        : 'text-yellow-400';
  return <span className={`text-[10px] font-semibold tabular-nums ${cls}`}>{cd.text}</span>;
});

const CryptoBucketSpot = memo(function CryptoBucketSpot({ asset }: { asset: AssetName }) {
  const price = useThrottledStorePrice(assetToSymbol(asset), 1000);
  return (
    <span className="text-[10px] font-normal tabular-nums text-gray-400">
      {price > 0 ? formatPrice(price, asset) : '—'}
    </span>
  );
});

function CryptoBucketBar({
  label,
  quote,
  maxPct,
  trackPx,
  barColor,
  barSpreadColor,
  selected,
  marketTitle,
  onClick,
}: {
  label: string;
  quote: MarketYesQuote;
  maxPct: number;
  trackPx: number;
  barColor: string;
  barSpreadColor: string;
  selected: boolean;
  marketTitle: string;
  onClick: () => void;
}) {
  const tipPx = marketBarTipPx(quote, maxPct, trackPx);
  const marketBar = useMemo(
    () => renderMarketSpreadBar(quote, maxPct, trackPx, barColor, barSpreadColor),
    [quote, maxPct, trackPx, barColor, barSpreadColor],
  );
  const pct = quote.mid;
  const quoteTip = [
    quote.bid != null ? `Bid ${Math.round(quote.bid * 100)}%` : null,
    quote.mid != null ? `Mid ${Math.round(quote.mid * 100)}%` : null,
    quote.ask != null ? `Ask ${Math.round(quote.ask * 100)}%` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      className={`no-drag flex h-full min-w-0 flex-1 flex-col items-center justify-end px-0.5 outline-none focus:outline-none ${
        selected ? 'rounded ring-2 ring-white/70' : ''
      }`}
      onClick={onClick}
      title={[marketTitle, quoteTip].filter(Boolean).join(' · ')}
    >
      <div className="relative flex w-full min-h-0 flex-1 items-end">
        <div className="relative h-full w-full">
          {marketBar}
          {pct != null ? (
            <span
              className="pointer-events-none absolute left-0 right-0 z-[6] -translate-y-full text-center text-[9px] tabular-nums leading-none text-gray-200"
              style={{ bottom: tipPx }}
            >
              {(pct * 100).toFixed(0)}
            </span>
          ) : null}
        </div>
      </div>
      <span
        className={`mt-1 max-w-full shrink-0 truncate text-[8px] leading-tight min-h-[10px] ${
          selected ? 'font-semibold text-white/90' : 'text-gray-500'
        }`}
      >
        {label}
      </span>
    </button>
  );
}

function CryptoBucketBars({
  prices,
  marketLookup,
  dateSlug,
  asset,
  outcomeView,
  selectedMarketId,
  onBarClick,
  barColor,
  barSpreadColor,
}: {
  prices: string[];
  marketLookup: Record<string, Market>;
  dateSlug: string;
  asset: AssetName;
  outcomeView: OutcomeView;
  selectedMarketId: string;
  onBarClick: (market: Market) => void;
  barColor: string;
  barSpreadColor: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackPx, setTrackPx] = useState(160);
  const [quoteTick, setQuoteTick] = useState(0);

  useEffect(() => {
    const bump = () => setQuoteTick((n) => n + 1);
    const unsub1 = subscribeBidAskMarketLookup(bump);
    const unsub2 = subscribeBidAskMarketLookupGridFlush(bump);
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      if (h > 0) setTrackPx(h);
    });
    ro.observe(el);
    setTrackPx(el.clientHeight || 160);
    return () => ro.disconnect();
  }, [prices, dateSlug]);

  const entries = useMemo(() => {
    void quoteTick; // re-read live bid/ask books
    return prices
      .map((price) => {
        const market = marketLookup[`${price}_${dateSlug}`];
        if (!market) return null;
        return {
          price,
          label: compactBucketLabel(price, asset),
          market,
          quote: quoteForOutcomeView(getMarketYesQuote(market), outcomeView),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);
  }, [prices, marketLookup, dateSlug, asset, outcomeView, quoteTick]);

  if (entries.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">
        No buckets for this date
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded border border-gray-700/80 bg-gray-950/40">
      <div ref={trackRef} className="flex min-h-0 flex-1 items-end gap-0.5 px-1 pt-4 pb-1">
        {entries.map((e) => (
          <CryptoBucketBar
            key={e.market.id}
            label={e.label}
            quote={e.quote}
            maxPct={BAR_MAX_PCT}
            trackPx={Math.max(40, trackPx - 14)}
            barColor={barColor}
            barSpreadColor={barSpreadColor}
            selected={selectedMarketId === e.market.id}
            marketTitle={e.market.question || e.label}
            onClick={() => onBarClick(e.market)}
          />
        ))}
      </div>
    </div>
  );
}

function CryptoBucketPanelInner({ panelId }: { panelId: string }) {
  const [asset, setAsset] = useState<AssetName>(() => readStoredAsset(panelId));
  const [kind, setKind] = useState<CryptoBucketKind>(() => readStoredKind(panelId));
  const [outcomeView, setOutcomeView] = useState<OutcomeView>(() => readStoredOutcome(panelId));
  const [selectedDateKey, setSelectedDateKey] = useState(() => readStoredDateKey(panelId));
  const [assetOpen, setAssetOpen] = useState(false);
  const [kindOpen, setKindOpen] = useState(false);
  const [pastFilterTick, setPastFilterTick] = useState(0);
  const assetBtnRef = useRef<HTMLButtonElement>(null);
  const kindBtnRef = useRef<HTMLButtonElement>(null);
  const assetMenuRef = useRef<HTMLDivElement>(null);
  const kindMenuRef = useRef<HTMLDivElement>(null);

  const above = useAppStore((s) => s.aboveMarkets[asset] ?? EMPTY_MARKETS);
  const between = useAppStore((s) => s.priceOnMarkets[asset] ?? EMPTY_MARKETS);
  const hit = useAppStore((s) => s.weeklyHitMarkets[asset] ?? EMPTY_MARKETS);
  const showPast = useAppStore((s) => s.showPast);
  const setShowPast = useAppStore((s) => s.setShowPast);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const selectedMarketId = useAppStore((s) => s.selectedMarketKey || s.selectedMarket?.id || '');

  const markets = kind === 'above' ? above : kind === 'hit' ? hit : between;

  useEffect(() => {
    if (showPast) return;
    const id = window.setInterval(() => setPastFilterTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [showPast]);

  useEffect(() => {
    if (!assetOpen && !kindOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (assetOpen) {
        if (assetBtnRef.current?.contains(t) || assetMenuRef.current?.contains(t)) return;
        setAssetOpen(false);
      }
      if (kindOpen) {
        if (kindBtnRef.current?.contains(t) || kindMenuRef.current?.contains(t)) return;
        setKindOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [assetOpen, kindOpen]);

  const grid = useMemo(
    () => buildBucketGrid(markets, showPast),
    // pastFilterTick re-filters as time passes when showPast is off
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markets, showPast, pastFilterTick],
  );

  const activeDateCol = useMemo(() => {
    if (grid.dates.length === 0) return undefined;
    if (selectedDateKey) {
      const hitCol = grid.dates.find((d) => d.slug === selectedDateKey);
      if (hitCol) return hitCol;
    }
    return grid.dates[0];
  }, [grid.dates, selectedDateKey]);

  // Subscribe YES/NO tokens for active date bars.
  const chartExtraKey = `crypto-buckets-${panelId}`;
  useEffect(() => {
    if (!activeDateCol) {
      setChartBidAskExtraTokens(chartExtraKey, []);
      return;
    }
    const tokens: string[] = [];
    for (const price of grid.prices) {
      const m = grid.marketLookup[`${price}_${activeDateCol.slug}`];
      if (!m?.clobTokenIds) continue;
      for (const tid of m.clobTokenIds) {
        const k = normalizeClobTokenId(tid);
        if (k) tokens.push(k);
      }
    }
    setChartBidAskExtraTokens(chartExtraKey, tokens);
    return () => setChartBidAskExtraTokens(chartExtraKey, []);
  }, [activeDateCol, grid.prices, grid.marketLookup, chartExtraKey]);

  const handleBarClick = useCallback(
    (market: Market) => {
      setSelectedMarket(market);
      setSidebarOutcome(outcomeView);
      setSidebarOpen(true);
    },
    [outcomeView, setSelectedMarket, setSidebarOpen, setSidebarOutcome],
  );

  const selectDate = (d: DateCol) => {
    setSelectedDateKey(d.slug);
    localStorage.setItem(`polybot-crypto-buckets-date-${panelId}`, d.slug);
  };

  const titleColor = ASSET_COLORS[asset] || 'text-yellow-400';
  const { bar: barColor, spread: barSpreadColor } =
    ASSET_BAR_COLORS[asset] ?? { bar: 'bg-yellow-400/90', spread: 'bg-yellow-400/40' };

  return (
    <div className="panel-wrapper flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-gray-800/50 p-3">
      <div className="panel-header relative z-30 mb-2 flex min-w-0 shrink-0 cursor-grab items-center gap-2">
        <span className="shrink-0 text-xs font-bold text-gray-500">Buckets</span>

        {/* Asset */}
        <button
          ref={assetBtnRef}
          type="button"
          className={`no-drag relative inline-flex shrink-0 items-center text-sm font-bold ${titleColor}`}
          onClick={() => {
            setAssetOpen((v) => !v);
            setKindOpen(false);
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {asset}
          <svg className="ml-0.5 inline h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          {assetOpen && (
            <div
              ref={assetMenuRef}
              className="absolute left-0 top-full z-50 mt-1 max-h-48 min-w-[88px] overflow-y-auto rounded border border-gray-600 bg-gray-800 shadow-lg"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {CRYPTO_ASSETS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`block w-full px-2 py-1 text-left text-[11px] font-bold hover:bg-gray-700 ${
                    a === asset ? ASSET_COLORS[a] : 'text-gray-300'
                  }`}
                  onClick={() => {
                    setAsset(a);
                    localStorage.setItem(`polybot-crypto-buckets-asset-${panelId}`, a);
                    setAssetOpen(false);
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
        </button>

        <CryptoBucketSpot asset={asset} />

        {/* Type */}
        <button
          ref={kindBtnRef}
          type="button"
          className="no-drag relative inline-flex shrink-0 items-center rounded border border-gray-600 bg-gray-900/90 px-1.5 py-0.5 text-[10px] font-bold text-gray-200"
          onClick={() => {
            setKindOpen((v) => !v);
            setAssetOpen(false);
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {KIND_LABELS[kind]}
          <svg className="ml-0.5 inline h-3 w-3 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          {kindOpen && (
            <div
              ref={kindMenuRef}
              className="absolute left-0 top-full z-50 mt-1 min-w-[100px] overflow-hidden rounded border border-gray-600 bg-gray-800 shadow-lg"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {(Object.keys(KIND_LABELS) as CryptoBucketKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`block w-full px-2 py-1 text-left text-[11px] font-bold hover:bg-gray-700 ${
                    k === kind ? 'text-white' : 'text-gray-300'
                  }`}
                  onClick={() => {
                    setKind(k);
                    localStorage.setItem(`polybot-crypto-buckets-kind-${panelId}`, k);
                    setKindOpen(false);
                  }}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
          )}
        </button>

        {/* YES / NO */}
        <div className="no-drag inline-flex shrink-0 overflow-hidden rounded border border-gray-600 divide-x divide-gray-600 bg-gray-900/90">
          <button
            type="button"
            className={`px-1.5 py-0.5 text-[9px] font-bold ${
              outcomeView === 'YES' ? 'bg-green-700/80 text-white' : 'text-gray-400 hover:text-green-300'
            }`}
            onClick={() => {
              setOutcomeView('YES');
              localStorage.setItem(`polybot-crypto-buckets-outcome-${panelId}`, 'YES');
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            YES
          </button>
          <button
            type="button"
            className={`px-1.5 py-0.5 text-[9px] font-bold ${
              outcomeView === 'NO' ? 'bg-red-700/80 text-white' : 'text-gray-400 hover:text-red-300'
            }`}
            onClick={() => {
              setOutcomeView('NO');
              localStorage.setItem(`polybot-crypto-buckets-outcome-${panelId}`, 'NO');
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            NO
          </button>
        </div>

        <label
          className="no-drag inline-flex cursor-pointer items-center gap-1 text-[10px] font-normal text-gray-400"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={showPast}
            onChange={(e) => setShowPast(e.target.checked)}
            className="h-3 w-3 cursor-pointer"
          />
          Past
        </label>

        {/* Date switch — same chip style as Temp Odds / weather */}
        {grid.dates.length > 0 ? (
          <div className="no-drag flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {grid.dates.map((d) => {
              const selected = !!activeDateCol && d.slug === activeDateCol.slug;
              const isEnded = d.endDate && new Date(d.endDate).getTime() < Date.now();
              const weekend = isWeekendEndDate(d.endDate);
              return (
                <button
                  key={d.slug}
                  type="button"
                  onClick={() => selectDate(d)}
                  className={`whitespace-nowrap rounded border px-2 py-0.5 text-[10px] font-bold tabular-nums transition-colors ${
                    selected
                      ? 'border-sky-500 bg-sky-600/50 text-white'
                      : 'border-gray-700 bg-gray-800/80 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                  } ${isEnded ? 'opacity-50' : ''} ${weekend && !selected ? 'text-purple-400' : ''}`}
                >
                  {formatDateColHeader(d.endDate)}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="min-w-6 flex-1 basis-6 self-stretch" aria-hidden />
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
          {activeDateCol?.endDate ? <CryptoBucketExpiry endDate={activeDateCol.endDate} /> : null}
        </div>
      </div>

      <div className="panel-body min-h-0 flex-1">
        {markets.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-gray-500">
            No {KIND_LABELS[kind].toLowerCase()} markets for {asset}
          </div>
        ) : !activeDateCol ? (
          <div className="flex h-full items-center justify-center text-xs text-gray-500">No active dates</div>
        ) : (
          <CryptoBucketBars
            prices={grid.prices}
            marketLookup={grid.marketLookup}
            dateSlug={activeDateCol.slug}
            asset={asset}
            outcomeView={outcomeView}
            selectedMarketId={selectedMarketId}
            onBarClick={handleBarClick}
            barColor={barColor}
            barSpreadColor={barSpreadColor}
          />
        )}
      </div>
    </div>
  );
}

export const CryptoBucketPanel = memo(CryptoBucketPanelInner);
