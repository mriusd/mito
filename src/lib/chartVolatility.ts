/**
 * Sidebar / candle display σ — same math as mitobot binance_vol.go:
 * max(Parkinson high–low, close-to-close sample stdev) × √(bars/year) × 100.
 * Include the current open kline when present (mitobot barsForCalc).
 */

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export const SIDEBAR_CHART_INTERVAL_MS: Record<string, number> = {
  '1m': 60000,
  '5m': 300000,
  '15m': 900000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': 86400000,
};

/** Up/Down slug/question → kline interval for sidebar Chainlink chart (must stay in sync with ChainlinkChart). */
export function sidebarChartIntervalFromContext(context?: string): string {
  if (!context) return '1h';
  const s = context.toLowerCase();
  if (s.match(/updown-5m/) || s.match(/\b5[- ]?min\b/)) return '5m';
  if (s.match(/updown-15m/) || s.match(/\b15[- ]?min\b/)) return '15m';
  if (s.match(/updown-4h/) || s.match(/\b4[- ]?h\b/)) return '15m';
  if (s.match(/up-or-down-on-/) || s.match(/\b24[- ]?h\b/)) return '15m';
  if (s.match(/updown-1h/) || s.match(/(?:^|[^0-9])1[- ]?h\b/) || s.match(/\b1[- ]?hour\b/)) return '5m';
  return '1h';
}

/** One OHLC bar for vol (mitobot binanceOHLC). */
export type VolOhlcBar = {
  h: number;
  l: number;
  c: number;
};

/**
 * Select last `lookback` completed bars + current open bar (if any).
 * Matches mitobot: completed capped to N, then open appended → up to N+1 bars.
 */
export function volBarsForCalc(
  candles: Array<{ time: number; h: number; l: number; c: number }>,
  candleMs: number,
  lookback: number,
  nowMs: number = Date.now(),
): VolOhlcBar[] {
  if (!Number.isFinite(candleMs) || candleMs <= 0) return [];
  const lb = Math.max(3, Math.min(500, Math.round(lookback)));
  const bucketNow = Math.floor(nowMs / candleMs) * candleMs;
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const completed = sorted.filter((c) => c.time < bucketNow).slice(-lb);
  const open = sorted.find((c) => c.time === bucketNow);
  const out: VolOhlcBar[] = completed.map((c) => ({ h: c.h, l: c.l, c: c.c }));
  if (open) out.push({ h: open.h, l: open.l, c: open.c });
  return out;
}

/** Annualized σ% from close-to-close log returns (sample stdev). Needs ≥3 closes. */
export function annualizedVolPctFromClosePrices(closes: number[], barMs: number): number | null {
  if (!Number.isFinite(barMs) || barMs <= 0) return null;
  const ok = closes.filter((x) => Number.isFinite(x) && x > 0);
  if (ok.length < 3) return null;
  const logRet: number[] = [];
  for (let i = 1; i < ok.length; i++) {
    logRet.push(Math.log(ok[i] / ok[i - 1]));
  }
  if (logRet.length < 2) return null;
  const n = logRet.length;
  const mean = logRet.reduce((a, b) => a + b, 0) / n;
  const varSample = logRet.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  if (!Number.isFinite(varSample) || varSample < 0) return null;
  const sdPerBar = Math.sqrt(varSample);
  const barsPerYear = MS_PER_YEAR / barMs;
  const ann = sdPerBar * Math.sqrt(barsPerYear);
  return Number.isFinite(ann) ? ann * 100 : null;
}

/**
 * Parkinson (1980) high–low estimator, annualized %.
 * σ²_bar = (1/(4 n ln 2)) Σ [ln(H_i/L_i)]² ; flat H==L contributes n++ with 0 range.
 */
export function annualizedVolPctParkinson(bars: VolOhlcBar[], barMs: number): number | null {
  if (!Number.isFinite(barMs) || barMs <= 0) return null;
  let sumSq = 0;
  let n = 0;
  for (const b of bars) {
    if (!(b.h > 0 && b.l > 0 && Number.isFinite(b.h) && Number.isFinite(b.l)) || b.h < b.l) {
      continue;
    }
    if (b.h === b.l) {
      n++;
      continue;
    }
    const lr = Math.log(b.h / b.l);
    if (!Number.isFinite(lr)) continue;
    sumSq += lr * lr;
    n++;
  }
  if (n < 3) return null;
  const varBar = sumSq / (4 * Math.LN2 * n);
  if (!Number.isFinite(varBar) || varBar < 0) return null;
  const sdPerBar = Math.sqrt(varBar);
  const barsPerYear = MS_PER_YEAR / barMs;
  const ann = sdPerBar * Math.sqrt(barsPerYear);
  return Number.isFinite(ann) ? ann * 100 : null;
}

/**
 * Short-term chart σ% — max(Parkinson, close-to-close). Mitobot annualizedVolPctFromOHLC.
 * Needs ≥3 bars.
 */
export function annualizedVolPctFromOHLC(bars: VolOhlcBar[], barMs: number): number | null {
  if (!Number.isFinite(barMs) || barMs <= 0 || bars.length < 3) return null;
  const closes = bars.map((b) => b.c).filter((c) => Number.isFinite(c) && c > 0);
  const cc = annualizedVolPctFromClosePrices(closes, barMs);
  const park = annualizedVolPctParkinson(bars, barMs);
  if (cc != null && park != null) return park > cc ? park : cc;
  if (park != null) return park;
  if (cc != null) return cc;
  return null;
}
