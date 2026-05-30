/** Sidebar live OB: collapse raw ladder into 1¢ or 5¢ buckets (sizes summed). Price strings stay decimals 0–1 like Polymarket WS. */

import { obLevelBandUsd } from './orderbookBookImbalance';

export type SidebarObAggStep = '0.1' | '1' | '5';

export type SidebarObAggLevel = { price: string; size: string; bandUsd?: number };

type OBLevel = { price: string; size: string };

function centsFromPolymarketPrice(priceStr: string, step: SidebarObAggStep): number {
  const p = parseFloat(priceStr);
  if (!Number.isFinite(p)) return NaN;
  if (step === '0.1') return Math.round(p * 1000) / 10;
  return Math.round(p * 100);
}

export function sidebarObAggBucketCents(cents: number, step: SidebarObAggStep): number {
  if (!Number.isFinite(cents)) return NaN;
  if (step === '0.1') return clampAggBucketCents(Math.round(cents * 10) / 10, step);
  return clampAggBucketCents(sidebarObBucketKeyCents(Math.round(cents), step), step);
}

export function sidebarObBucketKeyCents(cents: number, step: Exclude<SidebarObAggStep, '0.1'>): number {
  if (!Number.isFinite(cents)) return NaN;
  if (step === '1') return Math.round(cents);
  return Math.round(cents / 5) * 5;
}

function clampAggBucketCents(c: number, step: SidebarObAggStep): number {
  if (!Number.isFinite(c)) return c;
  if (step === '0.1') return Math.min(99.9, Math.max(0.1, Math.round(c * 10) / 10));
  if (step === '1') return Math.min(99, Math.max(1, Math.round(c)));
  return Math.min(95, Math.max(5, Math.round(c / 5) * 5));
}

/** Order form stores cents string; coarse steps use integer cents, 0.1 step uses one decimal. */
export function sidebarObAggOrderPriceCents(bucketCents: number, step: SidebarObAggStep): string {
  if (!Number.isFinite(bucketCents)) return '';
  const b = sidebarObAggBucketCents(bucketCents, step);
  if (step === '0.1') return b.toFixed(1).replace(/\.0$/, '');
  return String(Math.round(b));
}

function decimalFromBucketCents(bucketCents: number): string {
  return (bucketCents / 100).toFixed(4).replace(/\.?0+$/, '') || '0';
}

export function sidebarObAggregateLevels(
  levels: OBLevel[],
  step: SidebarObAggStep,
  side: 'bid' | 'ask',
  maxLevels: number,
): SidebarObAggLevel[] {
  const m = new Map<number, { size: number; bandUsd: number }>();
  for (const l of levels) {
    const c = centsFromPolymarketPrice(l.price, step);
    if (!Number.isFinite(c)) continue;
    const k = sidebarObAggBucketCents(c, step);
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

export function sidebarUserPriceHitsBucket(sidePrices: Set<string>, bucketCents: number, step: SidebarObAggStep): boolean {
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
  id?: string;
  asset_id?: string;
  token_id?: string;
  side?: string;
  price?: string;
  original_size?: string;
  size?: string;
  size_matched?: string;
};

export function orderRemainingSize(o: OrderLike): number {
  const totalSize = Math.floor(parseFloat(o.original_size || o.size || '0') * 100) / 100;
  const filled = Math.floor(parseFloat(o.size_matched || '0') * 100) / 100;
  return Math.max(0, totalSize - filled);
}

/** Chart Y-axis cents → limit price cents on the order's outcome token. */
export function chartViewCentsToTokenPriceCents(
  chartCents: number,
  orderTokenId: string,
  viewOutcome: 'YES' | 'NO',
  yesTokenId: string,
  noTokenId: string,
): number {
  const viewToken = viewOutcome === 'YES' ? yesTokenId : noTokenId;
  if (orderTokenId === viewToken) return chartCents;
  return Math.round((100 - chartCents) * 10) / 10;
}

function highlightPriceKey(cents: number): string {
  const tenths = Math.round(cents * 10) / 10;
  if (!Number.isFinite(tenths)) return '';
  return tenths.toFixed(1).replace(/\.0$/, '');
}

function addHighlightCents(set: Set<string>, cents: number) {
  const k = highlightPriceKey(cents);
  if (k) set.add(k);
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
    const cents = Math.round(p * 1000) / 10;
    const side = String(o.side || '').toUpperCase();

    if (oid === viewToken) {
      if (side === 'BUY') addHighlightCents(bidPrices, cents);
      else if (side === 'SELL') addHighlightCents(askPrices, cents);
    } else if (oppToken && oid === oppToken) {
      const comp = Math.round((100 - cents) * 10) / 10;
      if (side === 'BUY') addHighlightCents(askPrices, comp);
      else if (side === 'SELL') addHighlightCents(bidPrices, comp);
    }
  }
  return { bidPrices, askPrices };
}

export type SidebarChartOrderLevel = {
  orderId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  remainingSize: number;
  /** Limit on chart Y-axis (viewed outcome, 0–100¢). */
  priceCents: number;
  /** Limit on order token (for replace). */
  tokenPriceCents: number;
  direction: 'long' | 'short';
};

export type ChartOrderReplaceParams = {
  orderId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  remainingSize: number;
  newPriceCents: number;
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
    const orderId = String(o.id || '').trim();
    const tokenId = oid;
    if (!orderId || !tokenId) continue;
    const orderSide = side === 'SELL' ? 'SELL' : 'BUY';
    const remainingSize = orderRemainingSize(o);
    if (remainingSize <= 0) continue;
    const tokenPriceCents =
      tokenOutcome === viewOutcome ? cents : Math.round((100 - cents) * 10) / 10;
    levels.push({
      orderId,
      tokenId,
      side: orderSide,
      remainingSize,
      priceCents: chartCents,
      tokenPriceCents,
      direction: orderExposureDirection(side, tokenOutcome),
    });
  }
  return levels;
}

export type SidebarChartPositionLevel = {
  tokenId: string;
  priceCents: number;
  direction: 'long' | 'short';
};

/** Holding YES = long (blue); holding NO = short on YES view (yellow). */
export function positionExposureDirection(tokenOutcome: 'YES' | 'NO'): 'long' | 'short' {
  return tokenOutcome === 'YES' ? 'long' : 'short';
}

/** Avg-entry lines for My Positions on chart Y-axis (0–100¢). */
export function buildSidebarChartPositionLevels(
  positions: { asset: string; size: number; avgPrice: number }[],
  yesTokenId: string,
  noTokenId: string,
  viewOutcome: 'YES' | 'NO',
  minSize = 0.01,
): SidebarChartPositionLevel[] {
  const levels: SidebarChartPositionLevel[] = [];
  const yesTok = String(yesTokenId || '').trim();
  const noTok = String(noTokenId || '').trim();
  const viewToken = viewOutcome === 'YES' ? yesTok : noTok;
  const oppToken = viewOutcome === 'YES' ? noTok : yesTok;
  if (!viewToken) return levels;

  for (const p of positions) {
    const oid = String(p.asset || '').trim();
    const sz = p.size;
    if (!Number.isFinite(sz) || sz < minSize) continue;
    const avgRaw = p.avgPrice;
    if (typeof avgRaw !== 'number' || !Number.isFinite(avgRaw) || avgRaw <= 0) continue;
    const priceFrac = avgRaw > 1 ? avgRaw / 100 : avgRaw;
    if (priceFrac <= 0 || priceFrac >= 1) continue;
    const cents = Math.round(priceFrac * 1000) / 10;

    let chartCents: number;
    let tokenOutcome: 'YES' | 'NO';

    if (oid === viewToken) {
      chartCents = cents;
      tokenOutcome = viewOutcome;
    } else if (oppToken && oid === oppToken) {
      chartCents = Math.round((100 - cents) * 10) / 10;
      tokenOutcome = viewOutcome === 'YES' ? 'NO' : 'YES';
    } else {
      continue;
    }

    if (!Number.isFinite(chartCents) || chartCents < 0.1 || chartCents > 99.9) continue;
    levels.push({
      tokenId: oid,
      priceCents: chartCents,
      direction: positionExposureDirection(tokenOutcome),
    });
  }
  return levels;
}
