import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { AssetName, Market } from '../../types';
import { ASSET_COLORS } from '../../types';
import { API_BASE, WS_BASE } from '../../lib/env';
import { useChainlinkPricesMap } from '../../hooks/usePolymarketPrice';
import { assetToSymbol, formatPrice } from '../../utils/format';

const ALL_ASSETS: AssetName[] = ['BTC', 'ETH', 'SOL', 'XRP'];

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
type KlineInterval = (typeof INTERVALS)[number];

const CANDLE_COUNTS = [10, 20, 50] as const;
type CandleCount = (typeof CANDLE_COUNTS)[number];

const INTERVAL_MS: Record<KlineInterval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

type ChartPriceSource = 'binance' | 'chainlink';

const UP_DOWN_TABLE_TFS = ['5m', '15m', '1h', '4h', '24h'] as const;
type UpDownTableTf = (typeof UP_DOWN_TABLE_TFS)[number];

function upDownTableTfToKlineInterval(tf: string): KlineInterval | null {
  if (tf === '24h') return '1d';
  if (tf === '5m' || tf === '15m' || tf === '1h' || tf === '4h') return tf;
  return null;
}

function findUpDownTableTfForMarket(
  asset: AssetName,
  marketId: string | undefined,
  upOrDown: Record<string, Record<string, Market[]>>,
): UpDownTableTf | null {
  if (!marketId) return null;
  const buckets = upOrDown[asset];
  if (!buckets) return null;
  for (const tf of UP_DOWN_TABLE_TFS) {
    const arr = buckets[tf];
    if (arr?.some((m) => m.id === marketId)) return tf;
  }
  return null;
}

function parseCandleCount(raw: string | null): CandleCount {
  if (raw === '10' || raw === '20' || raw === '50') return Number(raw) as CandleCount;
  return 50;
}

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

function parseKlines(raw: unknown[]): Candle[] {
  const out: Candle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const t = Number(row[0]);
    const o = parseFloat(String(row[1]));
    const h = parseFloat(String(row[2]));
    const l = parseFloat(String(row[3]));
    const c = parseFloat(String(row[4]));
    if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    out.push({ t, o, h, l, c });
  }
  return out;
}

function mergeKlineIntoSeries(prev: Candle[], t: number, o: number, h: number, l: number, c: number, windowStart: number): Candle[] {
  const candle: Candle = { t, o, h, l, c };
  const idx = prev.findIndex((x) => x.t === t);
  let next: Candle[];
  if (idx >= 0) {
    next = prev.slice();
    next[idx] = candle;
  } else {
    next = [...prev, candle].sort((a, b) => a.t - b.t);
  }
  return next.filter((x) => x.t >= windowStart);
}

/** Binance spot kline stream (raw WS) */
const BINANCE_SPOT_WS_BASE = 'wss://stream.binance.com:9443/ws';

/** Synthetic token id for polycandles Chainlink OHLC (see polycandles chainlinkTokenId). */
function chainlinkKlineSymbol(asset: AssetName): string {
  return `chainlink_${asset.toLowerCase()}usd`;
}

/** Polycandles /api/v3/klines only supports 1m, 5m, 15m, 1h — coarser selections use 1h bars. */
function polycandlesChartInterval(tf: KlineInterval): '1m' | '5m' | '15m' | '1h' {
  if (tf === '4h' || tf === '1d') return '1h';
  return tf;
}

function chartBarMsForWindow(timeframe: KlineInterval, priceSource: ChartPriceSource): number {
  if (priceSource === 'chainlink') {
    return INTERVAL_MS[polycandlesChartInterval(timeframe)];
  }
  return INTERVAL_MS[timeframe];
}

function candleWindowStart(now: number, candleCount: CandleCount, timeframe: KlineInterval, priceSource: ChartPriceSource): number {
  return now - candleCount * chartBarMsForWindow(timeframe, priceSource);
}

/** Paths from Simple Icons (MIT); used in the candle-source toggle only. */
const BINANCE_LOGO_PATH =
  'M16.624 13.9202l2.7175 2.7154-7.353 7.353-7.353-7.352 2.7175-2.7164 4.6355 4.6595 4.6356-4.6595zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164zm-9.272.001l2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164zM11.9885.0115l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6595-2.7174-2.7154 7.353-7.353z';

const CHAINLINK_LOGO_PATH =
  'M12 0L9.798 1.266l-6 3.468L1.596 6v12l2.202 1.266 6.055 3.468L12.055 24l2.202-1.266 5.945-3.468L22.404 18V6l-2.202-1.266-6-3.468zM6 15.468V8.532l6-3.468 6 3.468v6.936l-6 3.468z';

const YEAR_MS = 365.25 * 86_400_000;

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

const SR_TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;

type UpDownTfKey = (typeof SR_TIMEFRAMES)[number];
type RBSTfLine = { tf: UpDownTfKey; price: number; followsSpot: boolean };
const RBS_TF_LABEL: Record<UpDownTfKey, string> = {
  '5m': 'RBS5',
  '15m': 'RBS15',
  '1h': 'RBS1H',
  '4h': 'RBS4H',
  '24h': 'RBS24',
};

/** Distinct line/label color per RBS timeframe (canvas hex). */
const RBS_TF_COLOR: Record<UpDownTfKey, string> = {
  '5m': '#f97316',
  '15m': '#38bdf8',
  '1h': '#fbbf24',
  '4h': '#818cf8',
  '24h': '#c084fc',
};

/** Canvas paint order: lower drawn first (underneath); 5m is topmost when prices coincide. */
const RBS_CANVAS_LAYER: Record<UpDownTfKey, number> = {
  '24h': 0,
  '4h': 1,
  '1h': 2,
  '15m': 3,
  '5m': 4,
};

function rbsTfLinesForCanvasPaint(lines: RBSTfLine[]): RBSTfLine[] {
  return [...lines].sort((a, b) => RBS_CANVAS_LAYER[a.tf] - RBS_CANVAS_LAYER[b.tf]);
}

/** Keep tiny epsilon for metadata only; inversion always uses clamped probability. */
const RBS_SATURATION_EPS = 1e-3;
/** Hide RBS lines when market probability is too extreme (<=2% or >=98%). */
const RBS_HIDE_EXTREME_PROB = 0.02;
/** For RBS, skip markets that are too close to expiry (noisy final seconds). */
const RBS_MIN_TTE_MS = 30_000;

type RBSComputeResult =
  | { kind: 'price'; value: number; followsSpot: boolean; usedTimeframes: UpDownTfKey[]; tfLines: RBSTfLine[] }
  | { kind: 'hold' }
  | { kind: 'clear' };

const DEFAULT_RBS_TF_ENABLED: Record<UpDownTfKey, boolean> = {
  '5m': true,
  '15m': true,
  '1h': true,
  '4h': true,
  '24h': true,
};

function visibleRbsTimeframesForSource(source: ChartPriceSource): UpDownTfKey[] {
  return source === 'chainlink' ? ['5m', '15m'] : ['1h', '4h', '24h'];
}

function parseRbsTfEnabledFromStorage(raw: string | null): Record<UpDownTfKey, boolean> {
  if (!raw) return { ...DEFAULT_RBS_TF_ENABLED };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const next = { ...DEFAULT_RBS_TF_ENABLED };
    for (const tf of SR_TIMEFRAMES) {
      if (typeof o[tf] === 'boolean') next[tf] = o[tf];
    }
    return next;
  } catch {
    return { ...DEFAULT_RBS_TF_ENABLED };
  }
}

/** Polymarket Gamma `volume` (USDC) for weighting; 0 if missing. */
function marketVolumeUsdc(m: Market, tokenId: string, lookup: Record<string, Market>): number {
  const raw: unknown = m.volume ?? (tokenId ? lookup[tokenId]?.volume : undefined);
  if (raw === undefined || raw === null) return 0;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === 'string') {
    const n = parseFloat(raw.replace(/,/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return 0;
}

/**
 * Reverse Black-Scholes predicted price from up/down markets.
 *
 * For each timeframe with strike K, P(S_T > K) = pUp, time T:
 *   S* = K × exp( Φ⁻¹(pUp) × σ√T + σ²T/2 )
 *
 * Final price = weighted average of per-timeframe implied prices.
 * When `volWeightAdjusted`: weight = Polymarket volume (USDC) × (1/√T). Otherwise weight = 1/√T only.
 *
 * If a market probability is saturated (~0% or ~100%), inversion becomes unbounded;
 * in that case we snap that market's implied spot to the current spot (`s0`).
 * If no live markets, returns `clear`.
 */
function computeRBSPriceResult(
  s0: number,
  sigma: number,
  assetMarkets: Record<string, Market[]>,
  marketLookup: Record<string, Market>,
  now: number,
  rbsTfEnabled: Record<UpDownTfKey, boolean>,
): RBSComputeResult {
  if (s0 <= 0 || sigma <= 0) return { kind: 'clear' };

  const tfLines: RBSTfLine[] = [];

  for (const tf of SR_TIMEFRAMES) {
    if (!rbsTfEnabled[tf]) continue;
    const markets = (assetMarkets[tf] || [])
      .filter((m: Market) => !m.closed && m.endDate)
      .sort((a: Market, b: Market) => {
        const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return ta - tb;
      });
    // Shortest available market that still has >=30s to expiry.
    const m = markets.find((x: Market) => {
      if (!x.endDate) return false;
      const tte = new Date(x.endDate).getTime() - now;
      return tte >= RBS_MIN_TTE_MS;
    });
    if (!m?.endDate) continue;
    const endMs = new Date(m.endDate).getTime();
    if (endMs <= now) continue;

    const tYears = (endMs - now) / YEAR_MS;
    if (tYears <= 1e-9) continue;
    const tokenId = m.clobTokenIds?.[0] || '';
    const strike = m.priceToBeat ?? (tokenId ? marketLookup[tokenId]?.priceToBeat : undefined);
    if (strike == null || !Number.isFinite(strike) || strike <= 0) continue;
    const live = tokenId ? marketLookup[tokenId] : null;
    const bb = live?.bestBid ?? m.bestBid;
    const ba = live?.bestAsk ?? m.bestAsk;
    let pUp = 0.5;
    if (bb != null && ba != null && Number.isFinite(bb) && Number.isFinite(ba)) pUp = (bb + ba) / 2;
    else if (bb != null && Number.isFinite(bb)) pUp = bb;
    else if (ba != null && Number.isFinite(ba)) pUp = ba;

    if (pUp <= RBS_HIDE_EXTREME_PROB || pUp >= 1-RBS_HIDE_EXTREME_PROB) continue;
    const z = invNormCDF(clampP(pUp));
    const sqrtT = Math.sqrt(tYears);
    const impliedSpot = strike * Math.exp(z * sigma * sqrtT + (sigma * sigma * tYears) / 2);
    if (!Number.isFinite(impliedSpot) || impliedSpot <= 0) continue;
    const followsSpot = pUp <= RBS_SATURATION_EPS || pUp >= 1 - RBS_SATURATION_EPS;
    tfLines.push({ tf, price: impliedSpot, followsSpot });
  }

  // Strict priority mode: selected value is first available timeframe in order 5m -> 15m -> 1h -> 4h -> 24h.
  if (tfLines.length > 0) {
    const selected = tfLines[0];
    return {
      kind: 'price',
      value: selected.price,
      followsSpot: selected.followsSpot,
      usedTimeframes: [selected.tf],
      tfLines,
    };
  }
  return { kind: 'clear' };
}

interface SRLine {
  price: number;
  probUp: number;
  label: string;
}

/** Align with `index.css` `.price-yes` / `.price-no` and YES/NO grid accents (emerald / red). */
function srLineColor(probUp: number): string {
  if (probUp > 0.55) return '#10b981';
  if (probUp < 0.45) return '#ef4444';
  return '#6b7280';
}

/** Stronger line when YES probability is far from 50% (conviction). */
function srLineOpacity(probUp: number): number {
  const deviation = 2 * Math.abs(probUp - 0.5);
  const minA = 0.18;
  const maxA = 0.92;
  return minA + deviation * (maxA - minA);
}

/** Same breakpoints as `srLineColor`: bullish ▲, bearish ▼, else none. */
function srLineTriangleDir(probUp: number): 'up' | 'down' | null {
  if (probUp > 0.55) return 'up';
  if (probUp < 0.45) return 'down';
  return null;
}

function drawSrLabelTriangle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  dir: 'up' | 'down',
  fillStyle: string,
) {
  const w = 3.5;
  const h = 4.5;
  ctx.beginPath();
  if (dir === 'up') {
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx - w, cy + h * 0.55);
    ctx.lineTo(cx + w, cy + h * 0.55);
  } else {
    ctx.moveTo(cx - w, cy - h * 0.55);
    ctx.lineTo(cx + w, cy - h * 0.55);
    ctx.lineTo(cx, cy + h);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

const SR_PRICE_DECIMALS: Record<AssetName, number> = {
  BTC: 0,
  ETH: 1,
  SOL: 2,
  XRP: 4,
};

function formatSrStrike(p: number, asset: AssetName): string {
  const d = SR_PRICE_DECIMALS[asset] ?? 2;
  return p.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** S/R and RBS lines only widen the Y scale if within this fraction of the candle range beyond the wicks (so distant strikes don’t squash candles). */
const SR_RBS_NEAR_CANDLE_RANGE_FRAC = 0.15;

/** Candle colors: same family as `.price-yes` / `.price-no` in index.css and `text-green-400` / `text-red-400` grids (Tailwind emerald-500/400, red-500/400). */
const CANDLE_BULL_BODY = '#10b981';
const CANDLE_BULL_WICK = '#34d399';
const CANDLE_BEAR_BODY = '#ef4444';
const CANDLE_BEAR_WICK = '#f87171';

function drawCandles(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  candles: Candle[],
  interval: KlineInterval,
  srLines: SRLine[],
  asset: AssetName,
  rbsTfLines: RBSTfLine[],
  selectedRbsTf: UpDownTfKey | null,
) {
  ctx.fillStyle = '#0f1419';
  ctx.fillRect(0, 0, w, h);

  const padL = 52;
  const padR = 8;
  const padT = 8;
  const padB = 22;
  const cw = w - padL - padR;
  const ch = h - padT - padB;
  if (candles.length === 0 || cw <= 0 || ch <= 0) return;

  const rbsPaintOrder = rbsTfLinesForCanvasPaint(rbsTfLines);

  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    lo = Math.min(lo, c.l, c.o, c.c);
    hi = Math.max(hi, c.h, c.o, c.c);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    const mid = Number.isFinite(lo) ? lo : 0;
    lo = mid * 0.999;
    hi = mid * 1.001;
  }

  const candleLo = lo;
  const candleHi = hi;
  let span0 = candleHi - candleLo;
  if (!Number.isFinite(span0) || span0 <= 0) {
    span0 = Math.max(Math.abs(candleHi) * 1e-8, 1e-9);
  }
  const nearSlack = Math.max(span0 * SR_RBS_NEAR_CANDLE_RANGE_FRAC, Math.abs(candleHi) * 1e-10);

  for (const sr of srLines) {
    if (!Number.isFinite(sr.price)) continue;
    if (sr.price < candleLo - nearSlack || sr.price > candleHi + nearSlack) continue;
    lo = Math.min(lo, sr.price);
    hi = Math.max(hi, sr.price);
  }
  for (const rl of rbsTfLines) {
    if (!Number.isFinite(rl.price)) continue;
    if (rl.price >= candleLo - nearSlack && rl.price <= candleHi + nearSlack) {
      lo = Math.min(lo, rl.price);
      hi = Math.max(hi, rl.price);
    }
  }

  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    const mid = Number.isFinite(lo) ? lo : 0;
    lo = mid * 0.999;
    hi = mid * 1.001;
  }
  const span = hi - lo;
  const padP = Math.max(span * 0.06, span * 1e-6);
  lo -= padP;
  hi += padP;

  const yPx = (p: number) => {
    if (hi <= lo) return padT + ch / 2;
    const t = (hi - p) / (hi - lo);
    return padT + t * ch;
  };
  const n = candles.length;
  const slot = cw / n;
  const bodyW = Math.max(1, Math.min(slot * 0.72, 12));

  // grid
  ctx.strokeStyle = 'rgba(75,85,99,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (i / 4) * ch;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + cw, y);
    ctx.stroke();
    const price = hi - (i / 4) * (hi - lo);
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(price < 1 ? price.toFixed(4) : price.toFixed(price >= 1000 ? 0 : 2), padL - 4, y);
  }

  const yTop = padT;
  const yBot = padT + ch;
  const clampY = (y: number) => Math.min(yBot, Math.max(yTop, y));

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, cw, ch);
  ctx.clip();

  // S/R lines (drawn behind candles)
  for (const sr of srLines) {
    const y = yPx(sr.price);
    if (y < yTop - 1 || y > yBot + 1) continue;
    const color = srLineColor(sr.probUp);
    const dashByTf: Record<string, number[]> = {
      '5m':  [2, 3],
      '15m': [4, 5],
      '1h':  [8, 6],
      '24h': [14, 8],
    };
    ctx.setLineDash(dashByTf[sr.label] || [6, 4]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = srLineOpacity(sr.probUp);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + cw, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const tag = sr.label;
    ctx.font = 'bold 9px ui-sans-serif, system-ui, sans-serif';
    const tw = ctx.measureText(tag).width;
    const triDir = srLineTriangleDir(sr.probUp);
    const triColW = triDir != null ? 11 : 0;
    const labelPadL = padL + 4;
    const tagX = labelPadL + triColW;
    const tagY = y;
    ctx.fillStyle = 'rgba(15,20,25,0.8)';
    ctx.fillRect(labelPadL - 3, tagY - 7, triColW + tw + 6, 13);
    if (triDir != null) {
      drawSrLabelTriangle(ctx, labelPadL + 4, tagY, triDir, color);
    }
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, tagX, tagY);
  }

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const cx = padL + i * slot + slot / 2;
    const yH = clampY(yPx(c.h));
    const yL = clampY(yPx(c.l));
    const yO = clampY(yPx(c.o));
    const yC = clampY(yPx(c.c));
    const top = Math.min(yO, yC);
    const bot = Math.max(yO, yC);
    const bull = c.c >= c.o;
    const wick = bull ? CANDLE_BULL_WICK : CANDLE_BEAR_WICK;
    const fill = bull ? CANDLE_BULL_BODY : CANDLE_BEAR_BODY;
    ctx.strokeStyle = wick;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, yH);
    ctx.lineTo(cx, yL);
    ctx.stroke();
    const bh = Math.max(1, bot - top);
    ctx.fillStyle = fill;
    ctx.fillRect(cx - bodyW / 2, top, bodyW, bh);
    if (bh <= 1) {
      ctx.fillRect(cx - bodyW / 2, Math.max(yTop, top - 0.5), bodyW, 1);
    }
  }

  // Reverse BS predicted lines per timeframe (paint order: 24h bottom → 5m top).
  for (const rl of rbsPaintOrder) {
    const y = yPx(rl.price);
    if (y >= yTop - 1 && y <= yBot + 1) {
      const isSelected = selectedRbsTf != null && rl.tf === selectedRbsTf;
      const tfColor = RBS_TF_COLOR[rl.tf];
      ctx.setLineDash([6, 3]);
      ctx.strokeStyle = tfColor;
      ctx.lineWidth = isSelected ? 1.7 : 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + cw, y);
      ctx.stroke();
      ctx.setLineDash([]);

      const tag = RBS_TF_LABEL[rl.tf];
      ctx.font = 'bold 9px ui-sans-serif, system-ui, sans-serif';
      const tw = ctx.measureText(tag).width;
      const tagX = padL + 4;
      ctx.fillStyle = 'rgba(15,20,25,0.8)';
      ctx.fillRect(tagX - 3, y - 7, tw + 6, 13);
      ctx.fillStyle = tfColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, tagX, y);
    }
  }

  ctx.restore();

  // S/R target prices on Y-axis (left margin, aligned with each line)
  ctx.font = 'bold 9px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const sr of srLines) {
    const y = yPx(sr.price);
    if (y < yTop || y > yBot) continue;
    const color = srLineColor(sr.probUp);
    const txt = formatSrStrike(sr.price, asset);
    const tw = ctx.measureText(txt).width;
    const ax = padL - 4;
    const pillL = Math.max(2, ax - tw - 4);
    ctx.fillStyle = 'rgba(15,20,25,0.9)';
    ctx.fillRect(pillL, y - 5, ax - pillL + 2, 10);
    ctx.fillStyle = color;
    ctx.fillText(txt, ax, y);
  }

  // RBS timeframe prices on Y-axis (same stacking as horizontal lines).
  for (const rl of rbsPaintOrder) {
    const y = yPx(rl.price);
    if (y >= yTop && y <= yBot) {
      const txt = formatSrStrike(rl.price, asset);
      const tw = ctx.measureText(txt).width;
      const ax = padL - 4;
      const pillL = Math.max(2, ax - tw - 4);
      ctx.fillStyle = 'rgba(15,20,25,0.9)';
      ctx.fillRect(pillL, y - 5, ax - pillL + 2, 10);
      ctx.fillStyle = RBS_TF_COLOR[rl.tf];
      ctx.fillText(txt, ax, y);
    }
  }

  // x labels (first, mid, last)
  ctx.fillStyle = '#6b7280';
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const fmtT = (ms: number) => {
    const d = new Date(ms);
    if (interval === '1d' || interval === '4h' || interval === '1h') {
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`;
    }
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const labels = [
    { i: 0, t: candles[0].t },
    { i: Math.floor(n / 2), t: candles[Math.floor(n / 2)].t },
    { i: n - 1, t: candles[n - 1].t },
  ];
  for (const { i, t } of labels) {
    const cx = padL + i * slot + slot / 2;
    ctx.fillText(fmtT(t), cx, h - padB + 4);
  }
}

interface BinanceChartPanelProps {
  panelId: string;
  initialAsset: AssetName;
  assetOverride?: AssetName;
  forcedPriceSource?: ChartPriceSource;
  compact?: boolean;
  hideRbsSettings?: boolean;
  /** When true (e.g. UpOrDown HUD): draw strike S/R + RBS lines only for timeframes tied to this chart's price source, and only while that feed is live (5m/15m ↔ Chainlink; 1h/4h/24h ↔ Binance). */
  hudGateSupportLinesByExchange?: boolean;
  /** When true with `forcedPriceSource="binance"` (HUD): set candle resolution from the selected Up/Down market row (1h→1h, 4h→4h, 24h→1d). */
  hudSyncBinanceIntervalFromMarket?: boolean;
}

export function BinanceChartPanel({ panelId, initialAsset, assetOverride, forcedPriceSource, compact = false, hideRbsSettings = false, hudGateSupportLinesByExchange = false, hudSyncBinanceIntervalFromMarket = false }: BinanceChartPanelProps) {
  const portalRoot = typeof document !== 'undefined' ? document.body : null;
  const [asset, setAsset] = useState<AssetName>(() => {
    if (assetOverride) return assetOverride;
    const saved = localStorage.getItem(`polybot-binance-chart-asset-${panelId}`);
    if (saved && ALL_ASSETS.includes(saved as AssetName)) return saved as AssetName;
    return initialAsset;
  });
  const [timeframe, setTimeframe] = useState<KlineInterval>(() => {
    const saved = localStorage.getItem(`polybot-binance-interval-${panelId}`) as KlineInterval | null;
    if (saved && INTERVALS.includes(saved)) return saved;
    return '15m';
  });
  const [candleCount, setCandleCount] = useState<CandleCount>(() =>
    parseCandleCount(localStorage.getItem(`polybot-binance-candle-count-${panelId}`)),
  );
  const [priceSource, setPriceSource] = useState<ChartPriceSource>(() => {
    if (forcedPriceSource) return forcedPriceSource;
    const saved = localStorage.getItem(`polybot-binance-chart-source-${panelId}`) as ChartPriceSource | null;
    return saved === 'chainlink' ? 'chainlink' : 'binance';
  });
  const [assetDropdownOpen, setAssetDropdownOpen] = useState(false);
  const [rbsSettingsOpen, setRbsSettingsOpen] = useState(false);
  useEffect(() => {
    if (assetOverride && asset !== assetOverride) setAsset(assetOverride);
  }, [assetOverride, asset]);
  useEffect(() => {
    if (forcedPriceSource && priceSource !== forcedPriceSource) setPriceSource(forcedPriceSource);
  }, [forcedPriceSource, priceSource]);
  const [rbsTfEnabled, setRbsTfEnabled] = useState<Record<UpDownTfKey, boolean>>(() =>
    parseRbsTfEnabledFromStorage(localStorage.getItem(`polybot-binance-rbs-tf-${panelId}`)),
  );
  const [rbsVolWeightAdjusted, setRbsVolWeightAdjusted] = useState(() => {
    const raw = localStorage.getItem(`polybot-binance-rbs-vol-weight-${panelId}`);
    return raw !== 'false';
  });
  // Pulse "start when deviation >= threshold" (percentage, e.g. 0.05 means 0.05%).
  const [rbsPulseThresholdPct, setRbsPulseThresholdPct] = useState(() => {
    const raw = localStorage.getItem(`polybot-binance-rbs-pulse-threshold-${panelId}`);
    const v = raw == null ? 0.05 : Number(raw);
    if (!Number.isFinite(v)) return 0.05;
    // Keep sane bounds: 0%..5%.
    return Math.max(0, Math.min(5, v));
  });
  const [rbsSettingsMenuPos, setRbsSettingsMenuPos] = useState<{ left: number; top: number } | null>(null);
  const rbsSettingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const rbsSettingsMenuRef = useRef<HTMLDivElement | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartHeaderStackControls, setChartHeaderStackControls] = useState(false);
  const visibleRbsTimeframes = useMemo(() => visibleRbsTimeframesForSource(priceSource), [priceSource]);
  const effectiveRbsTfEnabled = useMemo<Record<UpDownTfKey, boolean>>(() => {
    const visible = new Set<UpDownTfKey>(visibleRbsTimeframes);
    return {
      '5m': visible.has('5m') ? !!rbsTfEnabled['5m'] : false,
      '15m': visible.has('15m') ? !!rbsTfEnabled['15m'] : false,
      '1h': visible.has('1h') ? !!rbsTfEnabled['1h'] : false,
      '4h': visible.has('4h') ? !!rbsTfEnabled['4h'] : false,
      '24h': visible.has('24h') ? !!rbsTfEnabled['24h'] : false,
    };
  }, [rbsTfEnabled, visibleRbsTimeframes]);

  const priceData = useAppStore((s) => s.priceData);
  useAppStore((s) => s.bidAskTick);
  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const marketLookup = useAppStore((s) => s.marketLookup);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const sym = assetToSymbol(asset);
  const livePrice = priceData[sym]?.price ?? 0;
  const chainlinkPrices = useChainlinkPricesMap();
  const spotForChart = useMemo(() => {
    if (priceSource === 'chainlink') {
      const cl = chainlinkPrices[asset];
      if (cl != null && Number.isFinite(cl) && cl > 0) return cl;
    }
    return livePrice;
  }, [priceSource, chainlinkPrices, asset, livePrice]);

  const hudExchangeSpotReady = useMemo(() => {
    if (!hudGateSupportLinesByExchange) return true;
    if (priceSource === 'chainlink') {
      const cl = chainlinkPrices[asset];
      return cl != null && Number.isFinite(cl) && cl > 0;
    }
    return livePrice > 0 && Number.isFinite(livePrice);
  }, [hudGateSupportLinesByExchange, priceSource, chainlinkPrices, asset, livePrice]);

  const rbsTfEnabledForCompute = useMemo<Record<UpDownTfKey, boolean>>(() => {
    if (!hudGateSupportLinesByExchange || hudExchangeSpotReady) return effectiveRbsTfEnabled;
    return { '5m': false, '15m': false, '1h': false, '4h': false, '24h': false };
  }, [hudGateSupportLinesByExchange, hudExchangeSpotReady, effectiveRbsTfEnabled]);

  /** Strike S/R horizontals: enabled only in HUD when the active exchange feed matches the Up/Down table (see `hudGateSupportLinesByExchange`), and only for RBS timeframes that are checked in settings. */
  const srLines = useMemo<SRLine[]>(() => {
    if (!hudGateSupportLinesByExchange || !hudExchangeSpotReady) return [];
    const assetMarkets = upOrDownMarkets[asset];
    if (!assetMarkets) return [];
    const now = Date.now();
    const lines: SRLine[] = [];
    for (const tf of SR_TIMEFRAMES) {
      if (!rbsTfEnabledForCompute[tf]) continue;
      const markets: Market[] = (assetMarkets[tf] || [])
        .filter((m: Market) => {
          if (m.closed || !m.endDate) return false;
          const tte = new Date(m.endDate).getTime() - now;
          return tte >= RBS_MIN_TTE_MS;
        })
        .sort((a: Market, b: Market) => {
          const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
          const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
          return ta - tb;
        });
      const market = markets[0];
      if (!market) continue;
      const tokenId = market.clobTokenIds?.[0] || '';
      const strike = market.priceToBeat ?? (tokenId ? marketLookup[tokenId]?.priceToBeat : undefined);
      if (strike == null || !Number.isFinite(strike) || strike <= 0) continue;
      const live = tokenId ? marketLookup[tokenId] : null;
      const bid = live?.bestBid ?? market.bestBid;
      const ask = live?.bestAsk ?? market.bestAsk;
      let probUp = 0.5;
      if (bid != null && ask != null && Number.isFinite(bid) && Number.isFinite(ask)) {
        probUp = (bid + ask) / 2;
      } else if (bid != null && Number.isFinite(bid)) {
        probUp = bid;
      } else if (ask != null && Number.isFinite(ask)) {
        probUp = ask;
      }
      lines.push({ price: strike, probUp, label: tf });
    }
    return lines;
  }, [hudGateSupportLinesByExchange, hudExchangeSpotReady, asset, upOrDownMarkets, marketLookup, rbsTfEnabledForCompute]);

  /** (max high − min low) / min low × 100 over candles in the visible window. */
  const candleRangePct = useMemo(() => {
    if (candles.length === 0) return null;
    let minL = Infinity;
    let maxH = -Infinity;
    for (const c of candles) {
      if (Number.isFinite(c.l) && c.l < minL) minL = c.l;
      if (Number.isFinite(c.h) && c.h > maxH) maxH = c.h;
    }
    if (!Number.isFinite(minL) || !Number.isFinite(maxH) || minL <= 0 || maxH < minL) return null;
    return ((maxH - minL) / minL) * 100;
  }, [candles]);

  const rbsStaleRef = useRef<number | null>(null);

  useEffect(() => {
    rbsStaleRef.current = null;
  }, [asset]);

  const rbsResult = useMemo<RBSComputeResult>(() => {
    if (spotForChart <= 0) return { kind: 'clear' };
    const sigma = (volatilityData[sym] || 0.6) * volMultiplier;
    const assetMarkets = upOrDownMarkets[asset] || {};
    return computeRBSPriceResult(
      spotForChart,
      sigma,
      assetMarkets,
      marketLookup,
      Date.now(),
      rbsTfEnabledForCompute,
    );
  }, [asset, spotForChart, volatilityData, volMultiplier, sym, upOrDownMarkets, marketLookup, rbsTfEnabledForCompute, rbsVolWeightAdjusted]);

  useEffect(() => {
    if (rbsResult.kind === 'price') {
      rbsStaleRef.current = rbsResult.value;
    } else if (rbsResult.kind === 'clear') {
      rbsStaleRef.current = null;
    }
  }, [rbsResult]);

  const rbsPrice: number | null =
    rbsResult.kind === 'price' ? rbsResult.value : rbsResult.kind === 'hold' ? rbsStaleRef.current : null;
  const rbsFollowsSpot = rbsResult.kind === 'price' ? rbsResult.followsSpot : false;
  const rbsTfLines = rbsResult.kind === 'price' ? rbsResult.tfLines : [];
  const selectedRbsTf = rbsResult.kind === 'price' ? rbsResult.usedTimeframes[0] ?? null : null;
  const rbsUsedTfSet = useMemo(() => {
    return new Set<UpDownTfKey>(rbsResult.kind === 'price' ? rbsResult.usedTimeframes : []);
  }, [rbsResult]);

  const rbsArrowSignal = useMemo<{ dir: 'up' | 'down'; count: 1 | 2 | 3 | 4 | 5 } | null>(() => {
    const rp = rbsPrice;
    const sp = spotForChart;
    const threshRel = rbsPulseThresholdPct / 100;
    if (rp == null || !Number.isFinite(rp) || sp <= 0 || !Number.isFinite(sp) || threshRel <= 0) return null;
    const dev = (rp - sp) / sp;
    const absDev = Math.abs(dev);
    if (absDev < threshRel) return null;
    const dir = dev > 0 ? 'up' as const : 'down' as const;
    const count: 1 | 2 | 3 | 4 | 5 =
      absDev >= threshRel * 10 ? 5
      : absDev >= threshRel * 7 ? 4
      : absDev >= threshRel * 4.5 ? 3
      : absDev >= threshRel * 2.5 ? 2
      : 1;
    return { dir, count };
  }, [rbsPrice, spotForChart, rbsPulseThresholdPct]);

  const arrowRefs = useRef<(HTMLDivElement | null)[]>([null, null, null, null, null]);
  const arrowAnimsRef = useRef<(Animation | null)[]>([null, null, null, null, null]);
  const prevArrowKeyRef = useRef('');

  useEffect(() => {
    const key = rbsArrowSignal ? `${rbsArrowSignal.dir}-${rbsArrowSignal.count}` : '';
    if (key === prevArrowKeyRef.current) return;
    prevArrowKeyRef.current = key;

    for (let i = 0; i < 5; i++) {
      arrowAnimsRef.current[i]?.cancel();
      arrowAnimsRef.current[i] = null;
      const el = arrowRefs.current[i];
      if (el) el.style.opacity = '0';
    }

    if (!rbsArrowSignal) return;
    const { count, dir } = rbsArrowSignal;
    const cycleDuration = 1200;
    const stagger = cycleDuration / count;

    for (let i = 0; i < count; i++) {
      const slotIdx = 5 - count + i;
      const el = arrowRefs.current[slotIdx];
      if (!el) continue;
      const delayIdx = dir === 'up' ? i : count - 1 - i;
      arrowAnimsRef.current[slotIdx] = el.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 0.85, offset: 0.4 },
          { opacity: 0.85, offset: 0.6 },
          { opacity: 0, offset: 1 },
        ],
        {
          duration: cycleDuration,
          delay: delayIdx * stagger,
          iterations: Infinity,
          easing: 'ease-in-out',
        },
      );
    }
  }, [rbsArrowSignal]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const chartHeaderRef = useRef<HTMLDivElement>(null);
  const chartTitleRef = useRef<HTMLHeadingElement>(null);
  const chartControlsRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const candleCountRef = useRef(candleCount);
  candleCountRef.current = candleCount;
  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;
  const priceSourceRef = useRef(priceSource);
  priceSourceRef.current = priceSource;
  const fetchVersionRef = useRef(0);

  useLayoutEffect(() => {
    const header = chartHeaderRef.current;
    const title = chartTitleRef.current;
    const controls = chartControlsRef.current;
    if (!header || !title || !controls) return;

    const gapPx = 8; // gap-x-2

    const measure = () => {
      requestAnimationFrame(() => {
        const h = chartHeaderRef.current;
        const t = chartTitleRef.current;
        const c = chartControlsRef.current;
        if (!h || !t || !c) return;
        const needSecondRow = t.scrollWidth + gapPx + c.scrollWidth > h.clientWidth + 0.5;
        setChartHeaderStackControls(needSecondRow);
      });
    };

    const ro = new ResizeObserver(measure);
    ro.observe(header);
    ro.observe(title);
    ro.observe(controls);
    measure();
    return () => ro.disconnect();
  }, [asset, spotForChart, priceSource, timeframe, candleCount]);

  useEffect(() => {
    if (!hudSyncBinanceIntervalFromMarket || forcedPriceSource !== 'binance' || !assetOverride) return;
    const mid = selectedMarket?.id;
    if (!mid) return;
    const tf = findUpDownTableTfForMarket(assetOverride, mid, upOrDownMarkets);
    if (!tf) return;
    const iv = upDownTableTfToKlineInterval(tf);
    if (!iv) return;
    setTimeframe((prev) => {
      if (prev === iv) return prev;
      localStorage.setItem(`polybot-binance-interval-${panelId}`, iv);
      return iv;
    });
  }, [hudSyncBinanceIntervalFromMarket, forcedPriceSource, assetOverride, selectedMarket?.id, upOrDownMarkets, panelId]);

  const fetchKlines = useCallback(async () => {
    const myVersion = ++fetchVersionRef.current;
    setLoading(true);
    setLoadErr(null);
    try {
      const now = Date.now();
      const windowStart = candleWindowStart(now, candleCount, timeframe, priceSource);
      const targetBars = Math.min(5000, candleCount + 12);
      const byTime = new Map<number, Candle>();
      let endTime: number | undefined;
      let iterations = 0;

      if (priceSource === 'chainlink') {
        const clSymbol = chainlinkKlineSymbol(asset);
        const apiIv = polycandlesChartInterval(timeframe);

        while (iterations++ < 20 && byTime.size < targetBars) {
          const params = new URLSearchParams({
            symbol: clSymbol,
            interval: apiIv,
            limit: '1000',
          });
          if (endTime !== undefined) params.set('endTime', String(endTime));
          const res = await fetch(`${API_BASE}/api/v3/klines?${params}`);
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          const rows = await res.json();
          if (!Array.isArray(rows) || rows.length === 0) break;
          let oldest = Infinity;
          for (const row of rows) {
            if (!Array.isArray(row) || row.length < 6) continue;
            const t = Number(row[0]);
            const o = parseFloat(String(row[1]));
            const h = parseFloat(String(row[2]));
            const l = parseFloat(String(row[3]));
            const c = parseFloat(String(row[4]));
            if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
            oldest = Math.min(oldest, t);
            byTime.set(t, { t, o, h, l, c });
          }
          if (oldest <= windowStart) break;
          endTime = oldest - 1;
        }
      } else {
        while (iterations++ < 20 && byTime.size < targetBars) {
          const params = new URLSearchParams({
            symbol: sym,
            interval: timeframe,
            limit: '1000',
          });
          if (endTime !== undefined) params.set('endTime', String(endTime));
          const res = await fetch(`https://api.binance.com/api/v3/klines?${params}`);
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          const rows = await res.json();
          if (!Array.isArray(rows) || rows.length === 0) break;
          let oldest = Infinity;
          for (const row of rows) {
            if (!Array.isArray(row) || row.length < 6) continue;
            const t = Number(row[0]);
            const o = parseFloat(String(row[1]));
            const h = parseFloat(String(row[2]));
            const l = parseFloat(String(row[3]));
            const c = parseFloat(String(row[4]));
            if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
            oldest = Math.min(oldest, t);
            byTime.set(t, { t, o, h, l, c });
          }
          if (oldest <= windowStart) break;
          endTime = oldest - 1;
        }
      }

      const filtered = [...byTime.values()]
        .filter((c) => c.t >= windowStart)
        .sort((a, b) => a.t - b.t);
      if (myVersion !== fetchVersionRef.current) return;
      setCandles(filtered);
    } catch (e) {
      if (myVersion !== fetchVersionRef.current) return;
      setCandles([]);
      setLoadErr(e instanceof Error ? e.message : 'Failed to load klines');
    } finally {
      if (myVersion !== fetchVersionRef.current) return;
      setLoading(false);
    }
  }, [sym, timeframe, candleCount, priceSource, asset]);

  useEffect(() => {
    void fetchKlines();
  }, [fetchKlines]);

  useEffect(() => {
    const t = setInterval(() => void fetchKlines(), 180_000);
    return () => clearInterval(t);
  }, [fetchKlines]);

  useEffect(() => {
    if (priceSource !== 'binance') return;

    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      const stream = `${sym.toLowerCase()}@kline_${timeframe}`;
      ws = new WebSocket(`${BINANCE_SPOT_WS_BASE}/${stream}`);

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            e?: string;
            k?: {
              t: number;
              o: string;
              h: string;
              l: string;
              c: string;
              s?: string;
              i?: string;
            };
          };
          if (msg.e !== 'kline' || !msg.k) return;
          const k = msg.k;
          if (k.s !== sym || k.i !== timeframe) return;
          const tOpen = Number(k.t);
          const o = parseFloat(k.o);
          const h = parseFloat(k.h);
          const l = parseFloat(k.l);
          const c = parseFloat(k.c);
          if (!Number.isFinite(tOpen) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return;
          if (disposed) return;
          const windowStart = candleWindowStart(
            Date.now(),
            candleCountRef.current,
            timeframeRef.current,
            'binance',
          );
          setCandles((prev) => mergeKlineIntoSeries(prev, tOpen, o, h, l, c, windowStart));
        } catch {
          /* ignore malformed */
        }
      };

      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [sym, timeframe, priceSource]);

  useEffect(() => {
    if (priceSource !== 'chainlink') return;

    const clSym = chainlinkKlineSymbol(asset);

    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingIv: ReturnType<typeof setInterval> | undefined;
    let attempt = 0;

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(`${WS_BASE}/ws/chart`);

      ws.onopen = () => {
        attempt = 0;
        const subIv = polycandlesChartInterval(timeframeRef.current);
        ws?.send(
          JSON.stringify({
            type: 'subscribeKlineStream',
            data: { symbol: clSym, interval: subIv },
          }),
        );
        // Backend just came back: clear stale fetch overlay and backfill history.
        setLoadErr(null);
        void fetchKlines();
        pingIv = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30_000);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            type?: string;
            data?: { data?: { k?: { t: number; o: string; h: string; l: string; c: string; s?: string; i?: string } } };
          };
          if (msg.type !== 'klineStreamUpdate') return;
          const k = msg.data?.data?.k;
          if (!k) return;
          if (k.s !== clSym || k.i !== polycandlesChartInterval(timeframeRef.current)) return;
          const tOpen = Number(k.t);
          const o = parseFloat(k.o);
          const h = parseFloat(k.h);
          const l = parseFloat(k.l);
          const c = parseFloat(k.c);
          if (!Number.isFinite(tOpen) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return;
          if (disposed || priceSourceRef.current !== 'chainlink') return;
          // Any valid live candle means the stream is healthy; remove stale overlay.
          setLoadErr(null);
          const windowStart = candleWindowStart(
            Date.now(),
            candleCountRef.current,
            timeframeRef.current,
            'chainlink',
          );
          setCandles((prev) => mergeKlineIntoSeries(prev, tOpen, o, h, l, c, windowStart));
        } catch {
          /* ignore malformed */
        }
      };

      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        clearInterval(pingIv);
        pingIv = undefined;
        if (disposed) return;
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearInterval(pingIv);
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      const subIv = polycandlesChartInterval(timeframe);
      try {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          ws.send(
            JSON.stringify({
              type: 'unsubscribeKlineStream',
              data: { symbol: clSym, interval: subIv },
            }),
          );
        }
      } catch {
        /* ignore */
      }
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [asset, timeframe, candleCount, priceSource]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (assetDropdownOpen) {
        const el = wrapRef.current?.querySelector('.binance-asset-dropdown-root');
        if (el && !el.contains(t)) setAssetDropdownOpen(false);
      }
      if (rbsSettingsOpen) {
        const btn = rbsSettingsButtonRef.current;
        const menu = rbsSettingsMenuRef.current;
        const clickedInside = (btn && btn.contains(t)) || (menu && menu.contains(t));
        if (!clickedInside) setRbsSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [assetDropdownOpen, rbsSettingsOpen]);

  useEffect(() => {
    if (!rbsSettingsOpen) {
      setRbsSettingsMenuPos(null);
      return;
    }

    const rafId = requestAnimationFrame(() => {
      const btn = rbsSettingsButtonRef.current;
      const menu = rbsSettingsMenuRef.current;
      if (!btn || !menu) return;

      const btnRect = btn.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const margin = 8;

      let left = btnRect.right - menuRect.width;
      left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));

      let top = btnRect.bottom + 6;
      if (top + menuRect.height > window.innerHeight - margin) {
        top = btnRect.top - menuRect.height - 6;
        if (top < margin) top = margin;
      }

      setRbsSettingsMenuPos({ left, top });
    });
    return () => cancelAnimationFrame(rafId);
  }, [rbsSettingsOpen]);

  useEffect(() => {
    const container = chartRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const paint = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      if (w < 4 || h < 4) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCandles(ctx, w, h, candles, timeframe, srLines, asset, rbsTfLines, selectedRbsTf);
    };

    paint();
    const ro = new ResizeObserver(() => paint());
    ro.observe(container);
    return () => ro.disconnect();
  }, [candles, timeframe, srLines, asset, rbsTfLines, selectedRbsTf, spotForChart]);

  const titleColor = ASSET_COLORS[asset] || 'text-white';

  return (
    <div ref={wrapRef} className={`panel-wrapper bg-gray-800/50 rounded-lg ${compact ? 'p-2' : 'p-3'} flex flex-col min-h-0 h-full`}>
      <div
        ref={chartHeaderRef}
        className="panel-header shrink-0 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 cursor-grab"
      >
        {assetOverride && compact ? (
          <div ref={chartTitleRef} className="hidden" />
        ) : (
          <h3
            ref={chartTitleRef}
            className={`text-sm font-bold flex items-center gap-1 flex-wrap min-w-0 ${chartHeaderStackControls ? 'w-full shrink-0 basis-full' : 'flex-1'} ${titleColor}`}
          >
            <span
              className={`relative binance-asset-dropdown-root no-drag inline-flex items-center select-none ${assetOverride ? 'cursor-default' : 'cursor-pointer'}`}
              onClick={() => { if (!assetOverride) setAssetDropdownOpen(v => !v); }}
            >
              {asset}:{' '}
              <span className="font-bold">
                {spotForChart > 0 ? formatPrice(spotForChart, asset) : '--'}
              </span>
              {!assetOverride && (
                <svg className="w-3 h-3 ml-0.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              )}
              {!assetOverride && assetDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[80px]">
                  {ALL_ASSETS.map(a => (
                    <div
                      key={a}
                      className={`px-3 py-1 text-xs font-bold hover:bg-gray-700 cursor-pointer ${a === asset ? 'text-white bg-gray-700' : 'text-gray-300'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setAsset(a);
                        localStorage.setItem(`polybot-binance-chart-asset-${panelId}`, a);
                        setAssetDropdownOpen(false);
                      }}
                    >
                      {a}
                    </div>
                  ))}
                </div>
              )}
            </span>
          </h3>
        )}
          <div
          ref={chartControlsRef}
          className={`flex items-center gap-1.5 no-drag cursor-default ${chartHeaderStackControls ? 'w-full shrink-0 basis-full justify-start flex-wrap' : 'shrink-0'}`}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {!forcedPriceSource && <div
            className="flex shrink-0 overflow-hidden rounded border border-gray-600"
            title="Candle source: Binance spot API or polycandles Chainlink klines"
          >
            <button
              type="button"
              aria-label="Binance spot candles"
              className={`flex items-center justify-center px-1.5 py-0.5 ${priceSource === 'binance' ? 'bg-cyan-900/75' : 'bg-gray-900 hover:opacity-90'}`}
              onClick={() => {
                setPriceSource('binance');
                localStorage.setItem(`polybot-binance-chart-source-${panelId}`, 'binance');
              }}
            >
              <svg
                className={`h-3 w-3 shrink-0 ${priceSource === 'binance' ? 'opacity-100' : 'opacity-40'}`}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path fill="#F0B90B" d={BINANCE_LOGO_PATH} />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Chainlink candles (polycandles klines)"
              className={`flex items-center justify-center border-l border-gray-600 px-1.5 py-0.5 ${priceSource === 'chainlink' ? 'bg-blue-900/75 text-blue-200' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}
              onClick={() => {
                setPriceSource('chainlink');
                localStorage.setItem(`polybot-binance-chart-source-${panelId}`, 'chainlink');
              }}
              title="Uses polycandles /api/v3/klines (synthetic chainlink_*usd). 4h and 1d resolutions use 1h bars."
            >
              <svg
                className={`h-3 w-3 shrink-0 ${priceSource === 'chainlink' ? 'opacity-100' : 'opacity-40'}`}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path fill="currentColor" d={CHAINLINK_LOGO_PATH} />
              </svg>
            </button>
          </div>}
          {forcedPriceSource && (
            <span
              className={`inline-flex items-center justify-center rounded border px-1.5 py-0.5 text-[9px] font-bold leading-none ${
                forcedPriceSource === 'chainlink'
                  ? 'border-blue-600/60 bg-blue-900/70 text-blue-200'
                  : 'border-yellow-500/60 bg-yellow-900/60 text-yellow-200'
              }`}
              title={forcedPriceSource === 'chainlink' ? 'Chainlink candles' : 'Binance candles'}
            >
              {forcedPriceSource === 'chainlink' ? 'CHAINLINK' : 'BINANCE'}
            </span>
          )}
          <select
            value={timeframe}
            onChange={(e) => {
              const iv = e.target.value as KlineInterval;
              setTimeframe(iv);
              localStorage.setItem(`polybot-binance-interval-${panelId}`, iv);
            }}
            className="no-drag w-max shrink-0 rounded border border-cyan-700/50 bg-gray-900/90 py-0.5 pl-1 pr-2 text-[10px] font-semibold text-cyan-100 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 [field-sizing:content]"
            aria-label="Chart resolution"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {INTERVALS.map((iv) => (
              <option key={iv} value={iv}>
                {iv}
              </option>
            ))}
          </select>
          <select
            value={String(candleCount)}
            onChange={(e) => {
              const v = Number(e.target.value) as CandleCount;
              if (v !== 10 && v !== 20 && v !== 50) return;
              setCandleCount(v);
              localStorage.setItem(`polybot-binance-candle-count-${panelId}`, String(v));
            }}
            className="no-drag w-max shrink-0 rounded border border-violet-700/50 bg-gray-900/90 py-0.5 pl-1 pr-2 text-[10px] font-semibold text-violet-100 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40 [field-sizing:content]"
            aria-label="Number of candles"
            title="Number of candles shown"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {CANDLE_COUNTS.map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
          </select>
          {!hideRbsSettings && <div className="relative binance-rbs-settings-root">
            <button
              ref={rbsSettingsButtonRef}
              type="button"
              aria-label="RBS market settings"
              aria-expanded={rbsSettingsOpen}
              className="rounded p-0.5 text-gray-400 hover:bg-gray-700/80 hover:text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              onClick={(e) => {
                e.stopPropagation();
                setRbsSettingsOpen((v) => !v);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Settings className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </button>
            {rbsSettingsOpen && portalRoot && createPortal(
              <div
                ref={rbsSettingsMenuRef}
                className="fixed z-[9999] min-w-[9.5rem] rounded border border-gray-600 bg-gray-800 py-1.5 px-2 shadow-lg"
                style={
                  rbsSettingsMenuPos
                    ? { left: rbsSettingsMenuPos.left, top: rbsSettingsMenuPos.top }
                    : { visibility: 'hidden' }
                }
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="mb-1 border-b border-gray-700 pb-1">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">RBS settings</div>
                  <div className="mt-0.5 text-[8px] font-normal normal-case tracking-normal text-gray-500 leading-tight">
                    {rbsVolWeightAdjusted
                      ? 'Blend weights: Polymarket vol × 1/√T'
                      : 'Blend weights: 1/√T (market vol ignored)'}
                  </div>
                </div>
                <div className="mt-1">
                  <label
                    className="flex cursor-pointer items-center gap-2 py-0.5 text-[10px] text-gray-200 hover:text-white"
                  >
                    <input
                      type="checkbox"
                      checked={rbsVolWeightAdjusted}
                      onChange={() => {
                        setRbsVolWeightAdjusted((prev) => {
                          const next = !prev;
                          localStorage.setItem(`polybot-binance-rbs-vol-weight-${panelId}`, next ? 'true' : 'false');
                          return next;
                        });
                      }}
                      className="accent-purple-500 rounded"
                    />
                    <span>Vol weight adjusted</span>
                  </label>
                </div>
                <div className="mt-1 border-t border-gray-700 pt-1">
                  <label
                    className="flex items-center justify-between gap-2 py-0.5 text-[10px] text-gray-200 hover:text-white"
                  >
                    <span>Chevron threshold</span>
                    <input
                      type="number"
                      step={0.01}
                      min={0}
                      max={5}
                      value={Number.isFinite(rbsPulseThresholdPct) ? rbsPulseThresholdPct : 0.05}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw.trim() === '') return;
                        const next = Number(raw);
                        if (!Number.isFinite(next)) return;
                        const clamped = Math.max(0, Math.min(5, next));
                        setRbsPulseThresholdPct(clamped);
                        localStorage.setItem(
                          `polybot-binance-rbs-pulse-threshold-${panelId}`,
                          String(clamped),
                        );
                      }}
                      className="w-[4.3rem] rounded border border-gray-700 bg-gray-900/70 px-1 py-0.5 text-right text-[10px] text-gray-100 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40 [field-sizing:content]"
                      aria-label="Pulse threshold percent"
                    />
                  </label>
                  <div className="mt-0.5 text-[8px] text-gray-500 leading-tight">
                    Start when |RBS - spot| / spot &gt;= threshold
                  </div>
                </div>
              </div>,
              portalRoot,
            )}
          </div>}
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-row gap-0">
        {candles.length > 0 && (
          <div
            className="relative z-10 flex w-7 shrink-0 flex-col items-stretch justify-stretch rounded-l-md border border-gray-700/80 border-r-0 bg-gray-950/90"
            title="High−low range over visible candles: (highest high − lowest low) ÷ lowest low × 100"
          >
            <span
              className="pointer-events-none absolute left-1/2 top-1/2 whitespace-nowrap text-[10px] font-semibold tabular-nums text-gray-400"
              style={{ transform: 'translate(-50%, -50%) rotate(-90deg)' }}
            >
              {candleRangePct != null ? `Range ${candleRangePct.toFixed(2)}%` : '—'}
            </span>
            {rbsArrowSignal && (
              <div
                className="pointer-events-none absolute inset-x-0 flex flex-col items-center"
                style={{ top: 4, flexDirection: 'column-reverse' }}
              >
                {[0, 1, 2, 3, 4].map((i) => {
                  const visible = i >= 5 - rbsArrowSignal.count;
                  const color = rbsArrowSignal.dir === 'up' ? '#10b981' : '#ef4444';
                  return (
                    <div
                      key={i}
                      ref={(el) => { arrowRefs.current[i] = el; }}
                      style={{
                        opacity: 0,
                        display: visible ? 'block' : 'none',
                        filter: `drop-shadow(0 0 3px ${color})`,
                        marginBottom: i > 0 ? -4 : 0,
                      }}
                    >
                      <svg
                        width="20"
                        height="14"
                        viewBox="0 0 24 16"
                        fill="none"
                        stroke={color}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        {rbsArrowSignal.dir === 'up'
                          ? <polyline points="4,13 12,4 20,13" />
                          : <polyline points="4,3 12,12 20,3" />
                        }
                      </svg>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div
          ref={chartRef}
          className={`relative min-h-0 min-w-0 flex-1 overflow-hidden border border-gray-700/80 bg-gray-950/60 ${
            candles.length > 0 ? 'rounded-l-none border-l-0' : 'rounded-md'
          } ${candles.length > 0 ? 'rounded-r-md' : ''}`}
        >
          {loadErr && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/80 px-2 text-center text-[11px] text-red-300">
              {loadErr}
            </div>
          )}
          {loading && candles.length === 0 && !loadErr && (
            <div className="absolute inset-0 z-10 flex items-center justify-center text-[11px] text-gray-500">Loading…</div>
          )}
          <canvas
            ref={canvasRef}
            className="block h-full w-full"
            role="img"
            aria-label={`${asset} candlestick chart (${priceSource === 'chainlink' ? 'Chainlink via polycandles' : 'Binance spot'})`}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-0.5 text-[10px]">
        {visibleRbsTimeframes.map((tf) => {
          const tfHex = RBS_TF_COLOR[tf];
          const usedInRbs = rbsUsedTfSet.has(tf);
          return (
          <label
            key={tf}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 transition"
            style={{
              position: 'relative',
              zIndex: RBS_CANVAS_LAYER[tf],
              ...(usedInRbs
                ? {
                    backgroundColor: `color-mix(in srgb, ${tfHex} 28%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tfHex} 62%, transparent)`,
                  }
                : {}),
            }}
            title={usedInRbs ? 'Used in current RBS calculation' : undefined}
          >
            <input
              type="checkbox"
              checked={rbsTfEnabled[tf]}
              onChange={() => {
                setRbsTfEnabled((prev) => {
                  const next = { ...prev, [tf]: !prev[tf] };
                  localStorage.setItem(`polybot-binance-rbs-tf-${panelId}`, JSON.stringify(next));
                  return next;
                });
              }}
              className="rounded"
              style={{ accentColor: tfHex }}
            />
            <span style={{ color: tfHex }}>{tf}</span>
          </label>
          );
        })}
      </div>
    </div>
  );
}
