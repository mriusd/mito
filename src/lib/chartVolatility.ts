/**
 * Sidebar chart σ from completed candle closes (same math as ChainlinkChart / useSidebarChartVolatility).
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

/** Annualized σ% from close-to-close log returns (sample stdev). `closes` = chronological completed bars only. Needs ≥3 closes. */
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
