/** Sidebar live OB: collapse raw ladder into 1¢ or 5¢ buckets (sizes summed). Price strings stay decimals 0–1 like Polymarket WS. */

export type SidebarObAggStep = '0.1' | '1' | '5';

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
): OBLevel[] {
  const m = new Map<number, number>();
  for (const l of levels) {
    const c = centsFromPolymarketPrice(l.price);
    if (!Number.isFinite(c)) continue;
    let k = sidebarObBucketKeyCents(c, step);
    if (!Number.isFinite(k)) continue;
    k = clampAggBucketCents(k, step);
    const sz = parseFloat(l.size);
    const add = Number.isFinite(sz) ? sz : 0;
    m.set(k, (m.get(k) ?? 0) + add);
  }
  let keys = Array.from(m.keys());
  if (side === 'bid') keys.sort((a, b) => b - a);
  else keys.sort((a, b) => a - b);
  keys = keys.slice(0, maxLevels);
  return keys.map((k) => ({
    price: decimalFromBucketCents(k),
    size: String(m.get(k) ?? 0),
  }));
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
