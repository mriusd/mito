import { ExternalLink, Link2, Link2Off, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../stores/appStore';
import { formatElapsedSinceMs, getOrderClobTokenId, isWeatherMarket, normalizeClobTokenId, tradeElapsedColorClass } from '../../utils/format';
import { useWalletTradeElapsedMs } from '../../lib/walletTradeElapsedStore';
import { useExpiryNow } from '../../hooks/useExpiryNow';
import { formatMarketCountdown } from '../../lib/marketCountdown';
import { parseWeatherCityFromSlug, weatherMarketExpiryMsForEvent } from '../../lib/weatherMarketExpiry';
import type { Market, Order, WeatherCitySlug } from '../../types';
import { WEATHER_CITIES } from '../../types';
import {
  formatWeatherCityLocalClock,
  isWeatherCitySlug,
  mergeWeatherCityOptions,
  weatherCityTempUnit,
  weatherCityResolutionUrl,
} from '../../lib/weatherCities';
import { onTempOddsCitySelect, selectTempOddsCity, selectTempOddsDate } from '../../lib/weatherTempOddsControl';
import { bumpCustomSidebarButtonsStore } from '../../lib/sidebarCustomButtons';
import { sortWeatherCityOptions, useWeatherCityFavorites } from '../../lib/weatherCityFavorites';
import { WeatherCityMenu } from '../WeatherCityMenu';
import {
  buildTableData,
  compactTempBucketLabel,
  filterWeatherMarkets,
  findDateColForEndDate,
  formatWeatherDateColHeader,
  isWeatherDateColWeekend,
  lookupModelBucketProb,
  mergeWeatherDateColumns,
  weatherDateColKey,
  weatherEventDateISOFromSlug,
  weatherTempBucketMatchesCelsius,
  type DateCol,
  type WeatherGridData,
} from '../../lib/weatherMarketsGrid';
import { fetchWeatherProbabilities, type WeatherProbabilitiesPayload } from '../../api';
import {
  fetchWeatherObservations,
  isWeatherDateTodayInTimezone,
  weatherHighlightHighC,
  weatherHighlightLowC,
  type WeatherObservationsResponse,
  type WeatherTempUnit,
} from '../../lib/weatherObservations';
import { TempUnitToggle, TemperatureChart } from '../TemperatureChart';
import { TempOddsCustomButtonsPopup } from '../TempOddsCustomButtonsPopup';
import { outcomeBestAskProb, outcomeBestBidProb, outcomeMidOrOneSideProb } from '../../lib/outcomeQuote';
import { resolveLegPositionForToken } from '../../lib/sidebarMyPositions';
import { useSidebarOnchainGridWalletPositions } from '../../lib/sidebarOnchainTradesStore';
import { getBidAskMarketRow, subscribeBidAskMarketLookup } from '../../lib/bidAskMarketLookup';
import { setChartBidAskExtraTokens } from '../../lib/chartWsShared';
import { useThrottledGridOrders, useThrottledGridPositions } from '../../hooks/useThrottledGridWallet';
import type { Position } from '../../types';
import type { WSPosition } from '../../hooks/useOnchainTradesWS';

const EMPTY_MARKETS: Market[] = [];

function barMarketsForGrid(grid: WeatherGridData | null, dateCol: DateCol | undefined): Market[] {
  if (!grid || !dateCol) return [];
  return grid.temps
    .map((temp) => grid.marketLookup[temp + '_' + dateCol.slug])
    .filter((m): m is Market => !!m);
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return !!el.closest('input, textarea, select, [contenteditable="true"]');
}

function shouldIgnoreTempOddsKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  if (isTypingTarget(e.target)) return true;
  return false;
}

function tempOddsBarDirFromKey(key: string): -1 | 1 | null {
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return -1;
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return 1;
  return null;
}

function readStoredLinkSidebar(panelId: string): boolean {
  return localStorage.getItem(`polybot-weather-temp-bars-link-sidebar-${panelId}`) === '1';
}

type TempOddsChartMode = 'low' | 'high';

function readStoredTempOddsChartMode(panelId: string): TempOddsChartMode {
  const v = localStorage.getItem(`polybot-weather-temp-bars-chart-mode-${panelId}`);
  return v === 'high' ? 'high' : 'low';
}

function weatherMarketCityAndDate(
  market: Market | null | undefined,
): { city: WeatherCitySlug; dateIso: string } | null {
  if (!market || !isWeatherMarket(market)) return null;
  const city = parseWeatherCityFromSlug(market.eventSlug || '');
  if (!city || !isWeatherCitySlug(city)) return null;
  const dateIso = weatherEventDateISOFromSlug(market.eventSlug || '');
  if (!dateIso) return null;
  return { city, dateIso };
}

function weatherMarketTempOddsMode(market: Market | null | undefined): TempOddsChartMode | null {
  if (!market) return null;
  const slug = `${market.eventSlug || ''} ${market.question || ''}`.toLowerCase();
  if (slug.includes('lowest-temperature') || slug.includes('lowest temperature')) return 'low';
  if (slug.includes('highest-temperature') || slug.includes('highest temperature')) return 'high';
  return null;
}

/** Match sidebar/TPO selection to a Temp Odds bar market (id, condition, or YES token). */
function weatherBarMarketMatches(
  bar: Market,
  selectedId: string,
  selected: Market | null | undefined,
): boolean {
  if (selectedId && bar.id === selectedId) return true;
  if (!selected) return false;
  if (bar.id && selected.id && bar.id === selected.id) return true;
  const bc = (bar.conditionId || '').trim().toLowerCase();
  const sc = (selected.conditionId || '').trim().toLowerCase();
  if (bc && sc && bc === sc) return true;
  const bt = normalizeClobTokenId(bar.clobTokenIds?.[0] || '');
  const st0 = normalizeClobTokenId(selected.clobTokenIds?.[0] || '');
  const st1 = normalizeClobTokenId(selected.clobTokenIds?.[1] || '');
  if (bt && (bt === st0 || bt === st1)) return true;
  return false;
}

function findWeatherBarMarket(
  markets: Market[],
  selectedId: string,
  selected: Market | null | undefined,
): Market | undefined {
  return markets.find((m) => weatherBarMarketMatches(m, selectedId, selected));
}

function readStoredCity(panelId: string, fallback: WeatherCitySlug): WeatherCitySlug {
  const saved = localStorage.getItem(`polybot-weather-temp-bars-city-${panelId}`);
  if (saved && isWeatherCitySlug(saved)) return saved;
  return fallback;
}

function weatherModelContextKey(city: WeatherCitySlug, dateCol: DateCol | undefined): string {
  if (!dateCol) return '';
  const date = weatherEventDateISOFromSlug(dateCol.slug);
  if (!date) return '';
  return `${city}\0${date}`;
}

function weatherPayloadUpdatedMs(
  payload: WeatherProbabilitiesPayload | null,
  fetchedAtMs: number,
): number {
  if (!payload) return 0;
  if (payload.updated_at != null && Number.isFinite(payload.updated_at)) {
    const ms = payload.updated_at > 1e12 ? payload.updated_at : payload.updated_at * 1000;
    if (Number.isFinite(ms) && ms > 0 && ms <= Date.now()) return ms;
  }
  const ts = payload.analysis_timestamp;
  if (ts) {
    const ms = Date.parse(ts);
    if (Number.isFinite(ms) && ms > 0 && ms <= Date.now()) return ms;
  }
  return fetchedAtMs;
}

function yesChartEntryFrac(avgPrice: number, outcome: 'YES' | 'NO'): number | null {
  let f = avgPrice > 1 ? avgPrice / 100 : avgPrice;
  if (!Number.isFinite(f) || f <= 0) return null;
  if (outcome === 'NO') f = 1 - f;
  if (f <= 0 || f >= 1) return null;
  return f;
}

function marketEntryYesFrac(
  yesTokenId: string,
  noTokenId: string,
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
): { frac: number; outcome: 'YES' | 'NO' } | null {
  const yesPos = yesTokenId
    ? resolveLegPositionForToken(yesTokenId, positions, liveTradesSource, onchainWsPositions)
    : null;
  if (yesPos?.avgPrice) {
    const frac = yesChartEntryFrac(yesPos.avgPrice, 'YES');
    if (frac != null) return { frac, outcome: 'YES' };
  }
  const noPos = noTokenId
    ? resolveLegPositionForToken(noTokenId, positions, liveTradesSource, onchainWsPositions)
    : null;
  if (noPos?.avgPrice) {
    const frac = yesChartEntryFrac(noPos.avgPrice, 'NO');
    if (frac != null) return { frac, outcome: 'NO' };
  }
  return null;
}

type TempOddsOrderMark = { frac: number; outcome: 'YES' | 'NO'; side: Order['side'] };

function tempEntryMarkClass(outcome: 'YES' | 'NO'): string {
  return outcome === 'YES' ? 'bg-green-400' : 'bg-red-400';
}

function tempOrderMarkClass(mark: TempOddsOrderMark): string {
  if (mark.side === 'BUY' && mark.outcome === 'YES') return 'bg-purple-600';
  if (mark.side === 'BUY' && mark.outcome === 'NO') return 'bg-yellow-400';
  return 'bg-gray-400';
}

const MARK_LINE =
  'absolute h-[2px] pointer-events-none shadow-[0_0_2px_rgba(0,0,0,0.85)]';

function fracLevelKey(frac: number): string {
  return (frac * 10000).toFixed(0);
}

const TEMP_ODDS_BAR_MAX_PCT = 1;

function fracToBottomPx(frac: number, maxPct: number, trackPx: number): number {
  if (maxPct <= 0) return 0;
  return Math.min(trackPx, Math.max(0, (frac / maxPct) * trackPx));
}

type TempLevelMark =
  | { kind: 'entry'; outcome: 'YES' | 'NO' }
  | { kind: 'order'; mark: TempOddsOrderMark; index: number };

type TempLevelGroup = { frac: number; items: TempLevelMark[] };

function buildTempLevelGroups(
  entry: { frac: number; outcome: 'YES' | 'NO' } | null,
  orderMarks: TempOddsOrderMark[],
): TempLevelGroup[] {
  const byLevel = new Map<string, TempLevelGroup>();
  const push = (frac: number, item: TempLevelMark) => {
    const key = fracLevelKey(frac);
    const group = byLevel.get(key);
    if (group) group.items.push(item);
    else byLevel.set(key, { frac, items: [item] });
  };
  if (entry != null) {
    push(entry.frac, { kind: 'entry', outcome: entry.outcome });
  }
  orderMarks.forEach((mark, index) => {
    push(mark.frac, { kind: 'order', mark, index });
  });
  return [...byLevel.values()];
}

function renderTempLevelMarks(
  groups: TempLevelGroup[],
  maxPct: number,
  trackPx: number,
): ReactNode[] {
  const out: ReactNode[] = [];
  for (const { frac, items } of groups) {
    const bottomPx = fracToBottomPx(frac, maxPct, trackPx);
    const levelKey = fracLevelKey(frac);
    const entryItem = items.find((i) => i.kind === 'entry');
    const orderItems = items.filter((i): i is Extract<TempLevelMark, { kind: 'order' }> => i.kind === 'order');

    if (entryItem && orderItems.length > 0) {
      out.push(
        <div
          key={`${levelKey}-entry`}
          className={`${MARK_LINE} z-10 ${tempEntryMarkClass(entryItem.outcome)}`}
          style={{ bottom: bottomPx, left: 0, width: '50%' }}
        />,
      );
      const sliceW = 50 / orderItems.length;
      orderItems.forEach((o, j) => {
        out.push(
          <div
            key={`${levelKey}-order-${o.index}-${o.mark.side}-${o.mark.outcome}`}
            className={`${MARK_LINE} z-[11] ${tempOrderMarkClass(o.mark)}`}
            style={{ bottom: bottomPx, left: `${50 + j * sliceW}%`, width: `${sliceW}%` }}
          />,
        );
      });
      continue;
    }

    if (items.length === 1) {
      const item = items[0];
      if (item.kind === 'entry') {
        out.push(
          <div
            key={`${levelKey}-entry`}
            className={`${MARK_LINE} z-10 ${tempEntryMarkClass(item.outcome)}`}
            style={{ bottom: bottomPx, left: 0, width: '100%' }}
          />,
        );
      } else {
        out.push(
          <div
            key={`${levelKey}-order-${item.index}`}
            className={`${MARK_LINE} z-[11] ${tempOrderMarkClass(item.mark)}`}
            style={{ bottom: bottomPx, left: 0, width: '100%' }}
          />,
        );
      }
      continue;
    }

    const sliceW = 100 / items.length;
    items.forEach((item, j) => {
      if (item.kind === 'entry') {
        out.push(
          <div
            key={`${levelKey}-entry-${j}`}
            className={`${MARK_LINE} z-10 ${tempEntryMarkClass(item.outcome)}`}
            style={{ bottom: bottomPx, left: `${j * sliceW}%`, width: `${sliceW}%` }}
          />,
        );
      } else {
        out.push(
          <div
            key={`${levelKey}-order-${item.index}-${j}`}
            className={`${MARK_LINE} z-[11] ${tempOrderMarkClass(item.mark)}`}
            style={{ bottom: bottomPx, left: `${j * sliceW}%`, width: `${sliceW}%` }}
          />,
        );
      }
    });
  }
  return out;
}

function orderYesMark(order: Order, yesTokenId: string, noTokenId: string): TempOddsOrderMark | null {
  const tid = normalizeClobTokenId(getOrderClobTokenId(order));
  const yesKey = normalizeClobTokenId(yesTokenId);
  const noKey = normalizeClobTokenId(noTokenId);
  const price = parseFloat(order.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (tid && yesKey && tid === yesKey) {
    const frac = yesChartEntryFrac(price, 'YES');
    if (frac != null) return { frac, outcome: 'YES', side: order.side };
  }
  if (tid && noKey && tid === noKey) {
    const frac = yesChartEntryFrac(price, 'NO');
    if (frac != null) return { frac, outcome: 'NO', side: order.side };
  }
  return null;
}

function marketOrderYesMarks(
  yesTokenId: string,
  noTokenId: string,
  orderLookup: Record<string, Order[]>,
): TempOddsOrderMark[] {
  const yesKey = normalizeClobTokenId(yesTokenId);
  const noKey = normalizeClobTokenId(noTokenId);
  const seen = new Set<Order>();
  const marks: TempOddsOrderMark[] = [];
  for (const order of [...(orderLookup[yesKey] ?? []), ...(orderLookup[noKey] ?? [])]) {
    if (seen.has(order)) continue;
    seen.add(order);
    const mark = orderYesMark(order, yesTokenId, noTokenId);
    if (mark) marks.push(mark);
  }
  return marks;
}

function buildOrderLookup(orders: Order[]): Record<string, Order[]> {
  const lookup: Record<string, Order[]> = {};
  for (const ord of orders) {
    const key = normalizeClobTokenId(getOrderClobTokenId(ord));
    if (!key) continue;
    if (!lookup[key]) lookup[key] = [];
    lookup[key].push(ord);
  }
  return lookup;
}

type MarketYesQuote = {
  bid: number | null;
  ask: number | null;
  mid: number | null;
};

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
  const bid = outcomeBestBidProb(yesTokenId, lookup, gamma);
  const ask = outcomeBestAskProb(yesTokenId, lookup, gamma);
  const mid = outcomeMidOrOneSideProb(yesTokenId, lookup, gamma);
  return { bid, ask, mid };
}

function quoteScaleLevels(quote: MarketYesQuote): number[] {
  return [quote.bid, quote.ask, quote.mid].filter((v): v is number => v != null);
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

type TempOddsBucket = {
  temp: string;
  label: string;
  market: Market;
  quote: MarketYesQuote;
  pct: number | null;
  modelPct: number | null;
  entry: { frac: number; outcome: 'YES' | 'NO' } | null;
  orderMarks: TempOddsOrderMark[];
};

function buildTempOddsBuckets(
  buckets: { temp: string; label: string; market: Market }[],
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
  modelBuckets: Record<string, number> | null | undefined,
  orderLookup: Record<string, Order[]>,
): { entries: TempOddsBucket[]; maxPct: number } {
  const entries: TempOddsBucket[] = buckets.map(({ temp, label, market }) => {
    const yesTokenId = market.clobTokenIds?.[0] || '';
    const noTokenId = market.clobTokenIds?.[1] || '';
    const quote = getMarketYesQuote(market);
    return {
      temp,
      label,
      market,
      quote,
      pct: quote.mid,
      modelPct: lookupModelBucketProb(modelBuckets, temp),
      entry: marketEntryYesFrac(yesTokenId, noTokenId, positions, liveTradesSource, onchainWsPositions),
      orderMarks: marketOrderYesMarks(yesTokenId, noTokenId, orderLookup),
    };
  });
  const maxPct = TEMP_ODDS_BAR_MAX_PCT;
  return { entries, maxPct };
}

function useTempOddsBuckets(
  buckets: { temp: string; label: string; market: Market }[],
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
  modelBuckets: Record<string, number> | null | undefined,
  orderLookup: Record<string, Order[]>,
) {
  const [quoteTick, setQuoteTick] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeBidAskMarketLookup(() => {
      if (timer != null) return;
      timer = setTimeout(() => {
        timer = null;
        setQuoteTick((n) => n + 1);
      }, 250);
    });
    return () => {
      unsub();
      if (timer != null) clearTimeout(timer);
    };
  }, []);

  const quoteTokenIds = useMemo(() => {
    const ids: string[] = [];
    for (const { market } of buckets) {
      for (const tid of market.clobTokenIds || []) {
        if (tid) ids.push(String(tid));
      }
    }
    return ids;
  }, [buckets]);

  useEffect(() => {
    setChartBidAskExtraTokens('temp-odds', quoteTokenIds);
  }, [quoteTokenIds]);
  useEffect(() => () => setChartBidAskExtraTokens('temp-odds', []), []);

  return useMemo(
    () => buildTempOddsBuckets(buckets, positions, liveTradesSource, onchainWsPositions, modelBuckets, orderLookup),
    [buckets, positions, liveTradesSource, onchainWsPositions, modelBuckets, orderLookup, quoteTick],
  );
}

interface TempOddsBarProps {
  label: string;
  quote: MarketYesQuote;
  pct: number | null;
  modelPct: number | null;
  maxPct: number;
  trackPx: number;
  barColor: string;
  barSpreadColor: string;
  modelBarColor: string;
  selected: boolean;
  entry: { frac: number; outcome: 'YES' | 'NO' } | null;
  orderMarks: TempOddsOrderMark[];
  marketTitle: string;
  onClick: () => void;
  showProb?: boolean;
  showLabel?: boolean;
  forecastHighlight?: boolean;
}

function TempOddsBar({
  label,
  quote,
  pct,
  modelPct,
  maxPct,
  trackPx,
  barColor,
  barSpreadColor,
  modelBarColor,
  selected,
  entry,
  orderMarks,
  marketTitle,
  onClick,
  showProb = true,
  showLabel = true,
  forecastHighlight = false,
}: TempOddsBarProps) {
  const modelBarPx =
    modelPct != null && maxPct > 0 ? (modelPct / maxPct) * trackPx : 0;
  const levelMarkGroups = useMemo(
    () => buildTempLevelGroups(entry, orderMarks),
    [entry, orderMarks],
  );
  const levelMarks = useMemo(
    () => renderTempLevelMarks(levelMarkGroups, maxPct, trackPx),
    [levelMarkGroups, maxPct, trackPx],
  );
  const marketBar = useMemo(
    () => renderMarketSpreadBar(quote, maxPct, trackPx, barColor, barSpreadColor),
    [quote, maxPct, trackPx, barColor, barSpreadColor],
  );
  const entryTip =
    entry != null ? `Entry ${(entry.frac * 100).toFixed(1)}¢ (${entry.outcome})` : undefined;
  const orderTips = orderMarks.map(
    (m) => `Order ${(m.frac * 100).toFixed(1)}¢ (${m.outcome} ${m.side})`,
  );
  const quoteTip = [
    quote.bid != null ? `Bid ${Math.round(quote.bid * 100)}%` : null,
    quote.mid != null ? `Mid ${Math.round(quote.mid * 100)}%` : null,
    quote.ask != null ? `Ask ${Math.round(quote.ask * 100)}%` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const frameClass =
    selected && forecastHighlight
      ? 'rounded ring-2 ring-amber-400/90 outline outline-2 outline-white/75 -outline-offset-1'
      : forecastHighlight
        ? 'rounded ring-2 ring-amber-400/90'
        : selected
          ? 'rounded ring-2 ring-white/70'
          : '';

  return (
    <button
      type="button"
      {...(selected ? { 'data-temp-odds-bar-selected': '' } : {})}
      className={`no-drag flex flex-col items-center justify-end flex-1 min-w-0 h-full px-0.5 group outline-none focus:outline-none ${frameClass}`}
      onClick={onClick}
      title={[marketTitle, quoteTip, entryTip, ...orderTips, forecastHighlight ? 'WU hourly forecast' : null]
        .filter(Boolean)
        .join(' · ')}
    >
      {showProb ? (
        <span className="text-[9px] text-gray-400 mb-0.5 tabular-nums shrink-0 min-h-[12px] leading-none flex w-full gap-0.5">
          <span className="flex-1 text-center opacity-60">
            {modelPct != null ? `${Math.round(modelPct * 100)}%` : '—'}
          </span>
          <span className="flex-1 text-center">{pct != null ? `${Math.round(pct * 100)}%` : '—'}</span>
        </span>
      ) : null}
      <div className="relative w-full shrink-0 flex-1 min-h-0 flex items-end">
        <div className="relative w-full flex gap-0.5 items-end" style={{ height: trackPx }}>
          <div className="relative flex-1 min-w-0 h-full">
            {modelBarPx > 0 ? (
              <div
                className={`absolute bottom-0 left-0 right-0 rounded-t-sm pointer-events-none ${modelBarColor}`}
                style={{ height: modelBarPx }}
              />
            ) : null}
          </div>
          <div className="relative flex-1 min-w-0 h-full">
            {marketBar}
          </div>
          {levelMarks}
        </div>
      </div>
      {showLabel ? (
        <span
          className={`text-[8px] mt-1 truncate max-w-full leading-tight shrink-0 min-h-[10px] ${
            forecastHighlight
              ? `font-bold text-amber-300${selected ? ' underline decoration-white/70 underline-offset-2' : ''}`
              : selected
                ? 'font-semibold text-white/90'
                : 'text-gray-500'
          }`}
        >
          {label}
        </span>
      ) : null}
    </button>
  );
}

interface TempOddsChartProps {
  barColor: string;
  barSpreadColor: string;
  modelBarColor: string;
  grid: WeatherGridData | null;
  dateCol: DateCol | undefined;
  selectedMarketId: string;
  onBarClick: (market: Market) => void;
  positions: Position[];
  liveTradesSource: string;
  onchainWsPositions: WSPosition[];
  modelBuckets: Record<string, number> | null | undefined;
  orderLookup: Record<string, Order[]>;
  forecastTempC: number | null;
}

function TempOddsChart({
  barColor,
  barSpreadColor,
  modelBarColor,
  grid,
  dateCol,
  selectedMarketId,
  onBarClick,
  positions,
  liveTradesSource,
  onchainWsPositions,
  modelBuckets,
  orderLookup,
  forecastTempC,
}: TempOddsChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [trackPx, setTrackPx] = useState(0);

  const buckets = useMemo(() => {
    if (!grid || !dateCol) return [];
    return grid.temps
      .map((temp) => ({
        temp,
        label: compactTempBucketLabel(temp),
        market: grid.marketLookup[temp + '_' + dateCol.slug],
      }))
      .filter((b): b is { temp: string; label: string; market: Market } => !!b.market);
  }, [grid, dateCol]);

  const { entries, maxPct } = useTempOddsBuckets(
    buckets,
    positions,
    liveTradesSource,
    onchainWsPositions,
    modelBuckets,
    orderLookup,
  );

  const hasBarSelection = useMemo(
    () => !!selectedMarketId && entries.some((e) => e.market.id === selectedMarketId),
    [entries, selectedMarketId],
  );

  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => setTrackPx(Math.max(0, el.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [buckets.length]);

  return (
    <div className="relative flex flex-col flex-1 min-w-0 min-h-0">
      <div className="flex flex-col flex-1 min-h-0 border border-gray-700/80 rounded-lg bg-gray-900/40 p-2">
        {entries.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-[10px]">No markets</div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 gap-1">
            <div className="flex shrink-0 gap-0.5 min-h-[12px]">
              {entries.map(({ temp, pct, modelPct }) => (
                <div
                  key={`prob-${temp}`}
                  className="flex-1 min-w-0 flex gap-0.5 text-[9px] text-gray-400 tabular-nums leading-none"
                >
                  <span className="flex-1 text-center opacity-60">
                    {modelPct != null ? `${Math.round(modelPct * 100)}%` : '—'}
                  </span>
                  <span className="flex-1 text-center">{pct != null ? `${Math.round(pct * 100)}%` : '—'}</span>
                </div>
              ))}
            </div>
            <div ref={plotRef} className="flex-1 min-h-[40px] flex items-end gap-0.5 overflow-visible">
              {trackPx > 0
                ? entries.map(({ temp, label, market, quote, pct, modelPct, entry, orderMarks }) => {
                    const forecastHighlight =
                      forecastTempC != null && weatherTempBucketMatchesCelsius(temp, forecastTempC);
                    return (
                    <TempOddsBar
                      key={temp}
                      label={label}
                      quote={quote}
                      pct={pct}
                      modelPct={modelPct}
                      maxPct={maxPct}
                      trackPx={trackPx}
                      barColor={barColor}
                      barSpreadColor={barSpreadColor}
                      modelBarColor={modelBarColor}
                      selected={selectedMarketId === market.id}
                      entry={entry}
                      orderMarks={orderMarks}
                      marketTitle={market.groupItemTitle || label}
                      onClick={() => onBarClick(market)}
                      showProb={false}
                      showLabel={false}
                      forecastHighlight={forecastHighlight}
                    />
                    );
                  })
                : null}
            </div>
            <div className="flex shrink-0 gap-0.5 min-h-[10px]">
              {entries.map(({ temp, label, market }) => {
                const forecastHighlight =
                  forecastTempC != null && weatherTempBucketMatchesCelsius(temp, forecastTempC);
                const selected = selectedMarketId === market.id;
                return (
                <div
                  key={`lbl-${temp}`}
                  className={`flex-1 min-w-0 text-center text-[8px] truncate leading-tight ${
                    forecastHighlight
                      ? `font-bold text-amber-300${selected ? ' underline decoration-white/70 underline-offset-2' : ''}`
                      : selected
                        ? 'font-semibold text-white/90'
                        : 'text-gray-500'
                  }`}
                >
                  {label}
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {hasBarSelection ? <TempOddsCustomButtonsPopup anchorRef={plotRef} /> : null}
    </div>
  );
}

function TempOddsTemperatureChart({
  data,
  loading,
  unit,
}: {
  data: WeatherObservationsResponse | null;
  loading: boolean;
  unit: WeatherTempUnit;
}) {
  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 border border-gray-700/80 rounded-lg bg-gray-900/40 p-2">
      <div className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-sky-400/80 mb-1">
        Hourly
      </div>
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[10px] text-gray-500">Loading…</div>
        ) : data ? (
          <TemperatureChart data={data} unit={unit} />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-gray-500">No data</div>
        )}
      </div>
    </div>
  );
}

interface TemperatureBarChartPanelProps {
  panelId: string;
  initialCity?: WeatherCitySlug;
}

function TemperatureBarChartPanelInner({ panelId, initialCity = 'london' }: TemperatureBarChartPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [city, setCity] = useState<WeatherCitySlug>(() => {
    return readStoredCity(panelId, initialCity);
  });
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [cityMenuPos, setCityMenuPos] = useState<{ top: number; left: number } | null>(null);
  const cityBtnRef = useRef<HTMLButtonElement>(null);
  const cityMenuRef = useRef<HTMLDivElement>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(() =>
    localStorage.getItem(`polybot-weather-temp-bars-date-${panelId}`),
  );
  const [pastFilterTick, setPastFilterTick] = useState(0);
  const [modelPayload, setModelPayload] = useState<WeatherProbabilitiesPayload | null>(null);
  const [modelPayloadKey, setModelPayloadKey] = useState('');
  const [modelFetchedAtMs, setModelFetchedAtMs] = useState(0);
  const [modelRefreshing, setModelRefreshing] = useState(false);
  const modelFetchGenRef = useRef(0);
  const [obsData, setObsData] = useState<WeatherObservationsResponse | null>(null);
  const [obsLoading, setObsLoading] = useState(false);
  const obsFetchGenRef = useRef(0);
  const [tempUnitOverride, setTempUnitOverride] = useState<WeatherTempUnit | null>(null);
  const [linkSidebar, setLinkSidebar] = useState(() => readStoredLinkSidebar(panelId));
  const [chartMode, setChartMode] = useState<TempOddsChartMode>(() => readStoredTempOddsChartMode(panelId));

  const setTempOddsChartMode = useCallback(
    (mode: TempOddsChartMode) => {
      setChartMode(mode);
      localStorage.setItem(`polybot-weather-temp-bars-chart-mode-${panelId}`, mode);
    },
    [panelId],
  );

  useEffect(
    () =>
      onTempOddsCitySelect(({ city: nextCity, linkSidebar: link }) => {
        if (!isWeatherCitySlug(nextCity)) return;
        setCity(nextCity);
        localStorage.setItem(`polybot-weather-temp-bars-city-${panelId}`, nextCity);
        if (link) {
          setLinkSidebar(true);
          localStorage.setItem(`polybot-weather-temp-bars-link-sidebar-${panelId}`, '1');
        }
      }),
    [panelId],
  );

  useEffect(() => {
    if (!linkSidebar) return;
    selectTempOddsCity(city, { linkSidebar: true });
  }, [city, linkSidebar]);

  const closeCityMenu = useCallback(() => {
    setCityDropdownOpen(false);
    setCityMenuPos(null);
  }, []);

  const toggleCityMenu = useCallback(() => {
    if (cityDropdownOpen) {
      closeCityMenu();
      return;
    }
    const el = cityBtnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCityMenuPos({ top: r.bottom + 4, left: r.left });
    setCityDropdownOpen(true);
  }, [cityDropdownOpen, closeCityMenu]);

  useEffect(() => {
    if (!cityDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (cityBtnRef.current?.contains(t)) return;
      if (cityMenuRef.current?.contains(t)) return;
      closeCityMenu();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [cityDropdownOpen, closeCityMenu]);

  const allMarkets = useAppStore((s) => s.weatherMarkets[city] ?? EMPTY_MARKETS);
  const cityTempUnit = useMemo(
    () => weatherCityTempUnit(city, allMarkets.map((m) => m.groupItemTitle || '')),
    [city, allMarkets],
  );
  const tempUnit = tempUnitOverride ?? cityTempUnit;

  useEffect(() => {
    setTempUnitOverride(null);
  }, [city]);

  const weatherMarketsByCity = useAppStore((s) => s.weatherMarkets);
  const weatherCityFavorites = useWeatherCityFavorites();
  const cityOptions = useMemo(
    () => sortWeatherCityOptions(mergeWeatherCityOptions(Object.keys(weatherMarketsByCity)), weatherCityFavorites),
    [weatherMarketsByCity, weatherCityFavorites],
  );
  const starredCityCount = useMemo(() => {
    const fav = new Set(weatherCityFavorites);
    let n = 0;
    for (const c of cityOptions) {
      if (!fav.has(c.slug)) break;
      n += 1;
    }
    return n;
  }, [cityOptions, weatherCityFavorites]);
  const cityMeta = cityOptions.find((c) => c.slug === city) ?? cityOptions[0] ?? WEATHER_CITIES[0];
  const expiryNow = useExpiryNow();
  const cityLocalClock = useMemo(
    () => formatWeatherCityLocalClock(expiryNow, cityMeta.timezone),
    [expiryNow, cityMeta.timezone],
  );
  const highMarkets = useMemo(() => filterWeatherMarkets(allMarkets, 'high'), [allMarkets]);
  const lowMarkets = useMemo(() => filterWeatherMarkets(allMarkets, 'low'), [allMarkets]);
  const showPast = useAppStore((s) => s.showPast);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const selectedMarketId = selectedMarket?.id ?? '';
  const [barSelectionId, setBarSelectionId] = useState('');
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const progOrderMap = useAppStore((s) => s.progOrderMap);
  const positions = useThrottledGridPositions(2000);
  const orders = useThrottledGridOrders(2000);
  const myOrders = useMemo(
    () => orders.filter((o) => !progOrderMap[o.id]),
    [orders, progOrderMap],
  );
  const orderLookup = useMemo(() => buildOrderLookup(myOrders), [myOrders]);
  const onchainWsPositions = useSidebarOnchainGridWalletPositions();
  const nowMs = useWalletTradeElapsedMs();

  useEffect(() => {
    if (showPast) return;
    const id = window.setInterval(() => setPastFilterTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [showPast]);

  const highGrid = useMemo(
    () => (highMarkets.length > 0 ? buildTableData(highMarkets, showPast) : null),
    [highMarkets, showPast, pastFilterTick],
  );
  const lowGrid = useMemo(
    () => (lowMarkets.length > 0 ? buildTableData(lowMarkets, showPast) : null),
    [lowMarkets, showPast, pastFilterTick],
  );

  const dateColumns = useMemo(() => {
    if (!highGrid && !lowGrid) return [];
    return mergeWeatherDateColumns(highGrid?.dates ?? [], lowGrid?.dates ?? []);
  }, [highGrid, lowGrid]);

  const selectedDateCol = useMemo(() => {
    if (dateColumns.length === 0) return undefined;
    if (selectedDateKey) {
      const hit = dateColumns.find((d) => weatherDateColKey(d) === selectedDateKey);
      if (hit) return hit;
      const legacyHit = dateColumns.find((d) => {
        const t = new Date(d.endDate).getTime();
        return Number.isFinite(t) && String(t) === selectedDateKey;
      });
      if (legacyHit) return legacyHit;
      if (linkSidebar) return undefined;
    }
    return dateColumns[0];
  }, [dateColumns, selectedDateKey, linkSidebar]);

  useEffect(() => {
    if (!selectedDateCol || linkSidebar) return;
    const key = weatherDateColKey(selectedDateCol);
    setSelectedDateKey((prev) => (prev === key ? prev : key));
    localStorage.setItem(`polybot-weather-temp-bars-date-${panelId}`, key);
  }, [selectedDateCol, panelId, linkSidebar]);

  const unlinkSidebar = useCallback(() => {
    setLinkSidebar(false);
    localStorage.setItem(`polybot-weather-temp-bars-link-sidebar-${panelId}`, '0');
  }, [panelId]);

  const toggleLinkSidebar = useCallback(() => {
    setLinkSidebar((prev) => {
      const next = !prev;
      localStorage.setItem(`polybot-weather-temp-bars-link-sidebar-${panelId}`, next ? '1' : '0');
      return next;
    });
  }, [panelId]);

  useEffect(() => {
    if (!linkSidebar) return;
    const ctx = weatherMarketCityAndDate(selectedMarket);
    if (!ctx) return;
    const mode = weatherMarketTempOddsMode(selectedMarket);
    if (mode) setTempOddsChartMode(mode);
    setCity((prev) => {
      if (prev === ctx.city) return prev;
      localStorage.setItem(`polybot-weather-temp-bars-city-${panelId}`, ctx.city);
      return ctx.city;
    });
    setSelectedDateKey((prev) => {
      if (prev === ctx.dateIso) return prev;
      localStorage.setItem(`polybot-weather-temp-bars-date-${panelId}`, ctx.dateIso);
      return ctx.dateIso;
    });
  }, [linkSidebar, selectedMarket, panelId, setTempOddsChartMode]);

  const selectDate = useCallback(
    (d: DateCol) => {
      const key = weatherDateColKey(d);
      setSelectedDateKey(key);
      localStorage.setItem(`polybot-weather-temp-bars-date-${panelId}`, key);
    },
    [panelId],
  );

  const modelContextKey = useMemo(
    () => weatherModelContextKey(city, selectedDateCol),
    [city, selectedDateCol],
  );

  useEffect(() => {
    setModelPayload(null);
    setModelPayloadKey('');
    setModelFetchedAtMs(0);
  }, [modelContextKey]);

  const predictionUpdatedMs = useMemo(() => {
    if (!modelPayload || modelPayloadKey !== modelContextKey || !modelContextKey) return 0;
    return weatherPayloadUpdatedMs(modelPayload, modelFetchedAtMs);
  }, [modelPayload, modelPayloadKey, modelContextKey, modelFetchedAtMs]);

  const predictionAgeLabel = useMemo(() => {
    if (predictionUpdatedMs <= 0) return null;
    return formatElapsedSinceMs(predictionUpdatedMs, nowMs) || null;
  }, [predictionUpdatedMs, nowMs]);

  const predictionAgeClass = useMemo(() => {
    if (predictionUpdatedMs <= 0) return 'text-gray-500';
    const ageSec = Math.max(0, Math.floor((nowMs - predictionUpdatedMs) / 1000));
    return tradeElapsedColorClass(ageSec);
  }, [predictionUpdatedMs, nowMs]);

  const marketExpiryMs = useMemo(() => {
    if (!selectedDateCol?.slug) return null;
    return weatherMarketExpiryMsForEvent(city, selectedDateCol.slug);
  }, [city, selectedDateCol?.slug]);

  const expiryCountdown = useMemo(() => {
    if (marketExpiryMs == null) return null;
    return formatMarketCountdown(new Date(marketExpiryMs).toISOString(), expiryNow);
  }, [marketExpiryMs, expiryNow]);

  const expiryCountdownClass = useMemo(() => {
    if (!expiryCountdown?.text) return 'text-gray-500';
    if (expiryCountdown.text === 'Expired') return 'text-red-400';
    if (expiryCountdown.remaining < 60000) return 'text-red-400';
    if (expiryCountdown.remaining > 300000) return 'text-green-400';
    return 'text-yellow-400';
  }, [expiryCountdown]);

  const highDateCol = useMemo(
    () => (highGrid && selectedDateCol ? findDateColForEndDate(highGrid.dates, selectedDateCol) : undefined),
    [highGrid, selectedDateCol],
  );
  const lowDateCol = useMemo(
    () => (lowGrid && selectedDateCol ? findDateColForEndDate(lowGrid.dates, selectedDateCol) : undefined),
    [lowGrid, selectedDateCol],
  );

  const lowBarMarkets = useMemo(() => barMarketsForGrid(lowGrid, lowDateCol), [lowGrid, lowDateCol]);
  const highBarMarkets = useMemo(() => barMarketsForGrid(highGrid, highDateCol), [highGrid, highDateCol]);
  const activeBarMarkets = chartMode === 'low' ? lowBarMarkets : highBarMarkets;
  const activeGrid = chartMode === 'low' ? lowGrid : highGrid;
  const activeDateCol = chartMode === 'low' ? lowDateCol : highDateCol;

  useEffect(() => {
    const id = selectedMarketId;
    if (!id && !selectedMarket) {
      setBarSelectionId('');
      return;
    }
    const inActive = findWeatherBarMarket(activeBarMarkets, id, selectedMarket);
    if (inActive) {
      setBarSelectionId(inActive.id);
      return;
    }
    const otherMarkets = chartMode === 'low' ? highBarMarkets : lowBarMarkets;
    const inOther = findWeatherBarMarket(otherMarkets, id, selectedMarket);
    if (inOther) {
      setTempOddsChartMode(chartMode === 'low' ? 'high' : 'low');
      setBarSelectionId(inOther.id);
      return;
    }
  }, [
    selectedMarketId,
    selectedMarket,
    activeBarMarkets,
    highBarMarkets,
    lowBarMarkets,
    chartMode,
    setTempOddsChartMode,
  ]);

  useEffect(() => {
    if (!barSelectionId) return;
    if (findWeatherBarMarket(activeBarMarkets, barSelectionId, selectedMarket)) return;
    // Keep highlight while city/date/mode catch up after TPO click.
    if (selectedMarketId && weatherMarketCityAndDate(selectedMarket)) return;
    setBarSelectionId('');
  }, [barSelectionId, activeBarMarkets, selectedMarketId, selectedMarket]);

  useEffect(() => {
    bumpCustomSidebarButtonsStore();
  }, []);

  const selectedObsDate = useMemo(() => {
    if (!selectedDateCol) return null;
    return weatherEventDateISOFromSlug(selectedDateCol.slug);
  }, [selectedDateCol]);

  useEffect(() => {
    selectTempOddsDate(selectedObsDate);
  }, [selectedObsDate]);

  const resolutionUrl = useMemo(
    () => weatherCityResolutionUrl(city, selectedObsDate),
    [city, selectedObsDate],
  );
  const resolutionTitle = 'Weather Underground hourly';

  const refreshModelProbabilities = useCallback(async () => {
    const ctx = modelContextKey;
    if (!ctx) {
      setModelPayload(null);
      setModelPayloadKey('');
      setModelFetchedAtMs(0);
      return;
    }
    const sep = ctx.indexOf('\0');
    const fetchCity = ctx.slice(0, sep) as WeatherCitySlug;
    const date = ctx.slice(sep + 1);
    if (!fetchCity || !date) {
      setModelPayload(null);
      setModelPayloadKey('');
      setModelFetchedAtMs(0);
      return;
    }
    const gen = ++modelFetchGenRef.current;
    setModelRefreshing(true);
    try {
      const payload = await fetchWeatherProbabilities(fetchCity, date);
      if (modelFetchGenRef.current !== gen) return;
      setModelPayload(payload);
      setModelPayloadKey(payload ? ctx : '');
      setModelFetchedAtMs(payload ? Date.now() : 0);
    } catch (err) {
      if (modelFetchGenRef.current !== gen) return;
      console.error('[weather-probabilities]', err);
      setModelPayload(null);
      setModelPayloadKey('');
      setModelFetchedAtMs(0);
    } finally {
      if (modelFetchGenRef.current === gen) setModelRefreshing(false);
    }
  }, [modelContextKey]);

  useEffect(() => {
    void refreshModelProbabilities();
  }, [refreshModelProbabilities]);

  useEffect(() => {
    if (!selectedObsDate) {
      setObsData(null);
      return;
    }
    let cancelled = false;
    const gen = ++obsFetchGenRef.current;

    const load = (opts?: { history?: boolean; silent?: boolean }) => {
      if (!opts?.silent) setObsLoading(true);
      void fetchWeatherObservations(city, selectedObsDate, { history: opts?.history })
        .then((resp) => {
          if (cancelled || obsFetchGenRef.current !== gen) return;
          if (opts?.history) {
            setObsData((prev) => (prev ? { ...prev, forecastHistory: resp.forecastHistory } : resp));
            return;
          }
          setObsData(resp);
        })
        .catch((e) => {
          if (cancelled || obsFetchGenRef.current !== gen) return;
          if (!opts?.history) {
            console.error('[weather-observations]', e);
            setObsData(null);
          }
        })
        .finally(() => {
          if (!cancelled && obsFetchGenRef.current === gen && !opts?.silent && !opts?.history) {
            setObsLoading(false);
          }
        });
    };

    load();
    void fetchWeatherObservations(city, selectedObsDate, { history: true })
      .then((resp) => {
        if (cancelled || obsFetchGenRef.current !== gen) return;
        setObsData((prev) => (prev ? { ...prev, forecastHistory: resp.forecastHistory } : resp));
      })
      .catch(() => {});
    const pollMs = isWeatherDateTodayInTimezone(selectedObsDate, cityMeta.timezone) ? 60_000 : 0;
    const pollId = pollMs > 0 ? window.setInterval(() => load({ silent: true }), pollMs) : undefined;
    return () => {
      cancelled = true;
      if (pollId != null) window.clearInterval(pollId);
    };
  }, [city, selectedObsDate, cityMeta.timezone]);

  const syncSelectedBarFocus = useCallback(() => {
    const el = panelRef.current?.querySelector('[data-temp-odds-bar-selected]') as HTMLButtonElement | null;
    el?.focus({ preventScroll: true });
    return el;
  }, []);

  const handleBarClick = useCallback(
    (market: Market) => {
      setBarSelectionId(market.id);
      setSelectedMarket(market);
      setSidebarOutcome('YES');
      setSidebarOpen(true);
      queueMicrotask(() => syncSelectedBarFocus());
    },
    [setSelectedMarket, setSidebarOpen, setSidebarOutcome, syncSelectedBarFocus],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreTempOddsKey(e)) return;
      const dir = tempOddsBarDirFromKey(e.key);
      if (dir == null) return;

      const inPanel = panelRef.current?.contains(document.activeElement) ?? false;
      const inActive = activeBarMarkets.some((m) => m.id === barSelectionId);
      if (!inActive && !inPanel) return;

      const markets = activeBarMarkets;
      if (markets.length === 0) return;

      let idx = markets.findIndex((m) => m.id === barSelectionId);
      if (idx === -1) idx = dir === 1 ? -1 : markets.length;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= markets.length) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      const next = markets[nextIdx]!;
      setBarSelectionId(next.id);
      setSelectedMarket(next);
      setSidebarOutcome('YES');
      setSidebarOpen(true);
      queueMicrotask(() => syncSelectedBarFocus());
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [barSelectionId, activeBarMarkets, setSelectedMarket, setSidebarOpen, setSidebarOutcome, syncSelectedBarFocus]);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      data-temp-odds-panel=""
      className="panel-wrapper bg-gray-800/50 rounded-lg p-3 h-full flex flex-col min-h-0 outline-none"
      onMouseDown={() => panelRef.current?.focus({ preventScroll: true })}
    >
      <div className="panel-header relative z-30 mb-2 flex shrink-0 cursor-grab items-center gap-2 min-w-0">
        <span className="shrink-0 text-xs font-bold text-gray-500">Temp Odds</span>

        <button
          ref={cityBtnRef}
          type="button"
          className="no-drag relative inline-flex shrink-0 items-center text-sm font-bold text-sky-400"
          onClick={toggleCityMenu}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {cityMeta.label}
          <svg className="w-3 h-3 ml-0.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {resolutionUrl ? (
          <a
            href={resolutionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="no-drag inline-flex shrink-0 items-center rounded p-0.5 text-gray-400 hover:text-sky-300"
            title={resolutionTitle}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : null}

        <TempUnitToggle unit={tempUnit} onChange={setTempUnitOverride} />

        <div className="no-drag inline-flex overflow-hidden rounded border border-gray-600 divide-x divide-gray-600 bg-gray-900/90">
          <button
            type="button"
            title="Low temp markets"
            className={`px-1.5 py-0.5 text-[9px] font-bold ${
              chartMode === 'low' ? 'bg-cyan-700/80 text-white' : 'text-gray-400 hover:text-cyan-300'
            }`}
            onClick={() => setTempOddsChartMode('low')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            Low Temp
          </button>
          <button
            type="button"
            title="High temp markets"
            className={`px-1.5 py-0.5 text-[9px] font-bold ${
              chartMode === 'high' ? 'bg-red-700/80 text-white' : 'text-gray-400 hover:text-red-300'
            }`}
            onClick={() => setTempOddsChartMode('high')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            High Temp
          </button>
        </div>

        <span
          className="shrink-0 text-[10px] font-normal tabular-nums text-gray-400"
          title={`Local time (${cityMeta.timezone.replace(/_/g, ' ')})`}
        >
          {cityLocalClock}
        </span>

        {dateColumns.length > 0 ? (
          <div className="no-drag flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {dateColumns.map((d) => {
              const key = weatherDateColKey(d);
              const selected =
                !!selectedDateCol && key === weatherDateColKey(selectedDateCol);
              const isEnded = d.expiryEndDate && new Date(d.expiryEndDate).getTime() < Date.now();
              const isWeekend = isWeatherDateColWeekend(d);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectDate(d)}
                  className={`whitespace-nowrap rounded border px-2 py-0.5 text-[10px] font-bold tabular-nums transition-colors ${
                    selected
                      ? 'border-sky-500 bg-sky-600/50 text-white'
                      : 'border-gray-700 bg-gray-800/80 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                  } ${isEnded ? 'opacity-50' : ''} ${isWeekend && !selected ? 'text-purple-400' : ''}`}
                >
                  {formatWeatherDateColHeader(d)}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="min-w-6 flex-1 basis-6 self-stretch" aria-hidden />
        )}

        <span className="min-w-6 w-6 shrink-0 self-stretch cursor-grab" aria-hidden />

        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
          {expiryCountdown?.text ? (
            <span
              className={`whitespace-nowrap text-[10px] font-normal tabular-nums ${expiryCountdownClass}`}
              title="Time until market expiry (local midnight after event day)"
            >
              {expiryCountdown.text}
            </span>
          ) : null}
          {predictionAgeLabel ? (
            <span className={`whitespace-nowrap text-[10px] font-normal tabular-nums ${predictionAgeClass}`}>
              {predictionAgeLabel}
            </span>
          ) : null}
          <button
            type="button"
            title={
              linkSidebar
                ? 'Linked to sidebar weather market — click to unlink'
                : 'Link city and date to sidebar weather market'
            }
            aria-pressed={linkSidebar}
            aria-label={linkSidebar ? 'Unlink from sidebar market' : 'Link to sidebar weather market'}
            className={`no-drag inline-flex items-center justify-center rounded border border-gray-700 bg-gray-800/80 p-0.5 transition ${
              linkSidebar ? 'text-cyan-400 hover:bg-gray-700 hover:text-cyan-300' : 'text-gray-600 hover:bg-gray-700 hover:text-gray-400'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              toggleLinkSidebar();
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {linkSidebar ? (
              <Link2 className="h-3 w-3" strokeWidth={2.25} aria-hidden />
            ) : (
              <Link2Off className="h-3 w-3" strokeWidth={2.25} aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={() => void refreshModelProbabilities()}
            disabled={modelRefreshing || !selectedDateCol}
            className="no-drag inline-flex items-center justify-center rounded border border-gray-700 bg-gray-800/80 p-0.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200 disabled:opacity-40"
            title="Refresh predictions"
          >
            <RefreshCw className={`h-3 w-3 ${modelRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {cityDropdownOpen && cityMenuPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={cityMenuRef}
              className="fixed z-[9999] max-h-48 min-w-[140px] overflow-y-auto rounded border border-gray-600 bg-gray-800 shadow-lg"
              style={{ top: cityMenuPos.top, left: cityMenuPos.left }}
            >
              <WeatherCityMenu
                cities={cityOptions}
                selectedSlug={city}
                starredCount={starredCityCount}
                onSelect={(slug) => {
                  if (linkSidebar) unlinkSidebar();
                  setCity(slug);
                  localStorage.setItem(`polybot-weather-temp-bars-city-${panelId}`, slug);
                  closeCityMenu();
                }}
              />
            </div>,
            document.body,
          )
        : null}

      <div className="panel-body flex-1 min-h-0 flex gap-2">
        {allMarkets.length === 0 ? (
          <div className="text-gray-500 text-center py-2 text-xs w-full">No weather markets</div>
        ) : dateColumns.length === 0 ? (
          <div className="text-gray-500 text-center py-2 text-xs w-full">No active markets</div>
        ) : (
          <>
            {activeGrid && activeDateCol ? (
              <TempOddsChart
                barColor={chartMode === 'low' ? 'bg-cyan-400/90' : 'bg-red-400/90'}
                barSpreadColor={chartMode === 'low' ? 'bg-cyan-400/40' : 'bg-red-400/40'}
                modelBarColor={chartMode === 'low' ? 'bg-teal-400/50' : 'bg-amber-400/50'}
                grid={activeGrid}
                dateCol={activeDateCol}
                selectedMarketId={barSelectionId}
                onBarClick={handleBarClick}
                positions={positions}
                liveTradesSource={liveTradesSource}
                onchainWsPositions={onchainWsPositions}
                modelBuckets={
                  chartMode === 'low'
                    ? modelPayload?.lowest_temperature?.bucket_probabilities_1c
                    : modelPayload?.highest_temperature?.bucket_probabilities_1c
                }
                orderLookup={orderLookup}
                forecastTempC={chartMode === 'low' ? weatherHighlightLowC(obsData) : weatherHighlightHighC(obsData)}
              />
            ) : (
              <div className="flex flex-1 min-w-0 items-center justify-center text-xs text-gray-500">
                No {chartMode === 'low' ? 'low' : 'high'} temp markets
              </div>
            )}
            <TempOddsTemperatureChart data={obsData} loading={obsLoading} unit={tempUnit} />
          </>
        )}
      </div>
    </div>
  );
}

export const TemperatureBarChartPanel = memo(TemperatureBarChartPanelInner);
