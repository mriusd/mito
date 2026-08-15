import {
  chartEnrichmentMathCents,
  CHART_MATH_PROB_COLOR,
  CHART_PRED_MATH_PROB_COLOR,
  computeSpotTargetPriceDiff,
  formatChartEnrichmentUsd,
  type CandleBsEnrichment,
  type PriceDelta,
} from '../lib/chartCandleEnrichment';

export type ChartObHoverEnrichmentStripProps = {
  enrichment?: CandleBsEnrichment;
  priceDec?: number;
  chartOutcome?: 'YES' | 'NO';
};

function DeltaLine({ d, priceDec, title }: { d: PriceDelta | null; priceDec: number; title?: string }) {
  if (!d) {
    return (
      <span className="inline-flex min-h-[14px] items-center text-transparent select-none" aria-hidden>
        ↑0.00 (0.00%)
      </span>
    );
  }
  return (
    <span
      className={`inline-flex min-h-[14px] items-center whitespace-nowrap gap-0.5 ${d.isUp ? 'text-green-400' : 'text-red-400'}`}
      title={title}
    >
      <span>
        {d.isUp ? '↑' : '↓'}
        {d.abs.toLocaleString(undefined, {
          minimumFractionDigits: priceDec,
          maximumFractionDigits: priceDec,
        })}
      </span>
      <span>
        ({d.pct >= 0 ? '+' : ''}
        {d.pct.toFixed(3)}%)
      </span>
    </span>
  );
}

/**
 * Candle hover enrichment — same arrangement as sidebar spot strip for up/down:
 *   Row 1: Target | Math(TWAP) | TWAP   + TWAP−Target delta
 *   Row 2: Spot   | Math(pred) | Pred   + Spot−Target / Pred−Target deltas
 *   σ on a compact footer line.
 */
export function ChartObHoverEnrichmentStrip({
  enrichment,
  priceDec = 2,
  chartOutcome = 'YES',
}: ChartObHoverEnrichmentStripProps) {
  if (!enrichment) return null;

  const {
    targetPrice,
    currentPrice,
    volatility,
    bsProb,
    twapBsProb,
    spotPrice,
    twap60,
    predictedTwap,
  } = enrichment;

  // Historical σ from candle.volatility (fraction), stored by polycandles as
  // sidebar-style realized vol — not live GARCH / not live sidebar snapshot.
  const volPct =
    volatility != null && Number.isFinite(volatility) && volatility > 0
      ? volatility * 100
      : null;

  const pred = predictedTwap != null && predictedTwap > 0 ? predictedTwap : currentPrice;
  const twap = twap60 != null && twap60 > 0 ? twap60 : undefined;
  const spot = spotPrice != null && spotPrice > 0 ? spotPrice : undefined;

  const twapMathCents = chartEnrichmentMathCents(twapBsProb, chartOutcome);
  const predMathCents = chartEnrichmentMathCents(bsProb, chartOutcome);

  const twapVsTarget = computeSpotTargetPriceDiff(twap, targetPrice);
  const spotVsTarget = computeSpotTargetPriceDiff(spot, targetPrice);
  const predVsTarget = computeSpotTargetPriceDiff(pred, targetPrice);

  const hasSidebarLayout =
    (targetPrice != null && targetPrice > 0) ||
    (twap != null && twap > 0) ||
    (pred != null && pred > 0) ||
    (spot != null && spot > 0) ||
    twapMathCents != null ||
    predMathCents != null;

  if (!hasSidebarLayout) return null;

  const threeCol = {
    gridTemplateColumns: 'minmax(0, 1fr) minmax(2.75rem, auto) minmax(0, 1fr)',
  } as const;

  return (
    <div className="mb-2 border-b border-gray-700/80 pb-2 px-0.5">
      {/* Row 1: Target | Math(TWAP) | TWAP — matches sidebar */}
      <div className="grid gap-x-1.5 gap-y-0.5 w-full" style={threeCol}>
        <div className="text-[9px] font-medium leading-none text-gray-500 min-h-[14px] flex items-center">
          Target
        </div>
        <div
          className="text-[9px] font-medium leading-none text-gray-500 min-h-[14px] flex items-center justify-center"
          title="B-S fair value using live settlement TWAP as S₀"
        >
          Math
        </div>
        <div
          className="text-[9px] font-medium leading-none text-gray-500 min-h-[14px] flex items-center justify-end"
          title="Settlement TWAP-60 (CL60)"
        >
          TWAP
        </div>

        <div className="min-h-[15px] flex items-center min-w-0">
          <span className="text-[10px] font-bold tabular-nums text-white truncate">
            {formatChartEnrichmentUsd(targetPrice, priceDec)}
          </span>
        </div>
        <div className="min-h-[15px] flex items-center justify-center min-w-0">
          <span
            className="text-[10px] font-bold tabular-nums"
            style={{ color: CHART_MATH_PROB_COLOR }}
            title="Yellow dashed chart line — BS from live TWAP"
          >
            {twapMathCents != null ? `${twapMathCents.toFixed(1)}¢` : '—'}
          </span>
        </div>
        <div className="min-h-[15px] flex items-center justify-end min-w-0">
          <span className="text-[10px] font-bold tabular-nums text-white truncate">
            {formatChartEnrichmentUsd(twap, priceDec)}
          </span>
        </div>

        <div className="min-h-[14px]" />
        <div className="min-h-[14px]" />
        <div className="min-h-[14px] flex items-center justify-end text-[10px] font-bold tabular-nums leading-none">
          <DeltaLine d={twapVsTarget} priceDec={priceDec} title="TWAP − Target" />
        </div>
      </div>

      {/* Row 2: Spot | Math(pred) | Pred TWAP */}
      <div
        className="grid gap-x-1.5 gap-y-0.5 w-full mt-1.5 pt-1.5 border-t border-gray-700/60"
        style={threeCol}
      >
        <div
          className="text-[9px] font-medium leading-none text-gray-500 min-h-[14px] flex items-center"
          title="Chainlink spot (crypto_prices_chainlink)"
        >
          Spot
        </div>
        <div
          className="text-[9px] font-medium leading-none min-h-[14px] flex items-center justify-center"
          style={{ color: CHART_PRED_MATH_PROB_COLOR }}
          title="B-S fair value using predicted settlement TWAP as S₀ (pink dashed chart line)"
        >
          Math
        </div>
        <div
          className="text-[9px] font-medium leading-none text-gray-500 min-h-[14px] flex items-center justify-end"
          title="Predicted settlement TWAP at expiry (flat-spot blend)"
        >
          Pred TWAP
        </div>

        <div className="min-h-[15px] flex items-center min-w-0">
          <span className="text-[10px] font-bold tabular-nums text-amber-300/95 truncate">
            {formatChartEnrichmentUsd(spot, priceDec)}
          </span>
        </div>
        <div className="min-h-[15px] flex items-center justify-center min-w-0">
          <span
            className="text-[10px] font-bold tabular-nums"
            style={{ color: CHART_PRED_MATH_PROB_COLOR }}
            title="Pink dashed chart line — BS from predicted TWAP"
          >
            {predMathCents != null ? `${predMathCents.toFixed(1)}¢` : '—'}
          </span>
        </div>
        <div className="min-h-[15px] flex items-center justify-end min-w-0">
          <span className="text-[10px] font-bold tabular-nums text-amber-300/95 truncate">
            {formatChartEnrichmentUsd(pred, priceDec)}
          </span>
        </div>

        <div className="min-h-[14px] flex items-center text-[10px] font-bold tabular-nums leading-none">
          <DeltaLine d={spotVsTarget} priceDec={priceDec} title="Spot − Target" />
        </div>
        <div className="min-h-[14px] flex items-center justify-center text-[9px] text-gray-500 tabular-nums">
          {volPct != null ? (
            <span
              title="Historical realized σ at this candle (same formula as sidebar chart vol)"
              className="tabular-nums"
            >
              σ {volPct.toFixed(1)}%
            </span>
          ) : (
            <span className="text-transparent select-none" aria-hidden>
              σ
            </span>
          )}
        </div>
        <div className="min-h-[14px] flex items-center justify-end text-[10px] font-bold tabular-nums leading-none">
          <DeltaLine d={predVsTarget} priceDec={priceDec} title="Predicted TWAP − Target" />
        </div>
      </div>
    </div>
  );
}
