import type { Market, Order, Position } from '../types';
import { getOrderClobTokenId, normalizeClobTokenId } from '../utils/format';
import { resolveLegPositionForToken } from './sidebarMyPositions';
import { weatherEventDateISOFromSlug } from './weatherMarketsGrid';
import type { WSPosition } from '../hooks/useOnchainTradesWS';

export type WeatherCityExposure = 'position' | 'order';

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

function marketHasOpenPosition(
  market: Market,
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
): boolean {
  const [yesTokenId, noTokenId] = market.clobTokenIds || [];
  if (yesTokenId && resolveLegPositionForToken(yesTokenId, positions, liveTradesSource, onchainWsPositions)) {
    return true;
  }
  if (noTokenId && resolveLegPositionForToken(noTokenId, positions, liveTradesSource, onchainWsPositions)) {
    return true;
  }
  return false;
}

function marketHasOpenOrder(market: Market, lookup: Record<string, Order[]>): boolean {
  for (const tokenId of market.clobTokenIds || []) {
    const key = normalizeClobTokenId(tokenId);
    if (key && (lookup[key]?.length ?? 0) > 0) return true;
  }
  return false;
}

/** Per-city exposure for Temp Odds selected date (position beats order). */
export function buildWeatherCityExposureByDate(
  weatherMarkets: Record<string, Market[]>,
  dateIso: string | null,
  positions: Position[],
  orders: Order[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
): Map<string, WeatherCityExposure> {
  const out = new Map<string, WeatherCityExposure>();
  if (!dateIso) return out;

  const lookup = orderLookup(orders);

  for (const [citySlug, markets] of Object.entries(weatherMarkets)) {
    let exposure: WeatherCityExposure | null = null;
    for (const market of markets) {
      const eventDate = weatherEventDateISOFromSlug(market.eventSlug || '');
      if (eventDate !== dateIso) continue;
      if (marketHasOpenPosition(market, positions, liveTradesSource, onchainWsPositions)) {
        exposure = 'position';
        break;
      }
      if (!exposure && marketHasOpenOrder(market, lookup)) {
        exposure = 'order';
      }
    }
    if (exposure) out.set(citySlug, exposure);
  }

  return out;
}
