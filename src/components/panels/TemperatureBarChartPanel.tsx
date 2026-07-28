import { Link2, Link2Off, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, startTransition, type ReactNode } from 'react';
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
import { onTempOddsCitySelect, selectTempOddsCity, selectTempOddsDate, selectTempOddsMetric } from '../../lib/weatherTempOddsControl';
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
  weatherTempBucketRuledOutByObs,
  type DateCol,
  type WeatherGridData,
  type WeatherMetric,
} from '../../lib/weatherMarketsGrid';
import {
  fetchMarketsStakedLegs,
  fetchOrderbook,
  fetchWeatherProbabilities,
  placeOrder,
  type WeatherForecastSourceId,
  type WeatherProbabilitiesPayload,
} from '../../api';
import { triggerWalletRefresh } from '../../lib/clobClient';
import { walkAsksForShares } from '../../lib/orderbookWalk';
import { useTradingWalletAddress } from '../../hooks/useTradingWalletAddress';
import { showToast } from '../../utils/toast';
import {
  fetchWeatherObservations,
  floorDisplayTemp,
  isWeatherDateTodayInTimezone,
  obsTempToCelsius,
  weatherHighlightHighC,
  weatherHighlightLowC,
  weatherObsWithForecastSource,
  type WeatherForecastSourceId as ObsForecastSourceId,
  type WeatherObservationsResponse,
  type WeatherTempUnit,
} from '../../lib/weatherObservations';
import { TempUnitToggle, TemperatureChart } from '../TemperatureChart';
import { WeatherMetarDialog } from '../WeatherMetarDialog';
import { outcomeBestAskProb, outcomeBestBidProb, outcomeMidOrOneSideProb } from '../../lib/outcomeQuote';
import { resolveLegPositionForToken } from '../../lib/sidebarMyPositions';
import { useThrottledSidebarOnchainGridWalletPositions } from '../../lib/sidebarOnchainTradesStore';
import { getBidAskMarketRow, subscribeBidAskMarketLookupGridFlush } from '../../lib/bidAskMarketLookup';
import { setChartBidAskExtraTokens } from '../../lib/chartWsShared';
import { useThrottledGridOrders, useThrottledGridPositions } from '../../hooks/useThrottledGridWallet';
import type { Position } from '../../types';
import type { WSPosition } from '../../hooks/useOnchainTradesWS';

type ForecastSourceToggle = WeatherForecastSourceId;

function modelBucketsFromPayload(
  payload: WeatherProbabilitiesPayload | null | undefined,
  source: ForecastSourceToggle,
  metric: WeatherMetric,
): Record<string, number> | null {
  const srcPayload = payload?.by_source?.[source] ?? (payload?.forecast_source === source ? payload : null);
  const flat = srcPayload ?? (source === 'open-meteo' ? payload : null);
  if (!flat) return null;
  const field = metric === 'low' ? flat.lowest_temperature : flat.highest_temperature;
  return field?.bucket_probabilities_1c ?? null;
}

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

function readStoredForecastSource(panelId: string): ForecastSourceToggle {
  const v = localStorage.getItem(`polybot-weather-temp-bars-forecast-source-${panelId}`);
  return v === 'weather-company' ? 'weather-company' : 'open-meteo';
}

type TempOddsOutcomeView = 'YES' | 'NO';

function readStoredOutcomeView(panelId: string): TempOddsOutcomeView {
  const v = localStorage.getItem(`polybot-weather-temp-bars-outcome-${panelId}`);
  return v === 'NO' ? 'NO' : 'YES';
}

function readStoredBucketTrade(panelId: string): boolean {
  return localStorage.getItem(`polybot-weather-temp-bars-bucket-trade-${panelId}`) === '1';
}

function flipProb01(p: number | null): number | null {
  if (p == null || !Number.isFinite(p)) return null;
  return Math.max(0, Math.min(1, 1 - p));
}

function bucketTradeTokenId(market: Market, view: TempOddsOutcomeView): string {
  const ids = market.clobTokenIds || [];
  return ((view === 'NO' ? ids[1] : ids[0]) || '').trim();
}

function orderNotionalUsd(priceDecimal: number, size: number): number {
  if (!Number.isFinite(priceDecimal) || !Number.isFinite(size) || size <= 0 || priceDecimal <= 0) return 0;
  return priceDecimal * size;
}

function maxOrderUsdViolationMessage(maxUsd: number, valueUsd: number): string | null {
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) return null;
  if (!Number.isFinite(valueUsd) || valueUsd <= maxUsd) return null;
  const lim =
    Number.isInteger(maxUsd) || Math.abs(maxUsd - Math.round(maxUsd)) < 1e-9
      ? String(Math.round(maxUsd))
      : maxUsd.toFixed(2);
  return `Max order size ${lim} USD. To increase the limit go to settings menu in the header.`;
}

function bucketAskColorClass(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return 'text-gray-400';
  if (cents > 100) return 'text-red-400';
  if (cents >= 95) return 'text-yellow-400';
  return 'text-green-400';
}

function marketLimitExpirationSec(endDate?: string): number | undefined {
  const end = String(endDate || '').trim();
  if (!end) return undefined;
  const endSec = Math.floor(new Date(end).getTime() / 1000);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(endSec) || endSec <= nowSec + 60) return undefined;
  return endSec;
}

const BUCKET_LIMIT_MAX_CENTS = 99;
const BUCKET_PRICE_DELTA_DEFAULT_CENTS = 10;

function readStoredBucketPriceDelta(panelId: string): number {
  try {
    const saved = localStorage.getItem(`polybot-weather-temp-bars-bucket-delta-${panelId}`);
    const n = parseFloat(String(saved ?? ''));
    return Number.isFinite(n) && n >= 0 ? n : BUCKET_PRICE_DELTA_DEFAULT_CENTS;
  } catch {
    return BUCKET_PRICE_DELTA_DEFAULT_CENTS;
  }
}

/** Limit = ask + Δ¢, capped at 99¢ (same as Pair Trading). */
function bucketLimitFromAskPrice(
  askPrice: number | null,
  offsetCents: number,
): { price: number; cents: number } | null {
  if (askPrice == null || !Number.isFinite(askPrice) || askPrice <= 0) return null;
  if (!Number.isFinite(offsetCents) || offsetCents < 0) return null;
  const cents = Math.min(askPrice * 100 + offsetCents, BUCKET_LIMIT_MAX_CENTS);
  return { price: cents / 100, cents };
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

type TempOddsOrderMark = {
  frac: number;
  outcome: 'YES' | 'NO';
  side: Order['side'];
  price: number;
};

function tempEntryMarkClass(outcome: 'YES' | 'NO'): string {
  return outcome === 'YES' ? 'bg-green-400' : 'bg-red-400';
}

function tempOrderMarkClass(mark: TempOddsOrderMark): string {
  if (mark.side === 'BUY' && mark.outcome === 'YES') return 'bg-purple-600';
  if (mark.side === 'BUY' && mark.outcome === 'NO') return 'bg-yellow-400';
  return 'bg-gray-400';
}

function formatTempOrderPriceLabel(price: number): string {
  // cents with 1 decimal for order guide labels
  const cents = price > 1 ? price : price * 100;
  if (!Number.isFinite(cents)) return '';
  return `${cents.toFixed(1)}¢`;
}

const MARK_LINE =
  'absolute h-[2px] pointer-events-none shadow-[0_0_2px_rgba(0,0,0,0.85)]';

function fracLevelKey(frac: number): string {
  return (frac * 10000).toFixed(0);
}

const TEMP_ODDS_BAR_MAX_PCT = 1; // bar scale max (1 = 100%)


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
    if (frac != null) return { frac, outcome: 'YES', side: order.side, price };
  }
  if (tid && noKey && tid === noKey) {
    const frac = yesChartEntryFrac(price, 'NO');
    if (frac != null) return { frac, outcome: 'NO', side: order.side, price };
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

/** YES book → NO book (noBid≈1−yesAsk, noAsk≈1−yesBid). */
function quoteForOutcomeView(yesQuote: MarketYesQuote, view: TempOddsOutcomeView): MarketYesQuote {
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

function flipYesChartFrac(frac: number, view: TempOddsOutcomeView): number {
  return view === 'NO' ? 1 - frac : frac;
}

function quoteScaleLevels(quote: MarketYesQuote): number[] {
  return [quote.bid, quote.ask, quote.mid].filter((v): v is number => v != null);
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

type TempOddsBucket = {
  temp: string;
  label: string;
  market: Market;
  quote: MarketYesQuote;
  pct: number | null;
  modelPctOm: number | null;
  modelPctWc: number | null;
  /** YES staked share: stakedNetYesUsd / (yes+no). */
  stakedPct: number | null;
  /** Bucket YES stake / Σ YES stake across city/date. */
  stakedSharePct: number | null;
  entry: { frac: number; outcome: 'YES' | 'NO' } | null;
  orderMarks: TempOddsOrderMark[];
};

/** Per-market stake snapshot for Temp Odds bars. */
type MarketStakeSnap = {
  yesProb: number | null;
  yesUsd: number;
  noUsd: number;
};

/** Module cache survives date/city flips + cancelled fetches so bars don't blink empty. */
const TEMP_ODDS_STAKE_CACHE = new Map<string, MarketStakeSnap>();
const TEMP_ODDS_STAKE_CACHE_MAX = 256;

function tempOddsStakeCacheKey(market: { id?: string; conditionId?: string }): string {
  return (market.conditionId || market.id || '').trim().toLowerCase();
}

function tempOddsStakeCacheGet(market: { id?: string; conditionId?: string }): MarketStakeSnap | null {
  const k = tempOddsStakeCacheKey(market);
  if (!k) return null;
  return TEMP_ODDS_STAKE_CACHE.get(k) ?? null;
}

function tempOddsStakeCacheSet(market: { id?: string; conditionId?: string }, snap: MarketStakeSnap): void {
  const k = tempOddsStakeCacheKey(market);
  if (!k) return;
  TEMP_ODDS_STAKE_CACHE.set(k, snap);
  if (TEMP_ODDS_STAKE_CACHE.size > TEMP_ODDS_STAKE_CACHE_MAX) {
    const first = TEMP_ODDS_STAKE_CACHE.keys().next().value;
    if (first != null) TEMP_ODDS_STAKE_CACHE.delete(first);
  }
}

function stakedYesProbFromUsd(yesUsd: unknown, noUsd: unknown): number | null {
  if (typeof yesUsd !== 'number' || typeof noUsd !== 'number') return null;
  if (!Number.isFinite(yesUsd) || !Number.isFinite(noUsd)) return null;
  const tot = yesUsd + noUsd;
  if (tot <= 0) return null;
  return yesUsd / tot;
}

function marketStakeSnapFromParts(
  yesUsd: unknown,
  noUsd: unknown,
  _sumAbsUsd: unknown,
): MarketStakeSnap | null {
  const y = typeof yesUsd === 'number' && Number.isFinite(yesUsd) && yesUsd >= 0 ? yesUsd : null;
  const n = typeof noUsd === 'number' && Number.isFinite(noUsd) && noUsd >= 0 ? noUsd : null;
  if (y == null || n == null) return null;
  if (y + n <= 0) return null;
  return { yesProb: y / (y + n), yesUsd: y, noUsd: n };
}

function hydrateStakedByMarketId(markets: Market[]): Record<string, MarketStakeSnap> {
  const out: Record<string, MarketStakeSnap> = {};
  for (const m of markets) {
    const hit = tempOddsStakeCacheGet(m);
    if (hit) out[m.id] = hit;
  }
  return out;
}

function resolveMarketStakeSnap(
  market: Market,
  restByMarketId: Record<string, MarketStakeSnap>,
): MarketStakeSnap | null {
  const rest = restByMarketId[market.id];
  const yesTokenId = market.clobTokenIds?.[0] || '';
  const row = yesTokenId ? getBidAskMarketRow(yesTokenId) : undefined;
  const ws = marketStakeSnapFromParts(
    row?.stakedNetYesUsd,
    row?.stakedNetNoUsd,
    row?.stakedSumAbsSignedNetUsd,
  );
  // REST first — weather WS shareStats often empty/zero and flickers bars off.
  if (rest && rest.yesUsd + rest.noUsd > 0) return rest;
  if (ws && ws.yesUsd + ws.noUsd > 0) return ws;
  return rest ?? ws ?? null;
}

function buildTempOddsBuckets(
  buckets: { temp: string; label: string; market: Market }[],
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
  modelBucketsOm: Record<string, number> | null | undefined,
  modelBucketsWc: Record<string, number> | null | undefined,
  stakedByMarketId: Record<string, MarketStakeSnap>,
  orderLookup: Record<string, Order[]>,
  metric: WeatherMetric,
  obsBoundC: number | null,
  outcomeView: TempOddsOutcomeView,
): { entries: TempOddsBucket[]; maxPct: number } {
  const snaps = buckets.map(({ market }) => resolveMarketStakeSnap(market, stakedByMarketId));
  // Rel = bucket stake / Σ stake for selected side across city+date.
  let citySideUsd = 0;
  for (const snap of snaps) {
    if (!snap) continue;
    const side = outcomeView === 'NO' ? snap.noUsd : snap.yesUsd;
    if (side > 0) citySideUsd += side;
  }

  const entries: TempOddsBucket[] = buckets.map(({ temp, label, market }, i) => {
    const yesTokenId = market.clobTokenIds?.[0] || '';
    const noTokenId = market.clobTokenIds?.[1] || '';
    const quote = quoteForOutcomeView(getMarketYesQuote(market), outcomeView);
    let modelPctOm = lookupModelBucketProb(modelBucketsOm, temp);
    let modelPctWc = lookupModelBucketProb(modelBucketsWc, temp);
    const snap = snaps[i];
    let stakedPct = snap?.yesProb ?? null;
    const sideUsd = snap ? (outcomeView === 'NO' ? snap.noUsd : snap.yesUsd) : 0;
    let stakedSharePct =
      citySideUsd > 0 && sideUsd > 0 ? sideUsd / citySideUsd : null;
    if (weatherTempBucketRuledOutByObs(temp, metric, obsBoundC)) {
      modelPctOm = 0;
      modelPctWc = 0;
      stakedPct = 0;
      stakedSharePct = 0;
    }
    if (outcomeView === 'NO') {
      modelPctOm = flipProb01(modelPctOm);
      modelPctWc = flipProb01(modelPctWc);
      stakedPct = flipProb01(stakedPct);
    }
    const entryRaw = marketEntryYesFrac(
      yesTokenId,
      noTokenId,
      positions,
      liveTradesSource,
      onchainWsPositions,
    );
    const entry =
      entryRaw != null
        ? { ...entryRaw, frac: flipYesChartFrac(entryRaw.frac, outcomeView) }
        : null;
    const orderMarks = marketOrderYesMarks(yesTokenId, noTokenId, orderLookup).map((m) => ({
      ...m,
      frac: flipYesChartFrac(m.frac, outcomeView),
    }));
    return {
      temp,
      label,
      market,
      quote,
      pct: quote.mid,
      modelPctOm,
      modelPctWc,
      stakedPct,
      stakedSharePct,
      entry,
      orderMarks,
    };
  });
  const maxPct = TEMP_ODDS_BAR_MAX_PCT;
  return { entries, maxPct };
}

/** TPO trades Time column age colors. */
function tempOddsForecastElapsedColor(ageMs: number): string {
  if (ageMs < 60_000) return 'text-purple-400';
  if (ageMs < 15 * 60_000) return 'text-green-400';
  if (ageMs < 60 * 60_000) return 'text-yellow-400';
  return 'text-gray-400';
}

const TempOddsElapsedLabel = memo(function TempOddsElapsedLabel({
  updatedMs,
  className,
}: {
  updatedMs: number;
  className?: string;
}) {
  const nowMs = useWalletTradeElapsedMs();
  if (updatedMs <= 0) return null;
  const label = formatElapsedSinceMs(updatedMs, nowMs);
  if (!label) return null;
  const ageSec = Math.max(0, Math.floor((nowMs - updatedMs) / 1000));
  return (
    <span className={`whitespace-nowrap text-[10px] font-normal tabular-nums ${className ?? tradeElapsedColorClass(ageSec)}`}>
      {label}
    </span>
  );
});

/** Forecast age — TPO Time colors; 5s tick isolated from chart. */
const TempOddsForecastAgeLabel = memo(function TempOddsForecastAgeLabel({ updatedMs }: { updatedMs: number }) {
  const nowMs = useWalletTradeElapsedMs();
  if (updatedMs <= 0) return null;
  const label = formatElapsedSinceMs(updatedMs, nowMs);
  if (!label) return null;
  return (
    <span
      className={`whitespace-nowrap text-[10px] font-normal tabular-nums ${tempOddsForecastElapsedColor(Math.max(0, nowMs - updatedMs))}`}
      title="Forecast last updated"
    >
      {label}
    </span>
  );
});

const TempOddsCityLocalClock = memo(function TempOddsCityLocalClock({ timezone }: { timezone: string }) {
  const now = useExpiryNow();
  return (
    <span
      className="shrink-0 text-[10px] font-normal tabular-nums text-gray-400"
      title={`Local time (${timezone.replace(/_/g, ' ')})`}
    >
      {formatWeatherCityLocalClock(now, timezone)}
    </span>
  );
});

const TempOddsExpiryCountdown = memo(function TempOddsExpiryCountdown({
  marketExpiryMs,
}: {
  marketExpiryMs: number | null;
}) {
  const now = useExpiryNow();
  const expiryCountdown = useMemo(() => {
    if (marketExpiryMs == null) return null;
    return formatMarketCountdown(new Date(marketExpiryMs).toISOString(), now);
  }, [marketExpiryMs, now]);
  const cls = useMemo(() => {
    if (!expiryCountdown?.text) return 'text-gray-500';
    if (expiryCountdown.text === 'Expired') return 'text-red-400';
    if (expiryCountdown.remaining < 60000) return 'text-red-400';
    if (expiryCountdown.remaining > 300000) return 'text-green-400';
    return 'text-yellow-400';
  }, [expiryCountdown]);
  if (!expiryCountdown?.text) return null;
  return <span className={`text-[10px] font-semibold tabular-nums ${cls}`}>{expiryCountdown.text}</span>;
});

function useTempOddsBuckets(
  buckets: { temp: string; label: string; market: Market }[],
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
  modelBucketsOm: Record<string, number> | null | undefined,
  modelBucketsWc: Record<string, number> | null | undefined,
  stakedByMarketId: Record<string, MarketStakeSnap>,
  orderLookup: Record<string, Order[]>,
  metric: WeatherMetric,
  obsBoundC: number | null,
  outcomeView: TempOddsOutcomeView,
) {
  const [quoteTick, setQuoteTick] = useState(0);
  useEffect(() => {
    // Grid flush (~2s) — live@250ms rebuilt every TempOdds bar and starved canvas rAF.
    return subscribeBidAskMarketLookupGridFlush(() => {
      startTransition(() => setQuoteTick((n) => n + 1));
    });
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
    () =>
      buildTempOddsBuckets(
        buckets,
        positions,
        liveTradesSource,
        onchainWsPositions,
        modelBucketsOm,
        modelBucketsWc,
        stakedByMarketId,
        orderLookup,
        metric,
        obsBoundC,
        outcomeView,
      ),
    [
      buckets,
      positions,
      liveTradesSource,
      onchainWsPositions,
      modelBucketsOm,
      modelBucketsWc,
      stakedByMarketId,
      orderLookup,
      metric,
      obsBoundC,
      outcomeView,
      quoteTick,
    ],
  );
}

interface TempOddsBarProps {
  label: string;
  quote: MarketYesQuote;
  pct: number | null;
  modelPctOm: number | null;
  modelPctWc: number | null;
  stakedPct: number | null;
  stakedSharePct: number | null;
  maxPct: number;
  trackPx: number;
  barColor: string;
  barSpreadColor: string;
  modelBarColorOm: string;
  modelBarColorWc: string;
  stakedBarColor: string;
  stakedShareBarColor: string;
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
  modelPctOm,
  modelPctWc,
  stakedPct,
  stakedSharePct,
  maxPct,
  trackPx,
  barColor,
  barSpreadColor,
  modelBarColorOm,
  modelBarColorWc,
  stakedBarColor,
  stakedShareBarColor,
  selected,
  entry,
  orderMarks,
  marketTitle,
  onClick,
  showProb = true,
  showLabel = true,
  forecastHighlight = false,
}: TempOddsBarProps) {
  const modelBarOmPx =
    modelPctOm != null && maxPct > 0 ? (modelPctOm / maxPct) * trackPx : 0;
  const modelBarWcPx =
    modelPctWc != null && maxPct > 0 ? (modelPctWc / maxPct) * trackPx : 0;
  const stakedBarPx =
    stakedPct != null && maxPct > 0 ? (stakedPct / maxPct) * trackPx : 0;
  const stakedShareBarPx =
    stakedSharePct != null && maxPct > 0 ? (stakedSharePct / maxPct) * trackPx : 0;
  const marketTipPx = marketBarTipPx(quote, maxPct, trackPx);
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
    (m) => `Order ${formatTempOrderPriceLabel(m.price)} (${m.outcome} ${m.side})`,
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

  const marketLabelColor = barColor.includes('cyan')
    ? 'text-cyan-400/90'
    : barColor.includes('red')
      ? 'text-red-400/90'
      : 'text-gray-300';

  const tipLabel = (text: string, tipPx: number, colorClass: string) => (
    <span
      className={`absolute left-0 right-0 z-[6] -translate-y-full text-center text-[9px] tabular-nums leading-none pointer-events-none ${colorClass}`}
      style={{ bottom: tipPx }}
    >
      {text}
    </span>
  );

  return (
    <button
      type="button"
      {...(selected ? { 'data-temp-odds-bar-selected': '' } : {})}
      className={`no-drag flex flex-col items-center justify-end flex-1 min-w-0 h-full px-0.5 group outline-none focus:outline-none ${frameClass}`}
      onClick={onClick}
      title={[
        entryTip,
        marketTitle,
        quoteTip,
        ...orderTips,
        modelPctOm != null ? `OM ${(modelPctOm * 100).toFixed(1)}%` : null,
        modelPctWc != null ? `WC ${(modelPctWc * 100).toFixed(1)}%` : null,
        stakedPct != null ? `Stk ${(stakedPct * 100).toFixed(1)}%` : null,
        stakedSharePct != null ? `Rel ${(stakedSharePct * 100).toFixed(1)}%` : null,
        forecastHighlight ? 'Forecast bucket' : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    >
      <div className="relative w-full flex-1 min-h-0 flex items-end">
        <div className="relative w-full h-full flex gap-0.5 items-end">
          <div className="relative flex-1 min-w-0 h-full">
            {modelBarOmPx > 0 ? (
              <div
                className={`absolute bottom-0 left-0 right-0 rounded-t-sm pointer-events-none ${modelBarColorOm}`}
                style={{ height: modelBarOmPx }}
              />
            ) : null}
            {showProb && modelPctOm != null
              ? tipLabel(`${(modelPctOm * 100).toFixed(0)}`, modelBarOmPx, 'text-amber-400/80')
              : null}
          </div>
          <div className="relative flex-1 min-w-0 h-full">
            {modelBarWcPx > 0 ? (
              <div
                className={`absolute bottom-0 left-0 right-0 rounded-t-sm pointer-events-none ${modelBarColorWc}`}
                style={{ height: modelBarWcPx }}
              />
            ) : null}
            {showProb && modelPctWc != null
              ? tipLabel(`${(modelPctWc * 100).toFixed(0)}`, modelBarWcPx, 'text-sky-400/80')
              : null}
          </div>
          <div className="relative flex-1 min-w-0 h-full">
            {stakedBarPx > 0 ? (
              <div
                className={`absolute bottom-0 left-0 right-0 rounded-t-sm pointer-events-none ${stakedBarColor}`}
                style={{ height: stakedBarPx }}
              />
            ) : null}
            {showProb && stakedPct != null
              ? tipLabel(`${(stakedPct * 100).toFixed(0)}`, stakedBarPx, 'text-violet-400/80')
              : null}
          </div>
          <div className="relative flex-1 min-w-0 h-full">
            {stakedShareBarPx > 0 ? (
              <div
                className={`absolute bottom-0 left-0 right-0 rounded-t-sm pointer-events-none ${stakedShareBarColor}`}
                style={{ height: stakedShareBarPx }}
              />
            ) : null}
            {showProb && stakedSharePct != null
              ? tipLabel(`${(stakedSharePct * 100).toFixed(0)}`, stakedShareBarPx, 'text-fuchsia-400/80')
              : null}
          </div>
          <div className="relative flex-1 min-w-0 h-full">
            {marketBar}
            {showProb && pct != null
              ? tipLabel(`${(pct * 100).toFixed(0)}`, marketTipPx, marketLabelColor)
              : null}
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

function TempOddsBucketTradeStrip({
  priceDeltaInput,
  onPriceDeltaInputChange,
  onCommitPriceDelta,
  orderAmount,
  onOrderAmountChange,
  askCents,
  askInsufficient,
  estCostUsd,
  selectedCount,
  placing,
  walletReady,
  onPlace,
}: {
  priceDeltaInput: string;
  onPriceDeltaInputChange: (v: string) => void;
  onCommitPriceDelta: (raw: string) => void;
  orderAmount: string;
  onOrderAmountChange: (v: string) => void;
  askCents: number | null;
  askInsufficient: boolean;
  estCostUsd: number | null;
  selectedCount: number;
  placing: boolean;
  walletReady: boolean;
  onPlace: () => void;
}) {
  return (
    <div
      className="no-drag mt-1 shrink-0 rounded border border-gray-700/80 bg-gray-950/50 p-2"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-[72px] shrink-0">
          <label className="mb-1 block text-[10px] text-gray-400">Δ price (¢)</label>
          <input
            type="number"
            value={priceDeltaInput}
            onChange={(e) => onPriceDeltaInputChange(e.target.value)}
            onBlur={() => onCommitPriceDelta(priceDeltaInput)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitPriceDelta(priceDeltaInput);
            }}
            onWheel={(e) => e.preventDefault()}
            className="order-input no-spin h-[34px] w-full"
            placeholder="10"
            min={0}
            step={0.1}
          />
        </div>
        <div className="min-w-[120px] flex-1">
          <label className="mb-1 block text-[10px] text-gray-400">Amount (shares per leg)</label>
          <input
            type="number"
            value={orderAmount}
            onChange={(e) => onOrderAmountChange(e.target.value)}
            onWheel={(e) => e.preventDefault()}
            className="order-input no-spin h-[34px] w-full"
            placeholder="100"
            min={1}
            step={1}
          />
        </div>
        <div className="rounded bg-gray-800/80 px-2 py-1 text-[10px] text-gray-400">
          <div>Ask price</div>
          <div className={`font-bold tabular-nums ${bucketAskColorClass(askCents)}`}>
            {askCents != null ? `${askCents.toFixed(1)}¢` : '—'}
          </div>
          {askInsufficient ? (
            <div className="text-[9px] font-semibold text-red-400">insufficient ask</div>
          ) : null}
        </div>
        <div className="rounded bg-gray-800/80 px-2 py-1 text-[10px] text-gray-400">
          <div>Est. cost</div>
          <div className="font-bold tabular-nums text-red-300">
            {estCostUsd != null ? `$${estCostUsd.toFixed(2)}` : '—'}
          </div>
        </div>
        <button
          type="button"
          disabled={!walletReady || placing || selectedCount === 0 || askInsufficient || askCents == null}
          onClick={onPlace}
          className="h-[34px] shrink-0 rounded-lg bg-emerald-700 px-4 text-[11px] font-bold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {placing ? 'Placing…' : 'Place Orders'}
        </button>
      </div>
      {selectedCount > 0 ? (
        <div className="mt-1 text-[9px] text-gray-500 tabular-nums">{selectedCount} leg{selectedCount === 1 ? '' : 's'} selected</div>
      ) : (
        <div className="mt-1 text-[9px] text-gray-600">Select buckets below the bars</div>
      )}
    </div>
  );
}

interface TempOddsChartProps {
  barColor: string;
  barSpreadColor: string;
  modelBarColorOm: string;
  modelBarColorWc: string;
  stakedBarColor: string;
  stakedShareBarColor: string;
  grid: WeatherGridData | null;
  dateCol: DateCol | undefined;
  selectedMarketId: string;
  onBarClick: (market: Market) => void;
  positions: Position[];
  liveTradesSource: string;
  onchainWsPositions: WSPosition[];
  modelBucketsOm: Record<string, number> | null | undefined;
  modelBucketsWc: Record<string, number> | null | undefined;
  stakedByMarketId: Record<string, MarketStakeSnap>;
  orderLookup: Record<string, Order[]>;
  forecastTempC: number | null;
  metric: WeatherMetric;
  obsBoundC: number | null;
  outcomeView: TempOddsOutcomeView;
  bucketTradeEnabled: boolean;
  bucketSelectedMarketIds: Set<string>;
  onToggleBucketMarket: (marketId: string) => void;
  bucketOrderAmount: string;
  onBucketOrderAmountChange: (v: string) => void;
  bucketPriceDeltaInput: string;
  onBucketPriceDeltaInputChange: (v: string) => void;
  onCommitBucketPriceDelta: (raw: string) => void;
  bucketPlacing: boolean;
  walletReady: boolean;
  onPlaceBucketOrders: (markets: Market[]) => void;
}

function TempOddsChart({
  barColor,
  barSpreadColor,
  modelBarColorOm,
  modelBarColorWc,
  stakedBarColor,
  stakedShareBarColor,
  grid,
  dateCol,
  selectedMarketId,
  onBarClick,
  positions,
  liveTradesSource,
  onchainWsPositions,
  modelBucketsOm,
  modelBucketsWc,
  stakedByMarketId,
  orderLookup,
  forecastTempC,
  metric,
  obsBoundC,
  outcomeView,
  bucketTradeEnabled,
  bucketSelectedMarketIds,
  onToggleBucketMarket,
  bucketOrderAmount,
  onBucketOrderAmountChange,
  bucketPriceDeltaInput,
  onBucketPriceDeltaInputChange,
  onCommitBucketPriceDelta,
  bucketPlacing,
  walletReady,
  onPlaceBucketOrders,
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
    modelBucketsOm,
    modelBucketsWc,
    stakedByMarketId,
    orderLookup,
    metric,
    obsBoundC,
    outcomeView,
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

  const selectedEntries = useMemo(
    () => entries.filter((e) => bucketSelectedMarketIds.has(e.market.id)),
    [entries, bucketSelectedMarketIds],
  );

  const bucketAskCents = useMemo(() => {
    if (selectedEntries.length === 0) return null;
    let sum = 0;
    for (const e of selectedEntries) {
      const ask = e.quote.ask;
      if (ask == null || !(ask > 0)) return null;
      sum += ask * 100;
    }
    return sum;
  }, [selectedEntries]);

  const bucketAskInsufficient =
    selectedEntries.length > 0 &&
    selectedEntries.some((e) => e.quote.ask == null || !(e.quote.ask > 0));

  const shares = parseFloat(bucketOrderAmount);
  const hasShareAmount = Number.isFinite(shares) && shares > 0;
  const bucketEstCostUsd =
    hasShareAmount && bucketAskCents != null ? (bucketAskCents / 100) * shares : null;

  return (
    <div className="relative flex flex-col flex-1 min-w-0 min-h-0">
      <div className="flex flex-col flex-1 min-h-0 border border-gray-700/80 rounded-lg bg-gray-900/40 p-2">
        {entries.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-[10px]">No markets</div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 gap-1">
            <div className="relative flex min-h-0 flex-1 items-stretch gap-0 pt-3">
              <div
                ref={plotRef}
                className="relative flex h-full min-h-0 min-w-0 flex-1 items-stretch gap-0 divide-x divide-gray-500/80 overflow-visible"
              >
                {trackPx > 0
                  ? entries.map(({ temp, label, market, quote, pct, modelPctOm, modelPctWc, stakedPct, stakedSharePct, entry, orderMarks }) => {
                      const forecastHighlight =
                        forecastTempC != null && weatherTempBucketMatchesCelsius(temp, forecastTempC);
                      return (
                      <TempOddsBar
                        key={temp}
                        label={label}
                        quote={quote}
                        pct={pct}
                        modelPctOm={modelPctOm}
                        modelPctWc={modelPctWc}
                        stakedPct={stakedPct}
                        stakedSharePct={stakedSharePct}
                        maxPct={maxPct}
                        trackPx={trackPx}
                        barColor={barColor}
                        barSpreadColor={barSpreadColor}
                        modelBarColorOm={modelBarColorOm}
                        modelBarColorWc={modelBarColorWc}
                        stakedBarColor={stakedBarColor}
                        stakedShareBarColor={stakedShareBarColor}
                        selected={selectedMarketId === market.id}
                        entry={entry}
                        orderMarks={orderMarks}
                        marketTitle={market.groupItemTitle || label}
                        onClick={() => onBarClick(market)}
                        showProb
                        showLabel={false}
                        forecastHighlight={forecastHighlight}
                      />
                      );
                    })
                  : null}
              </div>
            </div>
            <div className="flex shrink-0 gap-0 divide-x divide-gray-500/80 min-h-[10px]">
              {entries.map(({ temp, label, market }) => {
                const forecastHighlight =
                  forecastTempC != null && weatherTempBucketMatchesCelsius(temp, forecastTempC);
                const selected = selectedMarketId === market.id;
                const bucketChecked = bucketSelectedMarketIds.has(market.id);
                return (
                <div
                  key={`lbl-${temp}`}
                  className={`flex-1 min-w-0 px-0.5 text-center text-[8px] leading-tight ${
                    forecastHighlight
                      ? `font-bold text-amber-300${selected ? ' underline decoration-white/70 underline-offset-2' : ''}`
                      : selected
                        ? 'font-semibold text-white/90'
                        : 'text-gray-500'
                  }`}
                >
                  {bucketTradeEnabled ? (
                    <label
                      className="no-drag flex flex-col items-center gap-0.5 cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="h-3 w-3 accent-emerald-500"
                        checked={bucketChecked}
                        onChange={() => onToggleBucketMarket(market.id)}
                        aria-label={`Bucket trade ${label}`}
                      />
                      <span className="truncate max-w-full">{label}</span>
                    </label>
                  ) : (
                    <span className="truncate block">{label}</span>
                  )}
                </div>
                );
              })}
            </div>
            {bucketTradeEnabled ? (
              <TempOddsBucketTradeStrip
                priceDeltaInput={bucketPriceDeltaInput}
                onPriceDeltaInputChange={onBucketPriceDeltaInputChange}
                onCommitPriceDelta={onCommitBucketPriceDelta}
                orderAmount={bucketOrderAmount}
                onOrderAmountChange={onBucketOrderAmountChange}
                askCents={bucketAskCents}
                askInsufficient={bucketAskInsufficient}
                estCostUsd={bucketEstCostUsd}
                selectedCount={selectedEntries.length}
                placing={bucketPlacing}
                walletReady={walletReady}
                onPlace={() => onPlaceBucketOrders(selectedEntries.map((e) => e.market))}
              />
            ) : null}
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
  forecastSource,
  onForecastSourceChange,
}: {
  data: WeatherObservationsResponse | null;
  loading: boolean;
  unit: WeatherTempUnit;
  forecastSource: ForecastSourceToggle;
  onForecastSourceChange: (source: ForecastSourceToggle) => void;
}) {
  const chartData = useMemo(() => {
    if (!data) return null;
    return weatherObsWithForecastSource(data, forecastSource as ObsForecastSourceId);
  }, [data, forecastSource]);
  const last = chartData?.points?.length ? chartData.points[chartData.points.length - 1] : null;
  const obsUnit = chartData?.obsTempUnit ?? 'C';
  const unitSuffix = unit === 'F' ? '°F' : '°C';
  const hasOm = Boolean(data?.forecastBySource?.['open-meteo']?.points?.length);
  const hasWc = Boolean(data?.forecastBySource?.['weather-company']?.points?.length);
  const forecastUpdatedMs = useMemo(() => {
    const raw = chartData?.forecastUpdatedAt;
    if (raw == null || !Number.isFinite(raw) || raw <= 0) return 0;
    // API is ms; tolerate accidental seconds.
    return raw < 1e12 ? raw * 1000 : raw;
  }, [chartData?.forecastUpdatedAt]);
  type HeaderPart = {
    text: string;
    color: string;
    windDirDeg?: number;
    windVariable?: boolean;
    windCalm?: boolean;
  };
  const headerParts: HeaderPart[] = [];
  if (last) {
    headerParts.push({
      text: `${floorDisplayTemp(last.temp, obsUnit, unit)}${unitSuffix}`,
      color: '#ef4444',
    });
    if (last.humidity != null) {
      headerParts.push({ text: `${Math.round(last.humidity)}%`, color: '#3b82f6' });
    }
    if (last.dewpoint != null) {
      headerParts.push({
        text: `dp ${floorDisplayTemp(last.dewpoint, obsUnit, unit)}${unitSuffix}`,
        color: '#eab308',
      });
    }
    if (last.windSpeedKt != null || last.windDirDeg != null) {
      const spd = last.windSpeedKt ?? 0;
      if (spd <= 0) {
        headerParts.push({ text: '', color: '#2dd4bf', windCalm: true });
      } else {
        headerParts.push({
          text: `${Math.round(spd)}kt`,
          color: '#2dd4bf',
          windDirDeg: last.windDirDeg,
          windVariable: last.windDirDeg == null,
        });
      }
    }
  }

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 border border-gray-700/80 rounded-lg bg-gray-900/40 p-2">
      <div className="mb-1 flex shrink-0 items-center gap-2">
        <div className="text-[9px] font-bold uppercase tracking-wide text-sky-400/80">Hourly</div>
        <div className="flex items-center gap-0.5 rounded border border-gray-700/80 p-0.5">
          <button
            type="button"
            className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${
              forecastSource === 'open-meteo'
                ? 'bg-amber-500/30 text-amber-200'
                : 'text-gray-500 hover:text-gray-300'
            } ${!hasOm ? 'opacity-40' : ''}`}
            disabled={!hasOm && hasWc}
            onClick={() => onForecastSourceChange('open-meteo')}
            title="Open-Meteo forecast"
          >
            OM
          </button>
          <button
            type="button"
            className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${
              forecastSource === 'weather-company'
                ? 'bg-sky-500/30 text-sky-200'
                : 'text-gray-500 hover:text-gray-300'
            } ${!hasWc ? 'opacity-40' : ''}`}
            disabled={!hasWc && hasOm}
            onClick={() => onForecastSourceChange('weather-company')}
            title="Weather Company forecast"
          >
            WC
          </button>
        </div>
        {forecastUpdatedMs > 0 ? <TempOddsForecastAgeLabel updatedMs={forecastUpdatedMs} /> : null}
        {headerParts.length > 0 ? (
          <div className="ml-auto flex min-w-0 items-center gap-1 truncate text-[10px] font-normal tabular-nums">
            {headerParts.map((p, i) => (
              <span key={`${p.color}-${i}`} className="inline-flex items-center gap-1">
                {i > 0 ? <span className="text-gray-600">·</span> : null}
                <span className="inline-flex items-center gap-0.5" style={{ color: p.color }}>
                  {p.windCalm ? (
                    <span className="inline-block text-[10px] leading-none" aria-label="calm" title="calm">
                      ●
                    </span>
                  ) : p.windDirDeg != null ? (
                    <span
                      className="inline-block text-[11px] leading-none"
                      style={{ transform: `rotate(${p.windDirDeg + 180}deg)` }}
                      aria-hidden
                    >
                      ↑
                    </span>
                  ) : p.windVariable ? (
                    <span className="inline-block text-[10px] leading-none" aria-hidden>
                      ○
                    </span>
                  ) : null}
                  {p.text ? <span>{p.text}</span> : null}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[10px] text-gray-500">Loading…</div>
        ) : chartData ? (
          <TemperatureChart data={chartData} unit={unit} />
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
  const [metarDialogOpen, setMetarDialogOpen] = useState(false);
  const [cityMenuPos, setCityMenuPos] = useState<{ top: number; left: number } | null>(null);
  const cityBtnRef = useRef<HTMLButtonElement>(null);
  const cityMenuRef = useRef<HTMLDivElement>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(() =>
    localStorage.getItem(`polybot-weather-temp-bars-date-${panelId}`),
  );
  const [pastFilterTick, setPastFilterTick] = useState(0);
  const [modelPayload, setModelPayload] = useState<WeatherProbabilitiesPayload | null>(null);
  const [modelPayloadKey, setModelPayloadKey] = useState('');
  const [forecastSource, setForecastSource] = useState<ForecastSourceToggle>(() =>
    readStoredForecastSource(panelId),
  );
  const [outcomeView, setOutcomeView] = useState<TempOddsOutcomeView>(() =>
    readStoredOutcomeView(panelId),
  );
  const [bucketTradeEnabled, setBucketTradeEnabled] = useState(() => readStoredBucketTrade(panelId));
  const [bucketSelectedMarketIds, setBucketSelectedMarketIds] = useState<Set<string>>(() => new Set());
  const [bucketOrderAmount, setBucketOrderAmount] = useState('100');
  const [bucketPriceDeltaCents, setBucketPriceDeltaCents] = useState(() =>
    readStoredBucketPriceDelta(panelId),
  );
  const [bucketPriceDeltaInput, setBucketPriceDeltaInput] = useState(() =>
    String(readStoredBucketPriceDelta(panelId)),
  );
  const [bucketPlacing, setBucketPlacing] = useState(false);
  const tradingWallet = useTradingWalletAddress();
  const walletReady = !!tradingWallet;
  const maxOrderSizeUsd = useAppStore((s) => s.maxOrderSizeUsd);
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

  const setTempOddsForecastSource = useCallback(
    (source: ForecastSourceToggle) => {
      setForecastSource(source);
      localStorage.setItem(`polybot-weather-temp-bars-forecast-source-${panelId}`, source);
    },
    [panelId],
  );

  const setTempOddsOutcomeView = useCallback(
    (view: TempOddsOutcomeView) => {
      setOutcomeView(view);
      localStorage.setItem(`polybot-weather-temp-bars-outcome-${panelId}`, view);
    },
    [panelId],
  );

  const setTempOddsBucketTrade = useCallback(
    (on: boolean) => {
      setBucketTradeEnabled(on);
      localStorage.setItem(`polybot-weather-temp-bars-bucket-trade-${panelId}`, on ? '1' : '0');
    },
    [panelId],
  );

  const toggleBucketMarket = useCallback((marketId: string) => {
    setBucketSelectedMarketIds((prev) => {
      const next = new Set(prev);
      if (next.has(marketId)) next.delete(marketId);
      else next.add(marketId);
      return next;
    });
  }, []);

  const commitBucketPriceDelta = useCallback(
    (raw: string) => {
      const n = parseFloat(raw.trim());
      if (!Number.isFinite(n) || n < 0) {
        setBucketPriceDeltaInput(String(bucketPriceDeltaCents));
        return;
      }
      setBucketPriceDeltaCents(n);
      setBucketPriceDeltaInput(String(n));
      localStorage.setItem(`polybot-weather-temp-bars-bucket-delta-${panelId}`, String(n));
    },
    [panelId, bucketPriceDeltaCents],
  );

  useEffect(() => {
    setBucketSelectedMarketIds(new Set());
  }, [city, selectedDateKey, chartMode]);

  useEffect(() => {
    selectTempOddsMetric(chartMode);
  }, [chartMode]);

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
  const onchainWsPositions = useThrottledSidebarOnchainGridWalletPositions(2000);

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

  const prevLinkedMarketIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!linkSidebar) return;
    const ctx = weatherMarketCityAndDate(selectedMarket);
    if (!ctx) return;
    const marketId = selectedMarket?.id ?? null;
    const selectionChanged = marketId !== prevLinkedMarketIdRef.current;
    prevLinkedMarketIdRef.current = marketId;
    if (selectionChanged) {
      const mode = weatherMarketTempOddsMode(selectedMarket);
      if (mode) setTempOddsChartMode(mode);
    }
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

  const marketExpiryMs = useMemo(() => {
    if (!selectedDateCol?.slug) return null;
    return weatherMarketExpiryMsForEvent(city, selectedDateCol.slug);
  }, [city, selectedDateCol?.slug]);

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
  const [stakedByMarketId, setStakedByMarketId] = useState<Record<string, MarketStakeSnap>>({});
  const forecastTempC = useMemo(() => {
    if (!obsData) return null;
    const sourced = weatherObsWithForecastSource(obsData, forecastSource as ObsForecastSourceId);
    return chartMode === 'low' ? weatherHighlightLowC(sourced) : weatherHighlightHighC(sourced);
  }, [obsData, forecastSource, chartMode]);
  const prevBarSelectionKeyRef = useRef('');

  const activeBarMarketStakeKey = useMemo(
    () =>
      activeBarMarkets
        .map((m) => `${m.id}:${(m.conditionId || '').trim()}`)
        .sort()
        .join('|'),
    [activeBarMarkets],
  );

  // Weather WS shareStats often empty — one batch REST; module cache; keep last good.
  useEffect(() => {
    const markets = activeBarMarkets;
    if (markets.length === 0) {
      setStakedByMarketId({});
      return;
    }
    // Instant paint from cache (survives cancel / city flip-back).
    const cached = hydrateStakedByMarketId(markets);
    if (Object.keys(cached).length > 0) {
      setStakedByMarketId((prev) => {
        const next = { ...cached };
        for (const m of markets) {
          if (!next[m.id] && prev[m.id]) next[m.id] = prev[m.id]!;
        }
        return next;
      });
    }
    let cancelled = false;
    const stakeKey = activeBarMarketStakeKey;
    const load = async () => {
      const ids = markets
        .map((m) => (m.conditionId || m.id || '').trim())
        .filter(Boolean);
      if (ids.length === 0) return;
      try {
        const byId = await fetchMarketsStakedLegs(ids);
        const next: Record<string, MarketStakeSnap> = {};
        for (const m of markets) {
          const mid = (m.conditionId || m.id || '').trim();
          if (!mid) continue;
          const legs =
            byId[mid] ??
            byId[mid.toLowerCase()] ??
            Object.entries(byId).find(([k]) => k.toLowerCase() === mid.toLowerCase())?.[1];
          if (!legs) continue;
          const snap = marketStakeSnapFromParts(
            legs.stakedNetYesUsd,
            legs.stakedNetNoUsd,
            legs.stakedSumAbsSignedNetUsd,
          );
          if (!snap) continue;
          tempOddsStakeCacheSet(m, snap);
          next[m.id] = snap;
        }
        // Always write cache; only skip setState if this date/city set changed.
        if (cancelled) return;
        setStakedByMarketId((prev) => {
          const merged: Record<string, MarketStakeSnap> = {};
          for (const m of markets) {
            if (next[m.id]) merged[m.id] = next[m.id]!;
            else if (prev[m.id]) merged[m.id] = prev[m.id]!;
            else {
              const hit = tempOddsStakeCacheGet(m);
              if (hit) merged[m.id] = hit;
            }
          }
          return merged;
        });
      } catch (e) {
        console.error('[temp-odds] markets-staked-legs', stakeKey, e);
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by activeBarMarketStakeKey
  }, [activeBarMarketStakeKey]);

  useEffect(() => {
    const id = selectedMarketId;
    const selectionKey = id || selectedMarket?.id || '';
    const selectionChanged = selectionKey !== prevBarSelectionKeyRef.current;
    prevBarSelectionKeyRef.current = selectionKey;

    if (!id && !selectedMarket) {
      setBarSelectionId('');
      return;
    }
    const inActive = findWeatherBarMarket(activeBarMarkets, id, selectedMarket);
    if (inActive) {
      setBarSelectionId(inActive.id);
      return;
    }
    setBarSelectionId('');
    if (!selectionChanged) return;

    const otherMarkets = chartMode === 'low' ? highBarMarkets : lowBarMarkets;
    const inOther = findWeatherBarMarket(otherMarkets, id, selectedMarket);
    if (inOther) {
      setTempOddsChartMode(chartMode === 'low' ? 'high' : 'low');
      setBarSelectionId(inOther.id);
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
  const metarTitle = cityMeta.icao
    ? `METAR ${cityMeta.icao} (live)`
    : 'METAR';

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

  const handlePlaceBucketOrders = useCallback(
    async (markets: Market[]) => {
      if (!walletReady) {
        showToast('Connect wallet first', 'error');
        return;
      }
      const shares = parseFloat(bucketOrderAmount);
      if (!Number.isFinite(shares) || shares <= 0) {
        showToast('Enter shares per leg', 'error');
        return;
      }
      if (markets.length === 0) {
        showToast('Select at least one bucket', 'error');
        return;
      }

      const legs: { market: Market; tokenId: string; label: string }[] = [];
      for (const market of markets) {
        const tokenId = bucketTradeTokenId(market, outcomeView);
        if (!tokenId) {
          showToast(`Missing ${outcomeView} token for ${market.groupItemTitle || market.question || 'market'}`, 'error');
          return;
        }
        legs.push({
          market,
          tokenId,
          label: compactTempBucketLabel(market.groupItemTitle || '') || market.groupItemTitle || 'bucket',
        });
      }

      setBucketPlacing(true);
      try {
        let placed = 0;
        for (const leg of legs) {
          let book: { asks: { price: string; size: string }[] };
          try {
            book = await fetchOrderbook(leg.tokenId);
          } catch {
            showToast(`${leg.label}: orderbook fetch failed`, 'error');
            if (placed > 0) triggerWalletRefresh();
            return;
          }
          const walk = walkAsksForShares(book.asks || [], shares);
          if (!walk || !walk.complete) {
            showToast(`${leg.label}: not enough ask depth for ${shares} shares`, 'error');
            if (placed > 0) triggerWalletRefresh();
            return;
          }
          const limitPx = bucketLimitFromAskPrice(walk.avgPrice, bucketPriceDeltaCents);
          if (!limitPx) {
            showToast(`${leg.label}: invalid limit price`, 'error');
            if (placed > 0) triggerWalletRefresh();
            return;
          }
          const cap = maxOrderUsdViolationMessage(maxOrderSizeUsd, orderNotionalUsd(limitPx.price, shares));
          if (cap) {
            showToast(`${leg.label}: ${cap}`, 'error');
            if (placed > 0) triggerWalletRefresh();
            return;
          }
          const expiration = marketLimitExpirationSec(leg.market.endDate);
          const result = await placeOrder({
            tokenId: leg.tokenId,
            side: 'BUY',
            price: limitPx.price,
            size: shares,
            ...(expiration != null ? { expiration } : {}),
            orderInfo: `Bucket BUY ${shares} ${outcomeView} ${leg.label} @ ${limitPx.cents.toFixed(1)}¢ (ask ${walk.avgCents.toFixed(1)}+Δ${bucketPriceDeltaCents})`,
          });
          if (!result.success) {
            showToast(result.error || `${leg.label} order failed`, 'error');
            if (placed > 0) triggerWalletRefresh();
            return;
          }
          placed += 1;
        }
        showToast(`Placed ${placed} bucket order${placed === 1 ? '' : 's'}`, 'success');
        triggerWalletRefresh();
      } catch {
        showToast('Bucket orders failed', 'error');
      } finally {
        setBucketPlacing(false);
      }
    },
    [walletReady, bucketOrderAmount, bucketPriceDeltaCents, outcomeView, maxOrderSizeUsd],
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
          {cityMeta.icao ? (
            <span className="ml-1 font-semibold text-sky-400/70">({cityMeta.icao})</span>
          ) : null}
          <svg className="w-3 h-3 ml-0.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {resolutionUrl ? (
          <a
            href={resolutionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="no-drag inline-flex shrink-0 items-center text-[10px] font-bold px-1.5 py-0.5 rounded border border-orange-600/60 text-orange-300 hover:bg-orange-900/40"
            title={resolutionTitle}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            WU
          </a>
        ) : null}
        {cityMeta.icao ? (
          <button
            type="button"
            className="no-drag inline-flex shrink-0 items-center text-[10px] font-bold px-1.5 py-0.5 rounded border border-cyan-600/60 text-cyan-300 hover:bg-cyan-900/40"
            title={metarTitle}
            onClick={(e) => {
              e.stopPropagation();
              setMetarDialogOpen(true);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            METAR
          </button>
        ) : null}

        <TempUnitToggle unit={tempUnit} onChange={setTempUnitOverride} />

        <div className="no-drag inline-flex shrink-0 overflow-hidden rounded border border-gray-600 divide-x divide-gray-600 bg-gray-900/90">
          <button
            type="button"
            title="Show YES probabilities"
            className={`px-1.5 py-0.5 text-[9px] font-bold ${
              outcomeView === 'YES' ? 'bg-green-700/80 text-white' : 'text-gray-400 hover:text-green-300'
            }`}
            onClick={() => setTempOddsOutcomeView('YES')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            YES
          </button>
          <button
            type="button"
            title="Show NO probabilities (1 − YES)"
            className={`px-1.5 py-0.5 text-[9px] font-bold ${
              outcomeView === 'NO' ? 'bg-red-700/80 text-white' : 'text-gray-400 hover:text-red-300'
            }`}
            onClick={() => setTempOddsOutcomeView('NO')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            NO
          </button>
        </div>

        <label
          className="no-drag inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-gray-600 bg-gray-900/90 px-1.5 py-0.5 text-[9px] font-bold text-gray-300"
          title="Select temperature buckets and place BUY orders on each"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            className="h-3 w-3 accent-emerald-500"
            checked={bucketTradeEnabled}
            onChange={(e) => setTempOddsBucketTrade(e.target.checked)}
          />
          Bucket Trade
        </label>

        <div className="no-drag inline-flex shrink-0 overflow-hidden rounded border border-gray-600 divide-x divide-gray-600 bg-gray-900/90">
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

        <TempOddsCityLocalClock timezone={cityMeta.timezone} />

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
          <span title="Time until market expiry (local midnight after event day)">
            <TempOddsExpiryCountdown marketExpiryMs={marketExpiryMs} />
          </span>
          <TempOddsElapsedLabel updatedMs={predictionUpdatedMs} />
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
                modelBarColorOm={chartMode === 'low' ? 'bg-amber-400/55' : 'bg-amber-400/55'}
                modelBarColorWc={chartMode === 'low' ? 'bg-sky-400/55' : 'bg-sky-400/55'}
                stakedBarColor="bg-violet-400/55"
                stakedShareBarColor="bg-fuchsia-400/55"
                grid={activeGrid}
                dateCol={activeDateCol}
                selectedMarketId={barSelectionId}
                onBarClick={handleBarClick}
                positions={positions}
                liveTradesSource={liveTradesSource}
                onchainWsPositions={onchainWsPositions}
                modelBucketsOm={modelBucketsFromPayload(modelPayload, 'open-meteo', chartMode)}
                modelBucketsWc={modelBucketsFromPayload(modelPayload, 'weather-company', chartMode)}
                stakedByMarketId={stakedByMarketId}
                orderLookup={orderLookup}
                forecastTempC={forecastTempC}
                metric={chartMode}
                outcomeView={outcomeView}
                bucketTradeEnabled={bucketTradeEnabled}
                bucketSelectedMarketIds={bucketSelectedMarketIds}
                onToggleBucketMarket={toggleBucketMarket}
                bucketOrderAmount={bucketOrderAmount}
                onBucketOrderAmountChange={setBucketOrderAmount}
                bucketPriceDeltaInput={bucketPriceDeltaInput}
                onBucketPriceDeltaInputChange={setBucketPriceDeltaInput}
                onCommitBucketPriceDelta={commitBucketPriceDelta}
                bucketPlacing={bucketPlacing}
                walletReady={walletReady}
                onPlaceBucketOrders={(markets) => void handlePlaceBucketOrders(markets)}
                obsBoundC={
                  obsData == null
                    ? null
                    : chartMode === 'low'
                      ? obsData.lowTemp != null
                        ? obsTempToCelsius(obsData.lowTemp, obsData.obsTempUnit ?? 'C')
                        : null
                      : obsData.highTemp != null
                        ? obsTempToCelsius(obsData.highTemp, obsData.obsTempUnit ?? 'C')
                        : null
                }
              />
            ) : (
              <div className="flex flex-1 min-w-0 items-center justify-center text-xs text-gray-500">
                No {chartMode === 'low' ? 'low' : 'high'} temp markets
              </div>
            )}
            <TempOddsTemperatureChart
              data={obsData}
              loading={obsLoading}
              unit={tempUnit}
              forecastSource={forecastSource}
              onForecastSourceChange={setTempOddsForecastSource}
            />
          </>
        )}
      </div>
      {cityMeta.icao ? (
        <WeatherMetarDialog
          open={metarDialogOpen}
          onClose={() => setMetarDialogOpen(false)}
          city={city}
          cityLabel={cityMeta.label}
          icao={cityMeta.icao}
          timeZone={cityMeta.timezone}
          displayTempUnit={tempUnit}
        />
      ) : null}
    </div>
  );
}

export const TemperatureBarChartPanel = memo(TemperatureBarChartPanelInner);
