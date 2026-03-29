import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { AssetSymbol, Market } from '../../types';

/* ───────── constants ───────── */

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
type AssetSym = (typeof ASSETS)[number];

const ASSET_HEX: Record<AssetSym, string> = {
  BTC: '#fb923c', ETH: '#60a5fa', SOL: '#c084fc', XRP: '#22d3ee',
};

const TIMEFRAMES = ['5m', '15m', '1h', '24h'] as const;
const TF_MINUTES: Record<string, number> = { '5m': 5, '15m': 15, '1h': 60, '24h': 1440 };
const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;

/* ───────── math helpers ───────── */

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

function invNormCDF(p: number): number {
  const plow = 0.02425, phigh = 1 - plow;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628238459213];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  if (p <= 0 || p >= 1) return 0;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  const q = p - 0.5, r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

function clampP(p: number) { return Math.min(0.98, Math.max(0.02, p)); }

/* ───────── market parsing ───────── */

/** Parse groupItemTitle → numeric strike or range [low, high]. */
function parseGroupTitle(s: string): { type: 'above'; strike: number } | { type: 'between'; low: number; high: number } | null {
  if (!s) return null;
  const c = s.replace(/\$/g, '').replace(/,/g, '');
  const pn = (v: string) => { const m = v.match(/^([\d.]+)(k)?$/i); return m ? (m[2] ? parseFloat(m[1])*1000 : parseFloat(m[1])) : parseFloat(v); };
  if (c.includes('-')) {
    const parts = c.split('-');
    if (parts.length === 2) { const lo = pn(parts[0]), hi = pn(parts[1]); if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) return { type: 'between', low: lo, high: hi }; }
  }
  const gt = c.match(/^>?\s*([\d.]+k?)/i);
  if (gt) { const v = pn(gt[1]); if (Number.isFinite(v) && v > 0) return { type: 'above', strike: v }; }
  return null;
}

function yesMid(m: Market, lookup: Record<string, Market>): number | null {
  const tid = m.clobTokenIds?.[0];
  const live = tid ? lookup[tid] : null;
  const bb = live?.bestBid ?? m.bestBid;
  const ba = live?.bestAsk ?? m.bestAsk;
  if (bb != null && ba != null && Number.isFinite(bb) && Number.isFinite(ba)) return (bb + ba) / 2;
  if (bb != null && Number.isFinite(bb)) return bb;
  if (ba != null && Number.isFinite(ba)) return ba;
  if (m.lastTradePrice != null && Number.isFinite(m.lastTradePrice)) return m.lastTradePrice;
  return null;
}

/* ───────── Hit market parsing ───────── */

/** Parse Hit market groupItemTitle like "↑88,000" or "↓82,000". */
function parseHitTitle(s: string): { direction: 'up' | 'down'; barrier: number } | null {
  if (!s) return null;
  const isUp = s.includes('↑');
  const isDown = s.includes('↓');
  if (!isUp && !isDown) return null;
  const num = parseFloat(s.replace(/[↑↓,$\s]/g, ''));
  if (!Number.isFinite(num) || num <= 0) return null;
  return { direction: isUp ? 'up' : 'down', barrier: num };
}

/* ───────── Step 1: daily expected prices from Above + Between + Hit markets ───────── */

interface DailyAnchor {
  dayOffset: number;     // days from now (1–7)
  endMs: number;
  expected: number;
  q10: number;
  q90: number;
  slug: string;
}

/**
 * Build daily expected-price anchors from Above, Between, and Hit markets.
 *
 * For each unique expiry-date (eventSlug), gather all strikes/ranges/barriers and
 * their YES mids. Build a discrete CDF, compute E[price], Q10, Q90.
 *
 * Hit markets (one-touch barriers) are used to:
 * 1. Expand the confidence band — P(touch ↑K) constrains the upper quantile,
 *    P(touch ↓K) constrains the lower quantile.
 * 2. Shift expected value — asymmetric reach vs dip probabilities bias the mean.
 */
function buildDailyAnchors(
  aboveMarkets: Market[],
  priceOnMarkets: Market[],
  weeklyHitMarkets: Market[],
  s0: number,
  lookup: Record<string, Market>,
  now: number,
): DailyAnchor[] {
  const combined = [...aboveMarkets, ...priceOnMarkets].filter(m => !m.closed && m.endDate && new Date(m.endDate).getTime() > now);

  // Also gather Hit markets that are active
  const activeHits = weeklyHitMarkets.filter(m => {
    if (m.closed) return false;
    const endMs = m.endDate ? new Date(m.endDate).getTime() : 0;
    if (endMs <= now) return false;
    const title = m.groupItemTitle || '';
    if (title.includes('↓')) {
      const target = parseFloat(title.replace(/[↑↓,\s]/g, '')) || 0;
      if (target <= 0) return false;
    }
    return true;
  });

  if (combined.length === 0 && activeHits.length === 0) return [];
  if (s0 <= 0) return [];

  // Group Above + Between by eventSlug (each slug ≈ one expiry date)
  interface SlugData {
    endMs: number;
    above: { strike: number; pYes: number }[];
    between: { low: number; high: number; p: number }[];
  }
  const bySlug = new Map<string, SlugData>();
  for (const m of combined) {
    const slug = m.eventSlug || m.endDate;
    const endMs = new Date(m.endDate).getTime();
    if (!bySlug.has(slug)) bySlug.set(slug, { endMs, above: [], between: [] });
    const entry = bySlug.get(slug)!;
    const parsed = parseGroupTitle(m.groupItemTitle || '');
    const p = yesMid(m, lookup);
    if (p == null || !parsed) continue;
    if (parsed.type === 'above') entry.above.push({ strike: parsed.strike, pYes: p });
    else entry.between.push({ low: parsed.low, high: parsed.high, p });
  }

  // Group Hit markets by eventSlug
  interface HitSlugData {
    endMs: number;
    barriers: { direction: 'up' | 'down'; barrier: number; pTouch: number }[];
  }
  const hitBySlug = new Map<string, HitSlugData>();
  for (const m of activeHits) {
    const slug = m.eventSlug || m.endDate;
    const endMs = new Date(m.endDate).getTime();
    if (!hitBySlug.has(slug)) hitBySlug.set(slug, { endMs, barriers: [] });
    const entry = hitBySlug.get(slug)!;
    const parsed = parseHitTitle(m.groupItemTitle || '');
    const p = yesMid(m, lookup);
    if (p == null || !parsed) continue;
    entry.barriers.push({ direction: parsed.direction, barrier: parsed.barrier, pTouch: p });
  }

  const anchors: DailyAnchor[] = [];

  // Process Above + Between slugs
  for (const [slug, data] of bySlug) {
    const dayOffset = (data.endMs - now) / DAY_MS;
    if (dayOffset < 0.1 || dayOffset > 8) continue;

    let expected = -1;
    let q10 = -1;
    let q90 = -1;

    // Try building distribution from Between markets first (more informative)
    if (data.between.length >= 2) {
      const buckets = data.between.sort((a, b) => a.low - b.low);
      const totalP = buckets.reduce((s, b) => s + b.p, 0);
      if (totalP > 0.05) {
        let exp = 0;
        const cdf: { price: number; cum: number }[] = [];
        let cum = 0;
        for (const bk of buckets) {
          const pNorm = bk.p / totalP;
          const mid = (bk.low + bk.high) / 2;
          exp += mid * pNorm;
          cum += pNorm;
          cdf.push({ price: bk.high, cum });
        }
        const highestHigh = buckets[buckets.length - 1].high;
        const residualAbove = 1 - cum;
        if (residualAbove > 0.01) {
          exp += highestHigh * 1.03 * residualAbove;
        }
        const quantile = (q: number) => {
          for (const pt of cdf) { if (pt.cum >= q) return pt.price; }
          return cdf[cdf.length - 1]?.price ?? s0;
        };
        expected = exp;
        q10 = quantile(0.1);
        q90 = quantile(0.9);
      }
    }

    // Fallback: Above markets → build CDF from sorted strikes
    if (expected < 0 && data.above.length >= 2) {
      const sorted = data.above.sort((a, b) => a.strike - b.strike);
      let exp = 0;
      let totalP = 0;
      const cdf: { price: number; cum: number }[] = [];

      const lowestPAbove = sorted[0].pYes;
      const pBelow = 1 - lowestPAbove;
      if (pBelow > 0.001) {
        exp += sorted[0].strike * 0.97 * pBelow;
        totalP += pBelow;
      }
      cdf.push({ price: sorted[0].strike, cum: totalP });

      for (let i = 0; i < sorted.length - 1; i++) {
        const pBucket = sorted[i].pYes - sorted[i + 1].pYes;
        if (pBucket > 0) {
          exp += ((sorted[i].strike + sorted[i + 1].strike) / 2) * pBucket;
          totalP += pBucket;
        }
        cdf.push({ price: sorted[i + 1].strike, cum: totalP });
      }

      const highestPAbove = sorted[sorted.length - 1].pYes;
      if (highestPAbove > 0.001) {
        exp += sorted[sorted.length - 1].strike * 1.03 * highestPAbove;
        totalP += highestPAbove;
      }
      cdf.push({ price: sorted[sorted.length - 1].strike * 1.05, cum: totalP });

      if (totalP > 0.05) {
        expected = exp / totalP;
        const norm = cdf.map(c => ({ price: c.price, cum: c.cum / totalP }));
        const quantile = (q: number) => {
          for (const pt of norm) { if (pt.cum >= q) return pt.price; }
          return norm[norm.length - 1]?.price ?? s0;
        };
        q10 = quantile(0.1);
        q90 = quantile(0.9);
      }
    }

    if (expected > 0) {
      anchors.push({ dayOffset, endMs: data.endMs, expected, q10, q90, slug });
    }
  }

  // Process Hit market slugs — produce anchors where Above/Between don't exist,
  // or refine bands of existing anchors that share a similar expiry window.
  for (const [slug, hitData] of hitBySlug) {
    const dayOffset = (hitData.endMs - now) / DAY_MS;
    if (dayOffset < 0.1 || dayOffset > 8) continue;
    if (hitData.barriers.length === 0) continue;

    const ups = hitData.barriers.filter(b => b.direction === 'up').sort((a, b) => a.barrier - b.barrier);
    const downs = hitData.barriers.filter(b => b.direction === 'down').sort((a, b) => b.barrier - a.barrier);

    // Find an existing anchor within ±1 day of this Hit expiry
    const nearAnchor = anchors.find(a => Math.abs(a.dayOffset - dayOffset) < 1.0);

    if (nearAnchor) {
      // Refine the existing anchor's bands using Hit barriers.
      //
      // If P(touch ↑K) is high, the upper quantile should be at least K.
      // If P(touch ↓K) is high, the lower quantile should be at most K.
      // Also shift expected value based on touch asymmetry.
      for (const up of ups) {
        if (up.pTouch > 0.5 && up.barrier > nearAnchor.q90) {
          nearAnchor.q90 = up.barrier;
        }
        if (up.pTouch > 0.3 && up.barrier > nearAnchor.q90) {
          nearAnchor.q90 = nearAnchor.q90 + (up.barrier - nearAnchor.q90) * up.pTouch;
        }
      }
      for (const dn of downs) {
        if (dn.pTouch > 0.5 && dn.barrier < nearAnchor.q10) {
          nearAnchor.q10 = dn.barrier;
        }
        if (dn.pTouch > 0.3 && dn.barrier < nearAnchor.q10) {
          nearAnchor.q10 = nearAnchor.q10 - (nearAnchor.q10 - dn.barrier) * dn.pTouch;
        }
      }

      // Directional bias: shift expected value toward the side with higher touch probability
      const avgUp = ups.length > 0 ? ups.reduce((s, u) => s + u.pTouch, 0) / ups.length : 0.5;
      const avgDn = downs.length > 0 ? downs.reduce((s, d) => s + d.pTouch, 0) / downs.length : 0.5;
      const hitBias = (avgUp - avgDn) * 0.2; // small weight
      if (Math.abs(hitBias) > 0.001) {
        const range = nearAnchor.q90 - nearAnchor.q10;
        nearAnchor.expected += hitBias * range;
      }
    } else {
      // No Above/Between anchor here — create a Hit-only anchor.
      // Use barrier-touch probabilities to build a rough expected value and band.
      //
      // Expected value: s0 shifted by weighted average touch direction.
      // Band: the highest "reach" barrier with P>30% sets the upper bound;
      //        the lowest "dip" barrier with P>30% sets the lower bound.
      let hitExpected = s0;
      let hitQ90 = s0;
      let hitQ10 = s0;

      // Upper side
      for (const up of ups) {
        if (up.pTouch > 0.3) {
          hitQ90 = Math.max(hitQ90, s0 + (up.barrier - s0) * up.pTouch);
          hitExpected += (up.barrier - s0) * up.pTouch * 0.3;
        }
      }

      // Lower side
      for (const dn of downs) {
        if (dn.pTouch > 0.3) {
          hitQ10 = Math.min(hitQ10, s0 - (s0 - dn.barrier) * dn.pTouch);
          hitExpected -= (s0 - dn.barrier) * dn.pTouch * 0.3;
        }
      }

      // Fallback bands if one side has no barriers
      if (hitQ90 <= s0) hitQ90 = s0 * 1.02;
      if (hitQ10 >= s0) hitQ10 = s0 * 0.98;

      anchors.push({ dayOffset, endMs: hitData.endMs, expected: hitExpected, q10: hitQ10, q90: hitQ90, slug });
    }
  }

  anchors.sort((a, b) => a.dayOffset - b.dayOffset);
  return anchors;
}

/* ───────── Step 2: short-term drift from Up/Down markets ───────── */

interface ShortTermPoint {
  tMinutes: number;
  price: number;
  tf: string;
}

/**
 * Chain short-term Up/Down implied drifts for the first ~24 h.
 *
 * For each timeframe (5m, 15m, 1h, 24h), get P(Up), infer μ = σ√t · Φ⁻¹(P),
 * accumulate a chained expected price from current spot.
 */
function buildShortTermPath(
  asset: AssetSym,
  upOrDownMarkets: Record<string, Record<string, Market[]>>,
  s0: number,
  sigmaAnn: number,
  lookup: Record<string, Market>,
  now: number,
): ShortTermPoint[] {
  if (s0 <= 0 || sigmaAnn <= 0) return [];
  const assetData = upOrDownMarkets[asset] || {};
  const points: ShortTermPoint[] = [];

  // Gather current markets for each timeframe
  const tfMarkets: { tf: string; market: Market; endMs: number; tMinutes: number; pUp: number }[] = [];
  for (const tf of TIMEFRAMES) {
    const markets = (assetData[tf] || [])
      .filter(m => !m.closed)
      .sort((a, b) => {
        const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return ta - tb;
      });
    const idx = markets.findIndex(m => m.endDate && new Date(m.endDate).getTime() > now);
    if (idx < 0) continue;
    const m = markets[idx];
    const endMs = new Date(m.endDate).getTime();
    const tMinutes = (endMs - now) / 60_000;
    if (tMinutes <= 0.1) continue;
    const pUp = yesMid(m, lookup);
    if (pUp == null) continue;
    tfMarkets.push({ tf, market: m, endMs, tMinutes, pUp });
  }

  if (tfMarkets.length === 0) return [];

  // Sort by remaining time ascending
  tfMarkets.sort((a, b) => a.tMinutes - b.tMinutes);

  // Chain: start from s0, apply drift of each successive window
  let currentPrice = s0;
  let currentT = 0;

  for (const { tf, tMinutes, pUp } of tfMarkets) {
    const dt = tMinutes - currentT;
    if (dt <= 0) continue;
    const dtYears = (dt * 60_000) / YEAR_MS;
    const z = invNormCDF(clampP(pUp));
    const move = z * sigmaAnn * Math.sqrt(dtYears);
    currentPrice = currentPrice * Math.exp(move);
    currentT = tMinutes;
    points.push({ tMinutes, price: currentPrice, tf });
  }

  return points;
}

/* ───────── Step 3+4: full 7-day trajectory + confidence bands ───────── */

interface TrajectoryPoint {
  tDays: number;
  expected: number;
  lo: number;
  hi: number;
  label?: string;
}

function buildTrajectory(
  s0: number,
  shortTerm: ShortTermPoint[],
  dailyAnchors: DailyAnchor[],
  sigmaAnn: number,
  _now?: number,
): TrajectoryPoint[] {
  if (s0 <= 0) return [];

  const result: TrajectoryPoint[] = [];
  result.push({ tDays: 0, expected: s0, lo: s0, hi: s0, label: 'now' });

  // Short-term points (within first ~24 h)
  for (const pt of shortTerm) {
    const tDays = pt.tMinutes / 1440;
    const dtYears = tDays * DAY_MS / YEAR_MS;
    const band = 1.5 * sigmaAnn * Math.sqrt(dtYears) * s0;
    result.push({ tDays, expected: pt.price, lo: pt.price - band, hi: pt.price + band, label: pt.tf });
  }

  // If we have a short-term endpoint, anchor the blend
  const stEndT = shortTerm.length > 0 ? shortTerm[shortTerm.length - 1].tMinutes / 1440 : 0;
  const stEndPrice = shortTerm.length > 0 ? shortTerm[shortTerm.length - 1].price : s0;

  // Daily anchors
  if (dailyAnchors.length > 0) {
    // Optional: rescale day-1 anchor so short-term and daily-anchor paths join smoothly
    const day1Anchor = dailyAnchors.find(a => a.dayOffset <= 1.5);
    const scaleFactor = day1Anchor && stEndT > 0 ? stEndPrice / day1Anchor.expected : 1;

    for (const a of dailyAnchors) {
      // For the first anchor that overlaps short-term, skip if short-term already covers it well
      if (a.dayOffset <= stEndT + 0.01) continue;

      const exp = a.expected * (a.dayOffset <= 1.5 ? scaleFactor : 1);
      result.push({
        tDays: a.dayOffset,
        expected: exp,
        lo: a.q10 * (a.dayOffset <= 1.5 ? scaleFactor : 1),
        hi: a.q90 * (a.dayOffset <= 1.5 ? scaleFactor : 1),
        label: `d${Math.round(a.dayOffset)}`,
      });
    }
  }

  // If no daily anchors extend to day 7, extrapolate with flat drift + widening bands
  const lastT = result[result.length - 1].tDays;
  if (lastT < 6.5 && result.length > 1) {
    const lastExp = result[result.length - 1].expected;
    for (let d = Math.ceil(lastT + 1); d <= 7; d++) {
      const dtYears = d * DAY_MS / YEAR_MS;
      const band = 1.5 * sigmaAnn * Math.sqrt(dtYears) * s0;
      result.push({ tDays: d, expected: lastExp, lo: lastExp - band, hi: lastExp + band, label: `d${d}` });
    }
  }

  // Sort by time
  result.sort((a, b) => a.tDays - b.tDays);
  return result;
}

/* ───────── Reverse Black-Scholes forecast ───────── */

interface RbsPoint {
  tDays: number;
  price: number;
  label?: string;
}

/**
 * Reverse Black-Scholes forecast.
 *
 * For each market probability p at strike K with time-to-expiry T:
 *   implied_spot  S* = K × exp(Φ⁻¹(p) × σ√T − (r − σ²/2)T)
 *   implied_fwd   F  = S* × e^(rT) = K × exp(Φ⁻¹(p) × σ√T + σ²T/2)
 *
 * Short-term Up/Down (K = S0): chained sequentially so each step builds on the
 * previous one, producing a smooth short-term path that doesn't jump.
 *
 * Long-term Above: for each expiry, compute the implied spot S* from every strike,
 * take the median, then express as a forward price at that expiry. The path is
 * smoothly blended from the short-term endpoint to avoid a discontinuity.
 */
function buildReverseBSPath(
  asset: AssetSym,
  s0: number,
  sigmaAnn: number,
  upOrDownMarkets: Record<string, Record<string, Market[]>>,
  aboveMarkets: Market[],
  lookup: Record<string, Market>,
  now: number,
): RbsPoint[] {
  if (s0 <= 0 || sigmaAnn <= 0) return [];

  const R_BS = 0.045;
  const points: RbsPoint[] = [{ tDays: 0, price: s0 }];

  // --- Short-term: chain Up/Down implied drifts (each step relative to previous) ---
  const assetData = upOrDownMarkets[asset] || {};
  const tfEntries: { tMinutes: number; pUp: number }[] = [];
  for (const tf of TIMEFRAMES) {
    const markets = (assetData[tf] || [])
      .filter(m => !m.closed)
      .sort((a, b) => {
        const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return ta - tb;
      });
    const idx = markets.findIndex(m => m.endDate && new Date(m.endDate).getTime() > now);
    if (idx < 0) continue;
    const m = markets[idx];
    const endMs = new Date(m.endDate).getTime();
    const tMinutes = (endMs - now) / 60_000;
    if (tMinutes <= 0.1) continue;
    const pUp = yesMid(m, lookup);
    if (pUp == null) continue;
    tfEntries.push({ tMinutes, pUp });
  }
  tfEntries.sort((a, b) => a.tMinutes - b.tMinutes);

  let chainPrice = s0;
  let chainT = 0;
  for (const { tMinutes, pUp } of tfEntries) {
    const dt = tMinutes - chainT;
    if (dt <= 0) continue;
    const dtY = (dt * 60_000) / YEAR_MS;
    const z = invNormCDF(clampP(pUp));
    chainPrice = chainPrice * Math.exp(z * sigmaAnn * Math.sqrt(dtY) + (sigmaAnn * sigmaAnn * dtY) / 2);
    chainT = tMinutes;
    points.push({ tDays: tMinutes / 1440, price: chainPrice });
  }

  const stEndPrice = chainPrice;

  // --- Long-term: Above markets → implied spot per strike, median per expiry ---
  const bySlug = new Map<string, { endMs: number; impliedSpots: number[] }>();
  for (const m of aboveMarkets) {
    if (m.closed || !m.endDate) continue;
    const endMs = new Date(m.endDate).getTime();
    if (endMs <= now) continue;
    const dayOffset = (endMs - now) / DAY_MS;
    if (dayOffset < 0.1 || dayOffset > 8) continue;

    const parsed = parseGroupTitle(m.groupItemTitle || '');
    if (!parsed || parsed.type !== 'above') continue;
    const p = yesMid(m, lookup);
    if (p == null) continue;

    const K = parsed.strike;
    const Ty = (endMs - now) / YEAR_MS;
    const sqrtT = Math.sqrt(Ty);
    const z = invNormCDF(clampP(p));
    // S* = K × exp(z × σ√T − (r − σ²/2)T)
    const impliedSpot = K * Math.exp(z * sigmaAnn * sqrtT - (R_BS - (sigmaAnn * sigmaAnn) / 2) * Ty);
    if (!Number.isFinite(impliedSpot) || impliedSpot <= 0) continue;

    const slug = m.eventSlug || m.endDate;
    if (!bySlug.has(slug)) bySlug.set(slug, { endMs, impliedSpots: [] });
    bySlug.get(slug)!.impliedSpots.push(impliedSpot);
  }

  const dailyForwards: { tDays: number; fwd: number }[] = [];
  for (const [, data] of bySlug) {
    if (data.impliedSpots.length === 0) continue;
    const dayOffset = (data.endMs - now) / DAY_MS;
    const Ty = dayOffset * DAY_MS / YEAR_MS;
    const sorted = [...data.impliedSpots].sort((a, b) => a - b);
    const medianSpot = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const fwd = medianSpot * Math.exp(R_BS * Ty);
    dailyForwards.push({ tDays: dayOffset, fwd });
  }
  dailyForwards.sort((a, b) => a.tDays - b.tDays);

  // Smooth blend: scale daily forwards so the first one connects to the short-term endpoint
  if (dailyForwards.length > 0 && stEndPrice > 0) {
    const first = dailyForwards[0];
    const blendRatio = stEndPrice / first.fwd;
    for (let i = 0; i < dailyForwards.length; i++) {
      const weight = Math.max(0, 1 - i * 0.35);
      dailyForwards[i].fwd *= 1 + (blendRatio - 1) * weight;
    }
  }

  for (const df of dailyForwards) {
    const stEndTDays = chainT / 1440;
    if (df.tDays <= stEndTDays + 0.01) continue;
    points.push({ tDays: df.tDays, price: df.fwd });
  }

  // Extrapolate to day 7
  points.sort((a, b) => a.tDays - b.tDays);
  const lastPt = points[points.length - 1];
  if (lastPt && lastPt.tDays < 6.5 && points.length > 1) {
    const driftPerDay = lastPt.tDays > 0.01
      ? Math.log(lastPt.price / s0) / lastPt.tDays
      : 0;
    for (let d = Math.ceil(lastPt.tDays + 1); d <= 7; d++) {
      points.push({ tDays: d, price: s0 * Math.exp(driftPerDay * d) });
    }
  }

  points.sort((a, b) => a.tDays - b.tDays);
  return points;
}

/* ───────── SVG chart ───────── */

function ForecastChart({
  asset,
  trajectory,
  rbsPath,
  s0,
  nowMs,
}: {
  asset: AssetSym;
  trajectory: TrajectoryPoint[];
  rbsPath: RbsPoint[];
  s0: number;
  nowMs: number;
}) {
  const color = ASSET_HEX[asset];
  const W = 480;
  const H = 180;
  const padL = 48;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  if (trajectory.length < 2 || s0 <= 0) {
    return (
      <div className="rounded border border-gray-700/60 bg-gray-900/40 p-3 flex items-center justify-center min-h-[120px]">
        <span className="text-[10px] text-gray-500">{asset}: insufficient market data for forecast</span>
      </div>
    );
  }

  const tMax = Math.max(trajectory[trajectory.length - 1].tDays, 1);
  const allY = [
    ...trajectory.flatMap(p => [p.expected, p.lo, p.hi]),
    ...rbsPath.map(p => p.price),
  ];
  let yMin = Math.min(...allY);
  let yMax = Math.max(...allY);
  if (yMax - yMin < 1e-6) { yMin *= 0.999; yMax *= 1.001; }
  const padY = (yMax - yMin) * 0.06;
  yMin -= padY;
  yMax += padY;

  /** 5m / 15m / 1h each occupy a fixed 3% of inner plot width; rest is proportional time. */
  const SHORT_FIXED_FRAC = 0.03;
  const LONG_START_FRAC = 3 * SHORT_FIXED_FRAC;
  const fixedShortLabels = new Set<string>(['5m', '15m', '1h']);
  const hasFixedShortSlots = trajectory.some(p => fixedShortLabels.has(p.label ?? ''));
  const shortEndTDays = hasFixedShortSlots
    ? trajectory.filter(p => fixedShortLabels.has(p.label ?? '')).reduce((m, p) => Math.max(m, p.tDays), 0)
    : 0;
  const longSpanTDays = Math.max(tMax - shortEndTDays, 1e-9);
  const longUsableFrac = 1 - LONG_START_FRAC;

  const sxTime = (t: number) => padL + (t / tMax) * innerW;

  /** Calendar / long-horizon axis position (integer days, 24h, etc.). */
  const sxAxisFromTDays = (t: number) => {
    if (!hasFixedShortSlots) return sxTime(t);
    if (t <= 0) return padL;
    return padL + LONG_START_FRAC * innerW + ((t - shortEndTDays) / longSpanTDays) * longUsableFrac * innerW;
  };

  const sxPoint = (p: TrajectoryPoint, i: number) => {
    if (!hasFixedShortSlots) return sxTime(p.tDays);
    const lbl = p.label ?? '';
    if (p.tDays <= 0 && i === 0) return padL;
    if (lbl === '5m') return padL + SHORT_FIXED_FRAC * innerW;
    if (lbl === '15m') return padL + 2 * SHORT_FIXED_FRAC * innerW;
    if (lbl === '1h') return padL + 3 * SHORT_FIXED_FRAC * innerW;
    return sxAxisFromTDays(p.tDays);
  };

  const sy = (y: number) => padT + innerH - ((y - yMin) / (yMax - yMin)) * innerH;

  // Paths
  const expectedPath = trajectory.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sxPoint(p, i).toFixed(1)} ${sy(p.expected).toFixed(1)}`).join(' ');
  const bandPath =
    trajectory.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sxPoint(p, i).toFixed(1)} ${sy(p.hi).toFixed(1)}`).join(' ') +
    ' ' +
    [...trajectory].reverse().map((p, revI) => {
      const origI = trajectory.length - 1 - revI;
      return `L ${sxPoint(p, origI).toFixed(1)} ${sy(p.lo).toFixed(1)}`;
    }).join(' ') +
    ' Z';

  // Y-axis ticks (5 levels)
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * (yMax - yMin));
  const fmtY = (v: number) => asset === 'BTC' || asset === 'ETH'
    ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  // X-axis day ticks
  const dayTicks = [];
  for (let d = 0; d <= Math.floor(tMax); d++) dayTicks.push(d);

  // Spot horizontal reference
  const spotY = sy(s0);

  return (
    <div className="rounded border border-gray-700/60 bg-gray-900/40 p-1.5 min-w-0 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-0.5 px-0.5 shrink-0">
        <span className="text-[11px] font-bold" style={{ color }}>{asset} 7-Day Forecast</span>
        <span className="text-[9px] text-gray-500 tabular-nums">Spot ${s0.toLocaleString()}</span>
      </div>
      <svg className="w-full flex-1 min-h-0 block" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${asset} 7-day price forecast`}>
        <defs>
          <linearGradient id={`pf7-band-h-${asset}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.32" />
            <stop offset="40%" stopColor={color} stopOpacity="0.16" />
            <stop offset="100%" stopColor={color} stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* y-axis grid */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={sy(v)} y2={sy(v)} stroke="rgba(75,85,99,0.25)" strokeDasharray="3 3" strokeWidth={0.5} />
            <text x={3} y={sy(v) + 3} className="fill-gray-500" style={{ fontSize: 7.5 }}>{fmtY(v)}</text>
          </g>
        ))}

        {/* x-axis day labels */}
        {dayTicks.map(d => (
          <g key={d}>
            <line x1={sxAxisFromTDays(d)} x2={sxAxisFromTDays(d)} y1={padT} y2={H - padB} stroke="rgba(75,85,99,0.18)" strokeWidth={0.5} />
            <text x={sxAxisFromTDays(d)} y={H - 8} textAnchor="middle" className="fill-gray-500" style={{ fontSize: 8 }}>
              {d === 0 ? 'now' : (() => { const dt = new Date(nowMs + d * DAY_MS); const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()]; return `${mo} ${dt.getDate()}`; })()}
            </text>
          </g>
        ))}

        {/* spot reference line */}
        <line x1={padL} x2={W - padR} y1={spotY} y2={spotY} stroke="rgba(250,204,21,0.25)" strokeDasharray="4 4" strokeWidth={0.7} />

        {/* confidence band (shaded area) */}
        <path d={bandPath} fill={`url(#pf7-band-h-${asset})`} />
        {/* band borders */}
        <path d={trajectory.map((p, i) => `${i===0?'M':'L'} ${sxPoint(p, i).toFixed(1)} ${sy(p.hi).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={0.8} strokeDasharray="3 2" />
        <path d={trajectory.map((p, i) => `${i===0?'M':'L'} ${sxPoint(p, i).toFixed(1)} ${sy(p.lo).toFixed(1)}`).join(' ')} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={0.8} strokeDasharray="3 2" />

        {/* expected price line */}
        <path d={expectedPath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {/* reverse Black-Scholes forecast (dotted, own x-axis mapping) */}
        {rbsPath.length >= 2 && (() => {
          const rbsD = rbsPath.map((p, i) =>
            `${i === 0 ? 'M' : 'L'} ${sxAxisFromTDays(p.tDays).toFixed(1)} ${sy(p.price).toFixed(1)}`
          ).join(' ');
          return <path d={rbsD} fill="none" stroke="#facc15" strokeWidth={1.4} strokeDasharray="5 3" strokeLinejoin="round" strokeLinecap="round" strokeOpacity={0.7} />;
        })()}

        {/* dots on expected line */}
        {trajectory.map((p, i) => (
          <g key={i}>
            <title>{`${p.label ?? `t=${p.tDays.toFixed(2)}d`}: $${p.expected.toLocaleString()} (${fmtY(p.lo)}–${fmtY(p.hi)})`}</title>
            <circle cx={sxPoint(p, i)} cy={sy(p.expected)} r={i === 0 ? 3.5 : 2.5} fill={i === 0 ? color : '#e5e7eb'} stroke={color} strokeWidth={i === 0 ? 0 : 1} />
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-0.5 mt-0.5 text-[8px] text-gray-500 shrink-0">
        <span><span style={{ color }}>—</span> crowd-implied</span>
        <span><span className="text-yellow-400/70">┄</span> reverse BS</span>
        <span><span style={{ color, opacity: 0.4 }}>╌</span> 10–90% band</span>
        <span><span className="text-yellow-300/50">╌</span> spot</span>
      </div>
    </div>
  );
}

/* ───────── main panel ───────── */

export function PriceForecastPanel() {
  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const aboveMarkets = useAppStore((s) => s.aboveMarkets);
  const priceOnMarkets = useAppStore((s) => s.priceOnMarkets);
  const weeklyHitMarkets = useAppStore((s) => s.weeklyHitMarkets);
  const marketLookup = useAppStore((s) => s.marketLookup);
  const bidAskTick = useAppStore((s) => s.bidAskTick);
  const priceData = useAppStore((s) => s.priceData);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);

  // Tick counter to force re-compute every N seconds without Date.now() in deps
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  const { byAsset, nowMs } = useMemo(() => {
    const now = Date.now() + bsTimeOffsetHours * 3600_000;
    const out: Record<AssetSym, { s0: number; trajectory: TrajectoryPoint[]; rbsPath: RbsPoint[] }> = {} as any;
    for (const asset of ASSETS) {
      const sym = `${asset}USDT` as AssetSymbol;
      const s0 = priceData[sym]?.price ?? 0;
      const sigma = (volatilityData[sym] || 0.6) * volMultiplier;

      const shortTerm = buildShortTermPath(asset, upOrDownMarkets, s0, sigma, marketLookup, now);
      const dailyAnchors = buildDailyAnchors(aboveMarkets[asset] || [], priceOnMarkets[asset] || [], weeklyHitMarkets[asset] || [], s0, marketLookup, now);
      const trajectory = buildTrajectory(s0, shortTerm, dailyAnchors, sigma, now);
      const rbsPath = buildReverseBSPath(asset, s0, sigma, upOrDownMarkets, aboveMarkets[asset] || [], marketLookup, now);

      out[asset] = { s0, trajectory, rbsPath };
    }
    return { byAsset: out, nowMs: now };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upOrDownMarkets, aboveMarkets, priceOnMarkets, weeklyHitMarkets, marketLookup, priceData, volatilityData, volMultiplier, bsTimeOffsetHours, bidAskTick, tick]);

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0 h-full">
      <div className="panel-header flex flex-col gap-1 mb-2 shrink-0 cursor-grab">
        <h3 className="text-sm font-bold text-teal-300">Price Forecast</h3>
        <p className="text-[9px] text-gray-500 leading-snug cursor-default" onPointerDown={(e) => e.stopPropagation()}>
          7-day implied trajectories. First 24 h driven by <span className="text-gray-400">5m/15m/1h/24h</span> up-or-down
          markets (high granularity), then anchored to daily <span className="text-gray-400">Above</span>,{' '}
          <span className="text-gray-400">Between</span>, and <span className="text-gray-400">Hit</span> (weekly reach/dip)
          market expected values. Hit barriers widen confidence bands and bias direction. Shaded band =
          10th–90th-percentile confidence (or ±1.5σ√t in the short term). Illustrative crowd-implied forecast, not
          financial advice.
        </p>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 sm:grid-rows-2 gap-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {ASSETS.map((asset) => (
          <ForecastChart key={asset} asset={asset} s0={byAsset[asset].s0} trajectory={byAsset[asset].trajectory} rbsPath={byAsset[asset].rbsPath} nowMs={nowMs} />
        ))}
      </div>
    </div>
  );
}
