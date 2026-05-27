/** Sidebar live OB: collapse raw ladder into 1¢ or 5¢ buckets (sizes summed). Price strings stay decimals 0–1 like Polymarket WS. */

import { obLevelBandUsd } from './orderbookBookImbalance';

export type SidebarObAggStep = '0.1' | '1' | '5';

export type SidebarObAggLevel = { price: string; size: string; bandUsd?: number };

type OBLevel = { price: string; size: string };

function centsFromPolymarketPrice(priceStr: string): number {
  const p = parseFloat(priceStr);
  return Number.isFinite(p) ? p * 100 : NaN;
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
    let k = sidebarObBucketKeyCents(c, step);
    if (!Number.isFinite(k)) continue;
    k = clampAggBucketCents(k, step);
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
  const bTarget = clampAggBucketCents(bucketCents, step);
  if (!Number.isFinite(bTarget)) return false;
  for (const s of sidePrices) {
    const c = parseFloat(s);
    if (!Number.isFinite(c)) continue;
    const bk = clampAggBucketCents(sidebarObBucketKeyCents(c, step), step);
    if (bk === bTarget) return true;
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
  set.add(cents.toFixed(1));
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
  const viewToken = viewOutcome === 'YES' ? yesTokenId : noTokenId;
  const oppToken = viewOutcome === 'YES' ? noTokenId : yesTokenId;
  if (!viewToken) return { bidPrices, askPrices };

  for (const o of orders) {
    const oid = o.asset_id || o.token_id || '';
    const p = parseFloat(String(o.price ?? ''));
    if (!Number.isFinite(p)) continue;
    const cents = p * 100;
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
