import type { Market, Order, Position } from '../types';
import { getOrderClobTokenId, normalizeClobTokenId } from '../utils/format';
import { outcomeBidAskProb } from './outcomeQuote';
import { positionBidExitTier, type PositionBidExitTier } from './positionBidExitTier';
import { resolveLegPositionForToken } from './sidebarMyPositions';
import { weatherEventDateISOFromSlug } from './weatherMarketsGrid';
import type { WSPosition } from '../hooks/useOnchainTradesWS';

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

/** Per-city exposure for Temp Odds selected date. Position color = highest-PnL leg Bid-tier. */
export function buildWeatherCityExposureByDate(
  weatherMarkets: Record<string, Market[]>,
  dateIso: string | null,
  positions: Position[],
  orders: Order[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
  marketLookup: Record<string, Market>,
): Map<string, WeatherCityExposure> {
  const out = new Map<string, WeatherCityExposure>();
  if (!dateIso) return out;

  const lookup = orderLookup(orders);

  for (const [citySlug, markets] of Object.entries(weatherMarkets)) {
    let bestPos: { pnl: number; tier: PositionBidExitTier } | null = null;
    let hasOrder = false;

    for (const market of markets) {
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
