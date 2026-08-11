import {
  chartEnrichmentMathCents,
  computeSpotTargetPriceDiff,
  formatChartEnrichmentUsd,
  type CandleBsEnrichment,
} from '../lib/chartCandleEnrichment';

export type ChartObHoverEnrichmentStripProps = {
  enrichment?: CandleBsEnrichment;
  priceDec?: number;
  chartOutcome?: 'YES' | 'NO';
};

export function ChartObHoverEnrichmentStrip({
  enrichment,
  priceDec = 2,
  chartOutcome = 'YES',
}: ChartObHoverEnrichmentStripProps) {
  if (!enrichment) return null;
  const { targetPrice, currentPrice, volatility, bsProb, twap30, twap60 } = enrichment;
  const mathCents = chartEnrichmentMathCents(bsProb, chartOutcome);
  const diff = computeSpotTargetPriceDiff(currentPrice, targetPrice);
  const hasBs =
    (targetPrice != null && targetPrice > 0) ||
    (currentPrice != null && currentPrice > 0) ||
    (volatility != null && volatility > 0) ||
    mathCents != null;
  const hasTwap =
    (twap30 != null && twap30 > 0) ||
    (twap60 != null && twap60 > 0);
  if (!hasBs && !hasTwap) return null;

  return (
    <div className="mb-2 border-b border-gray-700/80 pb-2 px-0.5">
      {hasBs ? (
        <>
          <div className="grid grid-cols-4 gap-x-1 mb-1 text-[9px] font-medium text-gray-500">
            <span>Target</span>
            <span className="text-center">Math</span>
            <span className="text-center">σ</span>
            <span className="text-right">Oracle</span>
          </div>
          <div className="grid grid-cols-4 gap-x-1 text-[10px] font-bold tabular-nums text-white">
            <span className="truncate" title={formatChartEnrichmentUsd(targetPrice, priceDec)}>
              {formatChartEnrichmentUsd(targetPrice, priceDec)}
            </span>
            <span className="text-center text-cyan-300" title="B-S fair value at candle">
              {mathCents != null ? `${mathCents.toFixed(1)}¢` : '—'}
            </span>
            <span className="text-center text-gray-300" title="Annualized volatility">
              {volatility != null && volatility > 0 ? `${(volatility * 100).toFixed(1)}%` : '—'}
            </span>
            <span className="text-right truncate" title={formatChartEnrichmentUsd(currentPrice, priceDec)}>
              {formatChartEnrichmentUsd(currentPrice, priceDec)}
            </span>
          </div>
          {diff ? (
            <div className="mt-1.5 flex justify-end text-[10px] font-bold tabular-nums leading-none">
              <span
                className={`inline-flex min-h-[15px] items-center whitespace-nowrap gap-0.5 ${diff.isUp ? 'text-green-400' : 'text-red-400'}`}
              >
                <span>
                  {diff.isUp ? '↑' : '↓'}
                  {diff.abs.toLocaleString(undefined, {
                    minimumFractionDigits: priceDec,
                    maximumFractionDigits: priceDec,
                  })}
                </span>
                <span>
                  ({diff.pct >= 0 ? '+' : ''}
                  {diff.pct.toFixed(2)}%)
                </span>
              </span>
            </div>
          ) : null}
        </>
      ) : null}
      {hasTwap ? (
        <div className={hasBs ? 'mt-1.5 pt-1.5 border-t border-gray-700/60' : ''}>
          <div className="grid grid-cols-2 gap-x-1 mb-1 text-[9px] font-medium text-gray-500">
            <span title="Chainlink TWAP 30s (5m markets)">TWAP 30</span>
            <span className="text-right" title="Chainlink TWAP 60s (15m markets)">
              TWAP 60
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-1 text-[10px] font-bold tabular-nums text-amber-300/95">
            <span className="truncate" title={formatChartEnrichmentUsd(twap30, priceDec)}>
              {formatChartEnrichmentUsd(twap30, priceDec)}
            </span>
            <span className="text-right truncate" title={formatChartEnrichmentUsd(twap60, priceDec)}>
              {formatChartEnrichmentUsd(twap60, priceDec)}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
