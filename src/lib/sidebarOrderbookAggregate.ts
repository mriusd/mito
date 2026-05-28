/** Sidebar live OB: collapse raw ladder into 1¢ or 5¢ buckets (sizes summed). Price strings stay decimals 0–1 like Polymarket WS. */

import { obLevelBandUsd } from './orderbookBookImbalance';

export type SidebarObAggStep = '0.1' | '1' | '5';

export type SidebarObAggLevel = { price: string; size: string; bandUsd?: number };

type OBLevel = { price: string; size: string };

function centsFromPolymarketPrice(priceStr: string): number {
  const p = parseFloat(priceStr);
  return Number.isFinite(p) ? Math.round(p * 100) : NaN;
}

export function sidebarObAggBucketCents(cents: number, step: Exclude<SidebarObAggStep, '0.1'>): number {
  if (!Number.isFinite(cents)) return NaN;
  return clampAggBucketCents(sidebarObBucketKeyCents(Math.round(cents), step), step);
}

export function sidebarObBucketKeyCents(cents: number, step: Exclude<SidebarObAggStep, '0.1'>): number {
  if (!Number.isFinite(cents)) return NaN;
  if (step === '1') return Math.round(cents);
  return Math.round(cents / 5) * 5;
}

function clampAggBucketCents(c: number, step: Exclude<SidebarObAggStep, '0.1'>): number {
  if (!Number.isFinite(c)) return c;
  if (step === '1') return Math.min(99, Math.max(1, c));
  return Math.min(95, Math.max(5, c));
}

/** Order form stores cents string; coarse steps use integer cents */
export function sidebarObAggOrderPriceCents(bucketCents: number, step: Exclude<SidebarObAggStep, '0.1'>): string {
  if (!Number.isFinite(bucketCents)) return '';
  const b = clampAggBucketCents(bucketCents, step);
  return String(Math.round(b));
}

function decimalFromBucketCents(bucketCents: number): string {
  return (bucketCents / 100).toFixed(4).replace(/\.?0+$/, '') || '0';
}

export function sidebarObAggregateLevels(
  levels: OBLevel[],
  step: Exclude<SidebarObAggStep, '0.1'>,
  side: 'bid' | 'ask',
  maxLevels: number,
): SidebarObAggLevel[] {
  const m = new Map<number, { size: number; bandUsd: number }>();
  for (const l of levels) {
    const c = centsFromPolymarketPrice(l.price);
    if (!Number.isFinite(c)) continue;
    let k = sidebarObAggBucketCents(c, step);
    if (!Number.isFinite(k)) continue;
    const sz = parseFloat(l.size);
    const add = Number.isFinite(sz) ? sz : 0;
    const prev = m.get(k) ?? { size: 0, bandUsd: 0 };
    m.set(k, { size: prev.size + add, bandUsd: prev.bandUsd + obLevelBandUsd(l) });
  }
  let keys = Array.from(m.keys());
  if (side === 'bid') keys.sort((a, b) => b - a);
  else keys.sort((a, b) => a - b);
  keys = keys.slice(0, maxLevels);
  return keys.map((k) => {
    const acc = m.get(k) ?? { size: 0, bandUsd: 0 };
    return {
      price: decimalFromBucketCents(k),
      size: String(acc.size),
      bandUsd: acc.bandUsd,
    };
  });
}

export function sidebarUserPriceHitsBucket(sidePrices: Set<string>, bucketCents: number, step: Exclude<SidebarObAggStep, '0.1'>): boolean {
  const bTarget = sidebarObAggBucketCents(bucketCents, step);
  if (!Number.isFinite(bTarget)) return false;
  for (const s of sidePrices) {
    const c = parseFloat(s);
    if (!Number.isFinite(c)) continue;
    const bk = sidebarObAggBucketCents(c, step);
    if (Number.isFinite(bk) && bk === bTarget) return true;
  }
  return false;
}

type OrderLike = {
  asset_id?: string;
  token_id?: string;
  side?: string;
  price?: string;
};

function addHighlightCents(set: Set<string>, cents: number) {
  if (!Number.isFinite(cents)) return;
  set.add(Math.round(cents).toFixed(1));
}

/**
 * User order prices to highlight on sidebar OB for the viewed outcome.
 * Same-outcome orders map directly; opposite-outcome orders map via 100−p (YES bid 65 → NO ask 35).
 */
export function buildSidebarUserOrderHighlightSets(
  orders: OrderLike[],
  yesTokenId: string,
  noTokenId: string,
  viewOutcome: 'YES' | 'NO',
): { bidPrices: Set<string>; askPrices: Set<string> } {
  const bidPrices = new Set<string>();
  const askPrices = new Set<string>();
  const yesTok = String(yesTokenId || '').trim();
  const noTok = String(noTokenId || '').trim();
  const viewToken = viewOutcome === 'YES' ? yesTok : noTok;
  const oppToken = viewOutcome === 'YES' ? noTok : yesTok;
  if (!viewToken) return { bidPrices, askPrices };

  for (const o of orders) {
    const oid = String(o.asset_id || o.token_id || '').trim();
    const p = parseFloat(String(o.price ?? ''));
    if (!Number.isFinite(p)) continue;
    const cents = Math.round(p * 100);
    const side = String(o.side || '').toUpperCase();

    if (oid === viewToken) {
      if (side === 'BUY') addHighlightCents(bidPrices, cents);
      else if (side === 'SELL') addHighlightCents(askPrices, cents);
    } else if (oppToken && oid === oppToken) {
      const comp = 100 - cents;
      if (side === 'BUY') addHighlightCents(askPrices, comp);
      else if (side === 'SELL') addHighlightCents(bidPrices, comp);
    }
  }
  return { bidPrices, askPrices };
}

export type SidebarChartOrderLevel = {
  priceCents: number;
  direction: 'long' | 'short';
};

/** Long = BUY YES or SELL NO; short = SELL YES or BUY NO. */
export function orderExposureDirection(side: string, tokenOutcome: 'YES' | 'NO'): 'long' | 'short' {
  const s = String(side || '').toUpperCase();
  if ((s === 'BUY' && tokenOutcome === 'YES') || (s === 'SELL' && tokenOutcome === 'NO')) return 'long';
  return 'short';
}

/** Horizontal chart lines for My Orders on the viewed outcome Y-axis (0–100¢). */
export function buildSidebarChartOrderLevels(
  orders: OrderLike[],
  yesTokenId: string,
  noTokenId: string,
  viewOutcome: 'YES' | 'NO',
): SidebarChartOrderLevel[] {
  const levels: SidebarChartOrderLevel[] = [];
  const yesTok = String(yesTokenId || '').trim();
  const noTok = String(noTokenId || '').trim();
  const viewToken = viewOutcome === 'YES' ? yesTok : noTok;
  const oppToken = viewOutcome === 'YES' ? noTok : yesTok;
  if (!viewToken) return levels;

  for (const o of orders) {
    const oid = String(o.asset_id || o.token_id || '').trim();
    const p = parseFloat(String(o.price ?? ''));
    if (!Number.isFinite(p)) continue;
    const cents = Math.round(p * 100);
    const side = String(o.side || '').toUpperCase();

    let chartCents: number;
    let tokenOutcome: 'YES' | 'NO';

    if (oid === viewToken) {
      chartCents = cents;
      tokenOutcome = viewOutcome;
    } else if (oppToken && oid === oppToken) {
      chartCents = 100 - cents;
      tokenOutcome = viewOutcome === 'YES' ? 'NO' : 'YES';
    } else {
      continue;
    }

    if (!Number.isFinite(chartCents) || chartCents < 0 || chartCents > 100) continue;
    levels.push({ priceCents: chartCents, direction: orderExposureDirection(side, tokenOutcome) });
  }
  return levels;
}
