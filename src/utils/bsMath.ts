// Black-Scholes math utilities — ported from public/index.html

import type { Market } from '../types';

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

// Inverse standard normal CDF (probit) — rational approximation (Beasley-Springer-Moro)
function normalCDFInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  if (p < 0.5) return -normalCDFInv(1 - p);
  const t = Math.sqrt(-2 * Math.log(1 - p));
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
  const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

// Risk-free rate
const R = 0.045;

/** Risk-free rate for one-touch / first-passage hit probabilities (crypto horizons: ~0). */
const HIT_R = 0;

function yearsToExpiryOrNull(
  endDate: string,
  bsTimeOffsetHours: number,
): number | null {
  const now = new Date(Date.now() + bsTimeOffsetHours * 3600000);
  const expiry = new Date(endDate);
  const timeToExpiryMs = expiry.getTime() - now.getTime();
  if (timeToExpiryMs <= 0) return null;
  const timeInYears = timeToExpiryMs / (365 * 24 * 60 * 60 * 1000);
  if (timeInYears < 1e-7) return null;
  return timeInYears;
}

/**
 * Risk-neutral probability that GBM touches the lower barrier H or below by T (dip / one-touch down),
 * with S0 > H. Uses the reflection closed form (same inputs as terminal BS: S0, H, σ, T; r≈0).
 */
function hitLowerBarrierTouchProb(S0: number, H: number, T: number, sigma: number, r: number): number {
  if (S0 <= H) return 1;
  if (sigma <= 0 || T <= 0) return 0;
  const nu = r - (sigma * sigma) / 2;
  const sqrtT = Math.sqrt(T);
  const sigmaSqrtT = sigma * sqrtT;
  const a = Math.log(S0 / H);
  const term1 = normalCDF((-a - nu * T) / sigmaSqrtT);
  const term2 =
    Math.pow(H / S0, (2 * nu) / (sigma * sigma)) * normalCDF((-a + nu * T) / sigmaSqrtT);
  return term1 + term2;
}

/**
 * Risk-neutral probability that GBM touches the upper barrier H or above by T (reach / one-touch up),
 * with S0 < H. Symmetric first-passage formula.
 */
function hitUpperBarrierTouchProb(S0: number, H: number, T: number, sigma: number, r: number): number {
  if (S0 >= H) return 1;
  if (sigma <= 0 || T <= 0) return 0;
  const nu = r - (sigma * sigma) / 2;
  const sqrtT = Math.sqrt(T);
  const sigmaSqrtT = sigma * sqrtT;
  const b = Math.log(H / S0);
  const term1 = normalCDF((-b + nu * T) / sigmaSqrtT);
  const term2 =
    Math.pow(H / S0, (2 * nu) / (sigma * sigma)) * normalCDF((-b - nu * T) / sigmaSqrtT);
  return term1 + term2;
}

/**
 * YES probability for weekly/monthly Hit markets: one-touch barrier (path-dependent), not terminal N(d2).
 * Expects the same `>` / `<` encoding as hitStrikeMetaForBs: `>` = reach (up touch), `<` = dip (down touch).
 */
export function getHitMarketProbability(
  priceStr: string,
  currentPrice: number,
  endDate: string,
  sigma: number,
  bsTimeOffsetHours: number = 0,
): number | null {
  if (!currentPrice || currentPrice <= 0 || !endDate) return null;
  const T = yearsToExpiryOrNull(endDate, bsTimeOffsetHours);
  if (T === null) return null;

  const cleaned = priceStr.replace(/\$/g, '').replace(/,/g, '');

  if (cleaned.startsWith('<')) {
    const target = parseNum(cleaned.substring(1));
    if (isNaN(target) || target <= 0) return null;
    const p = hitLowerBarrierTouchProb(currentPrice, target, T, sigma, HIT_R);
    return Math.max(0, Math.min(0.999, p));
  }
  if (cleaned.startsWith('>')) {
    const target = parseNum(cleaned.substring(1));
    if (isNaN(target) || target <= 0) return null;
    const p = hitUpperBarrierTouchProb(currentPrice, target, T, sigma, HIT_R);
    return Math.max(0, Math.min(0.999, p));
  }
  return null;
}

/** Market family for signal fair-value: Hit uses one-touch barrier; Above / price-on use terminal Black-Scholes. */
export type SignalTableType = 'above' | 'price' | 'hit';

/**
 * Fair YES probability used when building the Signals panel (and grid overlays).
 * Hit → {@link getHitMarketProbability}; Above / Between (price-on) → {@link getMarketProbability}.
 */
export function getSignalYesProbability(
  tableType: SignalTableType,
  bsPriceStr: string,
  currentPrice: number,
  endDate: string,
  sigma: number,
  bsTimeOffsetHours: number = 0,
): number | null {
  if (tableType === 'hit') {
    return getHitMarketProbability(bsPriceStr, currentPrice, endDate, sigma, bsTimeOffsetHours);
  }
  return getMarketProbability(bsPriceStr, currentPrice, endDate, sigma, bsTimeOffsetHours);
}

/** True if this market id appears in any asset's weekly/monthly Hit list from the API. */
export function isMarketInWeeklyHitMarkets(
  marketId: string | undefined,
  weeklyHitMarkets: Record<string, Market[]>,
): boolean {
  if (!marketId) return false;
  for (const arr of Object.values(weeklyHitMarkets)) {
    if (arr?.some((m) => m.id === marketId)) return true;
  }
  return false;
}

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
  hitBarrierModel: boolean = false,
): BsTripleResult | null {
  if (!priceStr || !endDate || !livePrice) return null;

  const cleaned = priceStr.replace(/^Hit\s*/i, '').replace(/[\$,]/g, '').replace(/↑/g, '>').replace(/↓/g, '<').trim();
  const ps = (cleaned.startsWith('>') || cleaned.startsWith('<') || cleaned.includes('-')) ? cleaned : '>' + cleaned;
  const rangeBounds = parseRangeBounds(ps);
  const probAtPrice = (spot: number) => {
    if (hitBarrierModel && !rangeBounds) {
      const h = getHitMarketProbability(ps, spot, endDate, sigma, bsTimeOffsetHours);
      if (h !== null) return h;
    }
    return getMarketProbability(ps, spot, endDate, sigma, bsTimeOffsetHours);
  };
  const bsLive = probAtPrice(livePrice);
  const corrFrac = vwapCorrection / 100;

  function slotBs(slotVal: PriceSlot | number | null): SlotBs {
    if (slotVal === null) return { low: null, high: null, min: null, max: null, hasRange: false };
    let sLow = (typeof slotVal === 'object') ? slotVal.low : slotVal;
    let sHigh = (typeof slotVal === 'object') ? slotVal.high : slotVal;
    if (corrFrac > 0) {
      if (sLow) sLow = sLow * (1 + corrFrac);
      if (sHigh) sHigh = sHigh * (1 - corrFrac);
    }
    const bL = sLow ? probAtPrice(sLow) : null;
    const bH = sHigh ? probAtPrice(sHigh) : null;
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

/**
 * Reverse Black-Scholes: given the market YES probability (mid), the strike,
 * expiry, and σ, return the spot price S implied by that probability.
 *
 * For "above" (>K) markets:  P(YES) = N(d2)  →  S = K · exp(N⁻¹(P)·σ√T − (r − σ²/2)·T)
 */
export function getImpliedSpotPrice(
  priceStr: string,
  yesProb: number,
  endDate: string,
  sigma: number,
  bsTimeOffsetHours: number = 0,
): number | null {
  if (yesProb <= 0 || yesProb >= 1 || !endDate || sigma <= 0) return null;
  const T = yearsToExpiryOrNull(endDate, bsTimeOffsetHours);
  if (T === null) return null;

  const cleaned = priceStr.replace(/\$/g, '').replace(/,/g, '');
  let strike: number | null = null;
  let isAbove = true;

  if (cleaned.startsWith('>')) {
    strike = parseNum(cleaned.substring(1));
    isAbove = true;
  } else if (cleaned.startsWith('<')) {
    strike = parseNum(cleaned.substring(1));
    isAbove = false;
  } else if (!cleaned.includes('-')) {
    strike = parseNum(cleaned);
    isAbove = true;
  }

  if (strike == null || !Number.isFinite(strike) || strike <= 0) return null;
  // Between/range markets don't have a single implied price
  if (cleaned.includes('-')) return null;

  const sqrtT = Math.sqrt(T);
  const drift = (R - (sigma * sigma) / 2) * T;

  if (isAbove) {
    // P(YES) = N(d2) where d2 = [ln(S/K) + drift] / (σ√T)
    const d2 = normalCDFInv(yesProb);
    return strike * Math.exp(d2 * sigma * sqrtT - drift);
  } else {
    // P(YES below) = 1 - N(d2) = N(-d2) → d2 = -N⁻¹(yesProb)
    const d2 = -normalCDFInv(yesProb);
    return strike * Math.exp(d2 * sigma * sqrtT - drift);
  }
}
