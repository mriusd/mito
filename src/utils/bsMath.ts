// Black-Scholes math utilities — ported from public/index.html

// Standard normal CDF
function normalCDF(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

// Risk-free rate
const R = 0.045;

export function calculateBlackScholesProbability(
  currentPrice: number,
  targetPrice: number,
  endDate: string,
  isAbove: boolean = true,
  rangeUpper: number | null = null,
  sigma: number = 0.60,
  bsTimeOffsetHours: number = 0,
): number | null {
  if (!currentPrice || currentPrice <= 0 || !targetPrice || targetPrice <= 0) return null;

  const now = new Date(Date.now() + bsTimeOffsetHours * 3600000);
  const expiry = new Date(endDate);
  const timeToExpiryMs = expiry.getTime() - now.getTime();
  if (timeToExpiryMs <= 0) return null;

  const timeInYears = timeToExpiryMs / (365 * 24 * 60 * 60 * 1000);
  if (timeInYears < 1e-7) return null;

  const sqrtT = Math.sqrt(timeInYears);

  if (isAbove) {
    const d2 = (Math.log(currentPrice / targetPrice) + (R - sigma * sigma / 2) * timeInYears) / (sigma * sqrtT);
    return Math.max(0, Math.min(0.999, normalCDF(d2)));
  } else if (rangeUpper) {
    const d2Lower = (Math.log(currentPrice / targetPrice) + (R - sigma * sigma / 2) * timeInYears) / (sigma * sqrtT);
    const d2Upper = (Math.log(currentPrice / rangeUpper) + (R - sigma * sigma / 2) * timeInYears) / (sigma * sqrtT);
    return Math.max(0, Math.min(0.999, normalCDF(d2Lower) - normalCDF(d2Upper)));
  } else {
    const d2 = (Math.log(currentPrice / targetPrice) + (R - sigma * sigma / 2) * timeInYears) / (sigma * sqrtT);
    return Math.max(0, Math.min(0.999, 1 - normalCDF(d2)));
  }
}

// Parse "k" suffix
function parseNum(s: string): number {
  s = s.trim();
  if (s.toLowerCase().endsWith('k')) return parseFloat(s.slice(0, -1)) * 1000;
  return parseFloat(s);
}

export function getMarketProbability(
  priceStr: string,
  currentPrice: number,
  endDate: string,
  sigma: number,
  bsTimeOffsetHours: number = 0,
): number | null {
  if (!currentPrice || !endDate) return null;
  const cleaned = priceStr.replace(/\$/g, '').replace(/,/g, '');

  if (cleaned.startsWith('<')) {
    const target = parseNum(cleaned.substring(1));
    return calculateBlackScholesProbability(currentPrice, target, endDate, false, null, sigma, bsTimeOffsetHours);
  }
  if (cleaned.startsWith('>')) {
    const target = parseNum(cleaned.substring(1));
    return calculateBlackScholesProbability(currentPrice, target, endDate, true, null, sigma, bsTimeOffsetHours);
  }
  if (cleaned.includes('-')) {
    const parts = cleaned.split('-');
    if (parts.length === 2) {
      const lower = parseNum(parts[0]);
      const upper = parseNum(parts[1]);
      if (!isNaN(lower) && !isNaN(upper)) {
        return calculateBlackScholesProbability(currentPrice, lower, endDate, false, upper, sigma, bsTimeOffsetHours);
      }
    }
  }
  const target = parseNum(cleaned);
  if (!isNaN(target)) {
    return calculateBlackScholesProbability(currentPrice, target, endDate, true, null, sigma, bsTimeOffsetHours);
  }
  return null;
}

export interface RangeBounds {
  low: number;
  high: number;
}

export function parseRangeBounds(priceStr: string): RangeBounds | null {
  const cleaned = priceStr.replace(/[\$,]/g, '');
  if (cleaned.startsWith('>') || cleaned.startsWith('<')) return null;
  if (!cleaned.includes('-')) return null;
  const parts = cleaned.split('-');
  if (parts.length !== 2) return null;
  const low = parseNum(parts[0]);
  const high = parseNum(parts[1]);
  if (isNaN(low) || isNaN(high) || low >= high) return null;
  return { low, high };
}

// Golden section search for min/max BS prob in a range market
function _optimizeRangeBsProb(
  searchLow: number, searchHigh: number,
  rangeLow: number, rangeHigh: number,
  endDate: string, sigma: number, findMin: boolean,
  bsTimeOffsetHours: number = 0,
): { prob: number | null; price: number } {
  const f = (s: number) =>
    calculateBlackScholesProbability(s, rangeLow, endDate, false, rangeHigh, sigma, bsTimeOffsetHours) ?? (findMin ? 1 : 0);

  if (searchLow >= searchHigh) {
    return { prob: f(searchLow), price: searchLow };
  }
  const gr = (Math.sqrt(5) + 1) / 2;
  let a = searchLow, b = searchHigh;
  let c = b - (b - a) / gr;
  let d = a + (b - a) / gr;
  for (let i = 0; i < 50; i++) {
    if (Math.abs(b - a) < 0.01) break;
    if (findMin ? f(c) < f(d) : f(c) > f(d)) { b = d; } else { a = c; }
    c = b - (b - a) / gr;
    d = a + (b - a) / gr;
  }
  const mid = (a + b) / 2;
  return { prob: f(mid), price: mid };
}

export function minimumRangeBsProb(
  searchLow: number, searchHigh: number,
  rangeLow: number, rangeHigh: number,
  endDate: string, sigma: number,
  bsTimeOffsetHours: number = 0,
) {
  return _optimizeRangeBsProb(searchLow, searchHigh, rangeLow, rangeHigh, endDate, sigma, true, bsTimeOffsetHours);
}

export function maximumRangeBsProb(
  searchLow: number, searchHigh: number,
  rangeLow: number, rangeHigh: number,
  endDate: string, sigma: number,
  bsTimeOffsetHours: number = 0,
) {
  return _optimizeRangeBsProb(searchLow, searchHigh, rangeLow, rangeHigh, endDate, sigma, false, bsTimeOffsetHours);
}

export interface SlotBs {
  low: number | null;
  high: number | null;
  min: number | null;
  max: number | null;
  hasRange: boolean;
}

export interface BsTripleResult {
  bsLive: number | null;
  s0: SlotBs;
  s1: SlotBs;
  hasDual: boolean;
  // Raw active slot values
  yesLive: number | null;
  noLive: number | null;
  // Range price values for price flower
  range0: { low: number | null; high: number | null } | null;
  range1: { low: number | null; high: number | null } | null;
  livePrice: number;
}

export interface PriceSlot {
  low: number;
  high: number;
}

// Frontend equivalent of getBsTriple
export function getBsTriple(
  priceStr: string,
  endDate: string,
  livePrice: number,
  sigma: number,
  slots: [(PriceSlot | number | null), (PriceSlot | number | null)],
  vwapCorrection: number = 0,
  bsTimeOffsetHours: number = 0,
): BsTripleResult | null {
  if (!priceStr || !endDate || !livePrice) return null;

  const cleaned = priceStr.replace(/^Hit\s*/i, '').replace(/[\$,]/g, '').replace(/↑/g, '>').replace(/↓/g, '<').trim();
  const ps = (cleaned.startsWith('>') || cleaned.startsWith('<') || cleaned.includes('-')) ? cleaned : '>' + cleaned;
  const bsLive = getMarketProbability(ps, livePrice, endDate, sigma, bsTimeOffsetHours);
  const corrFrac = vwapCorrection / 100;
  const rangeBounds = parseRangeBounds(ps);

  function slotBs(slotVal: PriceSlot | number | null): SlotBs {
    if (slotVal === null) return { low: null, high: null, min: null, max: null, hasRange: false };
    let sLow = (typeof slotVal === 'object') ? slotVal.low : slotVal;
    let sHigh = (typeof slotVal === 'object') ? slotVal.high : slotVal;
    if (corrFrac > 0) {
      if (sLow) sLow = sLow * (1 + corrFrac);
      if (sHigh) sHigh = sHigh * (1 - corrFrac);
    }
    const bL = sLow ? getMarketProbability(ps, sLow, endDate, sigma, bsTimeOffsetHours) : null;
    const bH = sHigh ? getMarketProbability(ps, sHigh, endDate, sigma, bsTimeOffsetHours) : null;
    let bMin: number | null = null, bMax: number | null = null;
    if (rangeBounds && sLow && sHigh && sLow !== sHigh) {
      bMin = minimumRangeBsProb(sLow, sHigh, rangeBounds.low, rangeBounds.high, endDate, sigma, bsTimeOffsetHours).prob;
      bMax = maximumRangeBsProb(sLow, sHigh, rangeBounds.low, rangeBounds.high, endDate, sigma, bsTimeOffsetHours).prob;
    }
    return { low: bL, high: bH, min: bMin, max: bMax, hasRange: sLow !== null && sHigh !== null };
  }

  const s0 = slotBs(slots[0]);
  const s1 = slotBs(slots[1]);
  const hasDual = s0.hasRange || s1.hasRange;

  // Range price values for price flower
  const slot0Val = slots[0];
  const slot1Val = slots[1];
  const range0 = slot0Val ? {
    low: typeof slot0Val === 'object' ? slot0Val.low : slot0Val,
    high: typeof slot0Val === 'object' ? slot0Val.high : slot0Val,
  } : null;
  const range1 = slot1Val ? {
    low: typeof slot1Val === 'object' ? slot1Val.low : slot1Val,
    high: typeof slot1Val === 'object' ? slot1Val.high : slot1Val,
  } : null;

  return {
    bsLive,
    s0, s1, hasDual,
    yesLive: bsLive,
    noLive: bsLive !== null ? 1 - bsLive : null,
    range0, range1,
    livePrice,
  };
}
