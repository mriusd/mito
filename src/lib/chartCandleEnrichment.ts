/** Chart math-probability line + sidebar target-section math value. */
export const CHART_MATH_PROB_COLOR = '#eab308';

export type CandleBsEnrichment = {
  targetPrice?: number;
  currentPrice?: number;
  volatility?: number;
  bsProb?: number;
  /** Chainlink RTDS TWAP-30 (≈5m window) at candle update. */
  twap30?: number;
  /** Chainlink RTDS TWAP-60 (≈15m window) at candle update. */
  twap60?: number;
};

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
  twap_30?: unknown;
  twap_60?: unknown;
}): CandleBsEnrichment | undefined {
  const targetPrice = parseEnrichmentNum(raw.target_price);
  const currentPrice = parseEnrichmentNum(raw.current_price);
  const volatility = parseEnrichmentNum(raw.volatility);
  const bsProb = parseEnrichmentNum(raw.bs_prob);
  const twap30 = parseEnrichmentNum(raw.twap_30);
  const twap60 = parseEnrichmentNum(raw.twap_60);
  if (
    targetPrice == null &&
    currentPrice == null &&
    volatility == null &&
    bsProb == null &&
    twap30 == null &&
    twap60 == null
  ) {
    return undefined;
  }
  return { targetPrice, currentPrice, volatility, bsProb, twap30, twap60 };
}

export function parseHttpKlineEnrichment(k: unknown[]): CandleBsEnrichment | undefined {
  return parseCandleBsEnrichment({
    target_price: k[13],
    current_price: k[14],
    volatility: k[15],
    bs_prob: k[16],
    twap_30: k[25],
    twap_60: k[26],
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
    twap30: next?.twap30 ?? prev?.twap30,
    twap60: next?.twap60 ?? prev?.twap60,
  };
}

export function formatChartEnrichmentUsd(n: number | undefined, priceDec: number): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec })}`;
}

export function computeSpotTargetPriceDiff(
  currentPrice: number | undefined | null,
  targetPrice: number | undefined | null,
): { abs: number; pct: number; isUp: boolean } | null {
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
  if (bsProb == null || !Number.isFinite(bsProb) || bsProb <= 0) return null;
  const yesCents = bsProb * 100;
  return chartOutcome === 'YES' ? yesCents : 100 - yesCents;
}
