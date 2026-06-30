import { ExternalLink, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../stores/appStore';
import { formatElapsedSinceMs, getOrderClobTokenId, normalizeClobTokenId, tradeElapsedColorClass } from '../../utils/format';
import { useWalletTradeElapsedMs } from '../../lib/walletTradeElapsedStore';
import { useExpiryNow } from '../../hooks/useExpiryNow';
import { formatMarketCountdown } from '../../lib/marketCountdown';
import { weatherMarketExpiryMsForEvent } from '../../lib/weatherMarketExpiry';
import type { Market, Order, WeatherCitySlug } from '../../types';
import { WEATHER_CITIES } from '../../types';
import {
  formatWeatherCityLocalClock,
  isWeatherCitySlug,
  mergeWeatherCityOptions,
  weatherCityTempUnit,
  weatherCityWundergroundHourlyUrl,
} from '../../lib/weatherCities';
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
import { outcomeBestAskProb, outcomeBestBidProb, outcomeMidOrOneSideProb } from '../../lib/outcomeQuote';
import { resolveLegPositionForToken } from '../../lib/sidebarMyPositions';
import { useSidebarOnchainGridWalletPositions } from '../../lib/sidebarOnchainTradesStore';
import { getGridBidAskPairSnapshot } from '../../hooks/useThrottledBidAskPair';
import {
  getBidAskGridFlushDigest,
  subscribeBidAskMarketLookupGridFlush,
} from '../../lib/bidAskMarketLookup';
import { useThrottledGridOrders, useThrottledGridPositions } from '../../hooks/useThrottledGridWallet';
import type { Position } from '../../types';
import type { WSPosition } from '../../hooks/useOnchainTradesWS';

const EMPTY_MARKETS: Market[] = [];

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
  const ws = getGridBidAskPairSnapshot(yesTokenId, noTokenId);
  const lookup: Record<string, Market> = {};
  if (yesTokenId) lookup[yesTokenId] = (ws.yes as Market | undefined) ?? market;
  if (noTokenId && ws.no) lookup[noTokenId] = ws.no;
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
  const maxPct = Math.max(
    0.001,
    ...entries.flatMap((e) => [...quoteScaleLevels(e.quote), e.modelPct ?? 0]),
  );
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
  const digest = useSyncExternalStore(
    subscribeBidAskMarketLookupGridFlush,
    getBidAskGridFlushDigest,
    getBidAskGridFlushDigest,
  );
  return useMemo(
    () => buildTempOddsBuckets(buckets, positions, liveTradesSource, onchainWsPositions, modelBuckets, orderLookup),
    [buckets, positions, liveTradesSource, onchainWsPositions, modelBuckets, orderLookup, digest],
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
    modelPct != null && maxPct > 0 ? Math.max(2, (modelPct / maxPct) * trackPx) : 0;
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

  return (
    <button
      type="button"
      className={`no-drag flex flex-col items-center justify-end flex-1 min-w-0 h-full px-0.5 group ${
        forecastHighlight
          ? 'ring-2 ring-amber-400/90 rounded'
          : selected
            ? 'ring-1 ring-white/40 rounded'
            : ''
      }`}
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
            forecastHighlight ? 'font-bold text-amber-300' : 'text-gray-500'
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
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
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
            <div ref={plotRef} className="flex-1 min-h-[40px] flex items-end gap-0.5">
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
              {entries.map(({ temp, label }) => {
                const forecastHighlight =
                  forecastTempC != null && weatherTempBucketMatchesCelsius(temp, forecastTempC);
                return (
                <div
                  key={`lbl-${temp}`}
                  className={`flex-1 min-w-0 text-center text-[8px] truncate leading-tight ${
                    forecastHighlight ? 'font-bold text-amber-300' : 'text-gray-500'
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
  const selectedMarketId = useAppStore((s) => s.selectedMarket?.id ?? '');
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
    }
    return dateColumns[0];
  }, [dateColumns, selectedDateKey]);

  useEffect(() => {
    if (!selectedDateCol) return;
    const key = weatherDateColKey(selectedDateCol);
    setSelectedDateKey((prev) => (prev === key ? prev : key));
    localStorage.setItem(`polybot-weather-temp-bars-date-${panelId}`, key);
  }, [selectedDateCol, panelId]);

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

  const selectedObsDate = useMemo(() => {
    if (!selectedDateCol) return null;
    return weatherEventDateISOFromSlug(selectedDateCol.slug);
  }, [selectedDateCol]);

  const wundergroundHourlyUrl = useMemo(
    () => weatherCityWundergroundHourlyUrl(city, selectedObsDate),
    [city, selectedObsDate],
  );

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

    const load = () => {
      setObsLoading(true);
      void fetchWeatherObservations(city, selectedObsDate)
        .then((resp) => {
          if (cancelled || obsFetchGenRef.current !== gen) return;
          setObsData(resp);
        })
        .catch((e) => {
          if (cancelled || obsFetchGenRef.current !== gen) return;
          console.error('[weather-observations]', e);
          setObsData(null);
        })
        .finally(() => {
          if (!cancelled && obsFetchGenRef.current === gen) setObsLoading(false);
        });
    };

    load();
    const pollMs = isWeatherDateTodayInTimezone(selectedObsDate, cityMeta.timezone) ? 60_000 : 0;
    const pollId = pollMs > 0 ? window.setInterval(load, pollMs) : undefined;
    return () => {
      cancelled = true;
      if (pollId != null) window.clearInterval(pollId);
    };
  }, [city, selectedObsDate, cityMeta.timezone]);

  const handleBarClick = useCallback(
    (market: Market) => {
      setSelectedMarket(market);
      setSidebarOutcome('YES');
      setSidebarOpen(true);
    },
    [setSelectedMarket, setSidebarOpen, setSidebarOutcome],
  );

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 h-full flex flex-col min-h-0">
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

        {wundergroundHourlyUrl ? (
          <a
            href={wundergroundHourlyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="no-drag inline-flex shrink-0 items-center rounded p-0.5 text-gray-400 hover:text-sky-300"
            title="Weather Underground hourly"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : null}

        <TempUnitToggle unit={tempUnit} onChange={setTempUnitOverride} />

        <span
          className="shrink-0 text-[10px] font-normal tabular-nums text-gray-400"
          title={`Local time (${cityMeta.timezone.replace(/_/g, ' ')})`}
        >
          {cityLocalClock}
        </span>

        {dateColumns.length > 0 ? (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
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
        ) : null}

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
            <TempOddsChart
              barColor="bg-cyan-400/90"
              barSpreadColor="bg-cyan-400/40"
              modelBarColor="bg-teal-400/50"
              grid={lowGrid}
              dateCol={lowDateCol}
              selectedMarketId={selectedMarketId}
              onBarClick={handleBarClick}
              positions={positions}
              liveTradesSource={liveTradesSource}
              onchainWsPositions={onchainWsPositions}
              modelBuckets={modelPayload?.lowest_temperature?.bucket_probabilities_1c}
              orderLookup={orderLookup}
              forecastTempC={weatherHighlightLowC(obsData)}
            />
            <TempOddsChart
              barColor="bg-red-400/90"
              barSpreadColor="bg-red-400/40"
              modelBarColor="bg-amber-400/50"
              grid={highGrid}
              dateCol={highDateCol}
              selectedMarketId={selectedMarketId}
              onBarClick={handleBarClick}
              positions={positions}
              liveTradesSource={liveTradesSource}
              onchainWsPositions={onchainWsPositions}
              modelBuckets={modelPayload?.highest_temperature?.bucket_probabilities_1c}
              orderLookup={orderLookup}
              forecastTempC={weatherHighlightHighC(obsData)}
            />
            <TempOddsTemperatureChart data={obsData} loading={obsLoading} unit={tempUnit} />
          </>
        )}
      </div>
    </div>
  );
}

export const TemperatureBarChartPanel = memo(TemperatureBarChartPanelInner);
