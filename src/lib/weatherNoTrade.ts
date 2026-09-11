import type { Market } from '../types';
import { getBidAskMarketRow } from './bidAskMarketLookup';
import { outcomeBidAskProb } from './outcomeQuote';
import { resolveMarketExpiryEndDate } from './weatherMarketExpiry';
import {
  filterWeatherMarkets,
  formatWeatherDateColHeader,
  weatherEventDateISOFromSlug,
  type WeatherMetric,
} from './weatherMarketsGrid';
import { weatherCityLabel } from './weatherCities';

export type NoTradeQuoteMode = 'bid' | 'mid' | 'ask';

export type WeatherNoTradeLeg = {
  market: Market;
  temp: string;
  noTokenId: string;
  /** Selected side price in probability (0–1). */
  price: number;
  /** Price in cents. */
  priceCents: number;
};

export type WeatherNoTradeOpp = {
  city: string;
  cityLabel: string;
  metric: WeatherMetric;
  eventSlug: string;
  dateLabel: string;
  dateIso: string | null;
  /** Number of NO legs in the basket. */
  n: number;
  /** Sum of selected prices in cents. */
  costCents: number;
  /** Max spend for target profit: N×100 − profitTarget. */
  maxCostCents: number;
  /** N×100 − costCents. */
  profitCents: number;
  legs: WeatherNoTradeLeg[];
};

function noTokenId(m: Market): string {
  return String(m.clobTokenIds?.[1] || '').trim();
}

/** Live NO bid/ask (direct token or complete-market implied). */
export function weatherNoBidAsk(m: Market, lookup: Record<string, Market>): { bid: number | null; ask: number | null } {
  const tid = noTokenId(m);
  if (!tid) return { bid: null, ask: null };
  const live = getBidAskMarketRow(tid);
  const merged: Record<string, Market> = { ...lookup };
  if (live) {
    merged[tid] = live;
    try {
      merged[BigInt(tid).toString()] = live;
    } catch {
      /* ignore */
    }
  }
  return outcomeBidAskProb(tid, merged);
}

export function weatherNoPrice(
  m: Market,
  mode: NoTradeQuoteMode,
  lookup: Record<string, Market>,
): number | null {
  const { bid, ask } = weatherNoBidAsk(m, lookup);
  if (mode === 'bid') return bid != null && bid > 0 && bid < 1 ? bid : null;
  if (mode === 'ask') return ask != null && ask > 0 && ask < 1 ? ask : null;
  if (bid != null && ask != null && bid > 0 && ask > 0 && ask < 1) return (bid + ask) / 2;
  if (ask != null && ask > 0 && ask < 1) return ask;
  if (bid != null && bid > 0 && bid < 1) return bid;
  return null;
}

/**
 * User rule: cost ≤ N×100 − profitTarget (¢).
 * Example: N=6, profitTarget=100 → max cost 500¢.
 */
export function weatherNoTradeMaxCostCents(n: number, profitTargetCents: number): number {
  return n * 100 - profitTargetCents;
}

export function findWeatherNoTradeOpps(args: {
  weatherMarkets: Record<string, Market[]>;
  lookup: Record<string, Market>;
  mode: NoTradeQuoteMode;
  profitTargetCents: number;
  metric: WeatherMetric | 'both';
  /** Cap basket size N (inclusive). Default unlimited. */
  maxLegs?: number;
  nowMs?: number;
}): WeatherNoTradeOpp[] {
  const nowMs = args.nowMs ?? Date.now();
  const profit = Math.max(0, Math.round(args.profitTargetCents));
  const maxLegsCap =
    args.maxLegs != null && Number.isFinite(args.maxLegs)
      ? Math.max(2, Math.floor(args.maxLegs))
      : Number.POSITIVE_INFINITY;
  const out: WeatherNoTradeOpp[] = [];

  const metrics: WeatherMetric[] =
    args.metric === 'both' ? ['high', 'low'] : [args.metric];

  for (const city of Object.keys(args.weatherMarkets)) {
    const all = args.weatherMarkets[city] || [];
    for (const metric of metrics) {
      const markets = filterWeatherMarkets(all, metric);
      const bySlug = new Map<string, Market[]>();
      for (const m of markets) {
        const slug = (m.eventSlug || '').trim();
        if (!slug) continue;
        const expiry = resolveMarketExpiryEndDate(m, m.endDate);
        const expMs = expiry ? new Date(expiry).getTime() : NaN;
        if (Number.isFinite(expMs) && expMs < nowMs) continue;
        const list = bySlug.get(slug);
        if (list) list.push(m);
        else bySlug.set(slug, [m]);
      }

      for (const [eventSlug, group] of bySlug) {
        const legs: WeatherNoTradeLeg[] = [];
        for (const m of group) {
          const px = weatherNoPrice(m, args.mode, args.lookup);
          if (px == null) continue;
          const tid = noTokenId(m);
          if (!tid) continue;
          legs.push({
            market: m,
            temp: (m.groupItemTitle || '').trim() || '?',
            noTokenId: tid,
            price: px,
            priceCents: px * 100,
          });
        }
        if (legs.length < 2) continue;
        legs.sort((a, b) => a.priceCents - b.priceCents);

        const nMax = Math.min(legs.length, maxLegsCap);
        let best: WeatherNoTradeOpp | null = null;
        for (let n = 2; n <= nMax; n++) {
          const slice = legs.slice(0, n);
          const costCents = slice.reduce((s, l) => s + l.priceCents, 0);
          const maxCostCents = weatherNoTradeMaxCostCents(n, profit);
          if (maxCostCents <= 0) continue;
          if (costCents > maxCostCents + 1e-6) continue;
          const profitCents = n * 100 - costCents;
          if (profitCents + 1e-6 < profit) continue;
          const cand: WeatherNoTradeOpp = {
            city,
            cityLabel: weatherCityLabel(city),
            metric,
            eventSlug,
            dateLabel: formatWeatherDateColHeader({
              slug: eventSlug,
              endDate: slice[0]!.market.endDate,
              expiryEndDate: resolveMarketExpiryEndDate(slice[0]!.market, slice[0]!.market.endDate),
              title: slice[0]!.market.eventTitle || '',
            }),
            dateIso: weatherEventDateISOFromSlug(eventSlug),
            n,
            costCents,
            maxCostCents,
            profitCents,
            legs: slice,
          };
          if (!best || cand.profitCents > best.profitCents + 1e-6 || (Math.abs(cand.profitCents - best.profitCents) < 1e-6 && cand.n > best.n)) {
            best = cand;
          }
        }
        if (best) out.push(best);
      }
    }
  }

  out.sort((a, b) => b.profitCents - a.profitCents || a.cityLabel.localeCompare(b.cityLabel));
  return out;
}

/** All NO token ids for live bid/ask subscription. */
export function weatherNoTradeTokenIds(weatherMarkets: Record<string, Market[]>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const city of Object.keys(weatherMarkets)) {
    for (const m of weatherMarkets[city] || []) {
      const tid = noTokenId(m);
      if (!tid || seen.has(tid)) continue;
      seen.add(tid);
      ids.push(tid);
    }
  }
  return ids;
}
