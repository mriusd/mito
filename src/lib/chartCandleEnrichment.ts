/** Chart math-probability line + sidebar target-section math value. */
export const CHART_MATH_PROB_COLOR = '#eab308';

export type CandleBsEnrichment = {
  targetPrice?: number;
  /** @deprecated Prefer predictedTwap; kept for older payloads (predicted S₀). */
  currentPrice?: number;
  volatility?: number;
  /** YES BS with predicted TWAP as S₀ (sidebar bottom Math). */
  bsProb?: number;
  /** YES BS with live settlement TWAP as S₀ (sidebar top Math). */
  twapBsProb?: number;
  /** Chainlink true spot (crypto_prices_chainlink) at candle update. */
  spotPrice?: number;
  /** Chainlink RTDS TWAP-30 at candle update. */
  twap30?: number;
  /** Settlement TWAP-60 (sidebar TWAP / CL60). */
  twap60?: number;
  /** Predicted settlement TWAP at candle time (sidebar Pred TWAP). */
  predictedTwap?: number;
};

export type PriceDelta = { abs: number; pct: number; isUp: boolean };

function parseEnrichmentNum(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export function parseCandleBsEnrichment(raw: {
  target_price?: unknown;
  current_price?: unknown;
  volatility?: unknown;
  bs_prob?: unknown;
  twap_bs_prob?: unknown;
  spot_price?: unknown;
  spot?: unknown;
  twap_30?: unknown;
  twap_60?: unknown;
  predicted_twap?: unknown;
}): CandleBsEnrichment | undefined {
  const targetPrice = parseEnrichmentNum(raw.target_price);
  const currentPrice = parseEnrichmentNum(raw.current_price);
  const volatility = parseEnrichmentNum(raw.volatility);
  const bsProb = parseEnrichmentNum(raw.bs_prob);
  const twapBsProb = parseEnrichmentNum(raw.twap_bs_prob);
  const spotPrice = parseEnrichmentNum(raw.spot_price) ?? parseEnrichmentNum(raw.spot);
  const twap30 = parseEnrichmentNum(raw.twap_30);
  const twap60 = parseEnrichmentNum(raw.twap_60);
  const predictedTwap =
    parseEnrichmentNum(raw.predicted_twap) ?? currentPrice;
  if (
    targetPrice == null &&
    currentPrice == null &&
    volatility == null &&
    bsProb == null &&
    twapBsProb == null &&
    spotPrice == null &&
    twap30 == null &&
    twap60 == null &&
    predictedTwap == null
  ) {
    return undefined;
  }
  return {
    targetPrice,
    currentPrice,
    volatility,
    bsProb,
    twapBsProb,
    spotPrice,
    twap30,
    twap60,
    predictedTwap,
  };
}

export function parseHttpKlineEnrichment(k: unknown[]): CandleBsEnrichment | undefined {
  return parseCandleBsEnrichment({
    target_price: k[13],
    current_price: k[14],
    volatility: k[15],
    bs_prob: k[16],
    twap_30: k[25],
    twap_60: k[26],
    spot_price: k[27],
    twap_bs_prob: k[28],
    predicted_twap: k[29] ?? k[14],
  });
}

export function mergeCandleBsEnrichment(
  next: CandleBsEnrichment | undefined,
  prev: CandleBsEnrichment | undefined,
): CandleBsEnrichment | undefined {
  if (!next && !prev) return undefined;
  return {
    targetPrice: next?.targetPrice ?? prev?.targetPrice,
    currentPrice: next?.currentPrice ?? prev?.currentPrice,
    volatility: next?.volatility ?? prev?.volatility,
    bsProb: next?.bsProb ?? prev?.bsProb,
    twapBsProb: next?.twapBsProb ?? prev?.twapBsProb,
    spotPrice: next?.spotPrice ?? prev?.spotPrice,
    twap30: next?.twap30 ?? prev?.twap30,
    twap60: next?.twap60 ?? prev?.twap60,
    predictedTwap: next?.predictedTwap ?? prev?.predictedTwap,
  };
}

export function formatChartEnrichmentUsd(n: number | undefined, priceDec: number): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec })}`;
}

export function computeSpotTargetPriceDiff(
  currentPrice: number | undefined | null,
  targetPrice: number | undefined | null,
): PriceDelta | null {
  if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  if (targetPrice == null || !Number.isFinite(targetPrice) || targetPrice <= 0) return null;
  const signedDelta = currentPrice - targetPrice;
  return {
    abs: Math.abs(signedDelta),
    pct: (signedDelta / targetPrice) * 100,
    isUp: signedDelta >= 0,
  };
}

export function chartEnrichmentMathCents(
  bsProb: number | undefined,
  chartOutcome: 'YES' | 'NO',
): number | null {
  // Allow 0 (resolved / deep OTM); only reject missing / non-finite.
  if (bsProb == null || !Number.isFinite(bsProb) || bsProb < 0) return null;
  const yesCents = Math.max(0, Math.min(99.9, bsProb * 100));
  return chartOutcome === 'YES' ? yesCents : 100 - yesCents;
}
