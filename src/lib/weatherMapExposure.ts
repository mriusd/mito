import type { Market, Order, Position } from '../types';
import { getOrderClobTokenId, normalizeClobTokenId } from '../utils/format';
import { outcomeBidAskProb, outcomeMidOrOneSideProb } from './outcomeQuote';
import { positionBidExitTier, type PositionBidExitTier } from './positionBidExitTier';
import { resolveLegPositionForToken } from './sidebarMyPositions';
import {
  filterWeatherMarkets,
  weatherEventDateISOFromSlug,
  weatherTempBucketRuledOutByObs,
  type WeatherMetric,
} from './weatherMarketsGrid';
import type { WSPosition } from '../hooks/useOnchainTradesWS';

/** YES mid ≥ this on a below-forecast-high bucket → city flagged mispriced (10¢). */
export const WEATHER_MISPRICED_MID_AT = 0.1;

export type WeatherCityExposure =
  | { kind: 'none' }
  | { kind: 'order' }
  | { kind: 'position'; tier: PositionBidExitTier };

function orderLookup(orders: Order[]): Record<string, Order[]> {
  const lookup: Record<string, Order[]> = {};
  for (const ord of orders) {
    const key = normalizeClobTokenId(getOrderClobTokenId(ord));
    if (!key) continue;
    if (!lookup[key]) lookup[key] = [];
    lookup[key].push(ord);
  }
  return lookup;
}

function positionExitForToken(
  tokenId: string,
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
  marketLookup: Record<string, Market>,
): { pnl: number; tier: PositionBidExitTier } | null {
  const leg = resolveLegPositionForToken(tokenId, positions, liveTradesSource, onchainWsPositions);
  if (!leg) return null;

  const { bid } = outcomeBidAskProb(tokenId, marketLookup);
  const cur = bid ?? 0;
  const entryPrice = leg.avgPrice * 100;
  const currentPrice = cur * 100;
  const cost = leg.avgPrice * leg.size;
  const currentValue = cur * leg.size;
  const pnl = currentValue - cost;
  return { pnl, tier: positionBidExitTier(entryPrice, currentPrice) };
}

function marketHasOpenOrder(market: Market, lookup: Record<string, Order[]>): boolean {
  for (const tokenId of market.clobTokenIds || []) {
    const key = normalizeClobTokenId(tokenId);
    if (key && (lookup[key]?.length ?? 0) > 0) return true;
  }
  return false;
}

/** Per-city exposure for Temp Odds selected date + metric (high/low temp). */
export function buildWeatherCityExposureByDate(
  weatherMarkets: Record<string, Market[]>,
  dateIso: string | null,
  positions: Position[],
  orders: Order[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
  marketLookup: Record<string, Market>,
  metric: WeatherMetric | null = null,
): Map<string, WeatherCityExposure> {
  const out = new Map<string, WeatherCityExposure>();
  if (!dateIso) return out;

  const lookup = orderLookup(orders);

  for (const [citySlug, markets] of Object.entries(weatherMarkets)) {
    let bestPos: { pnl: number; tier: PositionBidExitTier } | null = null;
    let hasOrder = false;
    const scoped = metric != null ? filterWeatherMarkets(markets, metric) : markets;

    for (const market of scoped) {
      const eventDate = weatherEventDateISOFromSlug(market.eventSlug || '');
      if (eventDate !== dateIso) continue;

      for (const tokenId of market.clobTokenIds || []) {
        const pos = positionExitForToken(
          tokenId,
          positions,
          liveTradesSource,
          onchainWsPositions,
          marketLookup,
        );
        if (pos && (!bestPos || pos.pnl > bestPos.pnl)) {
          bestPos = pos;
        }
      }

      if (!hasOrder && marketHasOpenOrder(market, lookup)) {
        hasOrder = true;
      }
    }

    if (bestPos) {
      out.set(citySlug, { kind: 'position', tier: bestPos.tier });
    } else if (hasOrder) {
      out.set(citySlug, { kind: 'order' });
    } else {
      out.set(citySlug, { kind: 'none' });
    }
  }

  return out;
}

/**
 * Max YES best-bid across temp buckets for each city on `dateIso`.
 * YES only (clobTokenIds[0]) — NO side often sits near 99¢ and is not certainty.
 * Higher = more certain YES bucket (greener on map).
 */
export function buildWeatherCityMaxBidByDate(
  weatherMarkets: Record<string, Market[]>,
  dateIso: string | null,
  marketLookup: Record<string, Market>,
  metric: WeatherMetric | null = null,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!dateIso) return out;

  for (const [citySlug, markets] of Object.entries(weatherMarkets)) {
    let maxBid = 0;
    let any = false;
    const scoped = metric != null ? filterWeatherMarkets(markets, metric) : markets;
    for (const market of scoped) {
      const eventDate = weatherEventDateISOFromSlug(market.eventSlug || '');
      if (eventDate !== dateIso) continue;
      const yesTokenId = market.clobTokenIds?.[0];
      if (!yesTokenId) continue;
      const { bid } = outcomeBidAskProb(yesTokenId, marketLookup);
      if (bid == null || !(bid > 0)) continue;
      any = true;
      if (bid > maxBid) maxBid = bid;
    }
    if (any) out.set(citySlug, maxBid);
  }
  return out;
}

/**
 * Max YES bid–ask spread (ask − bid) across temp buckets for each city on `dateIso`.
 * Requires both sides quoted. Higher = wider book (brighter purple on map).
 */
export function buildWeatherCityMaxSpreadByDate(
  weatherMarkets: Record<string, Market[]>,
  dateIso: string | null,
  marketLookup: Record<string, Market>,
  metric: WeatherMetric | null = null,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!dateIso) return out;

  for (const [citySlug, markets] of Object.entries(weatherMarkets)) {
    let maxSpread = 0;
    let any = false;
    const scoped = metric != null ? filterWeatherMarkets(markets, metric) : markets;
    for (const market of scoped) {
      const eventDate = weatherEventDateISOFromSlug(market.eventSlug || '');
      if (eventDate !== dateIso) continue;
      const yesTokenId = market.clobTokenIds?.[0];
      if (!yesTokenId) continue;
      const { bid, ask } = outcomeBidAskProb(yesTokenId, marketLookup);
      if (bid == null || ask == null || !(bid > 0) || !(ask > 0)) continue;
      const spread = ask - bid;
      if (!(spread >= 0) || !Number.isFinite(spread)) continue;
      any = true;
      if (spread > maxSpread) maxSpread = spread;
    }
    if (any) out.set(citySlug, maxSpread);
  }
  return out;
}

/** YES CLOB token ids for weather markets on `dateIso` (bid/ask subscribe). */
export function weatherMapQuoteTokenIdsForDate(
  weatherMarkets: Record<string, Market[]>,
  dateIso: string | null,
  metric: WeatherMetric | null = null,
): string[] {
  if (!dateIso) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const markets of Object.values(weatherMarkets)) {
    const scoped = metric != null ? filterWeatherMarkets(markets, metric) : markets;
    for (const market of scoped) {
      if (weatherEventDateISOFromSlug(market.eventSlug || '') !== dateIso) continue;
      const t = String(market.clobTokenIds?.[0] || '').trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      ids.push(t);
    }
  }
  return ids;
}

/**
 * Per-city max YES mid among highest-temp buckets that sit entirely below forecast high.
 * Only cities with at least one such bucket mid > WEATHER_MISPRICED_MID_AT are present.
 */
export function buildWeatherCityMispricedByDate(
  weatherMarkets: Record<string, Market[]>,
  dateIso: string | null,
  marketLookup: Record<string, Market>,
  forecastHighByCity: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!dateIso || forecastHighByCity.size === 0) return out;

  for (const [citySlug, markets] of Object.entries(weatherMarkets)) {
    const forecastHighC = forecastHighByCity.get(citySlug);
    if (forecastHighC == null || !Number.isFinite(forecastHighC)) continue;

    let maxMid = 0;
    let any = false;
    const scoped = filterWeatherMarkets(markets, 'high');
    for (const market of scoped) {
      const eventDate = weatherEventDateISOFromSlug(market.eventSlug || '');
      if (eventDate !== dateIso) continue;
      const temp = market.groupItemTitle || '';
      if (!temp || !weatherTempBucketRuledOutByObs(temp, 'high', forecastHighC)) continue;
      const yesTokenId = market.clobTokenIds?.[0];
      if (!yesTokenId) continue;
      const mid = outcomeMidOrOneSideProb(yesTokenId, marketLookup, {
        bestBid: market.bestBid,
        bestAsk: market.bestAsk,
      });
      if (mid == null || !(mid > 0) || !Number.isFinite(mid)) continue;
      any = true;
      if (mid > maxMid) maxMid = mid;
    }
    if (any && maxMid >= WEATHER_MISPRICED_MID_AT) out.set(citySlug, maxMid);
  }
  return out;
}
