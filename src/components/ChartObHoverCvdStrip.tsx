import { memo, useMemo } from 'react';
import type { CvdBar } from '../lib/binanceCvdFeed';
import { fmtCvdUsd } from '../lib/binanceCvdFeed';
import type { CvdCandleSnapshot } from '../lib/cvdCandleSnapshot';
import { CvdBarChart } from './CvdBarChart';

export type ChartObHoverCvdStripProps = {
  /** Bars ending at (or through) the hovered candle — same resolution as the chart. */
  bars: readonly CvdBar[];
  /** Hovered candle open time (ms). */
  highlightT: number;
  intervalLabel: string;
  /** Snapshot on the hovered candle (buy/sell/Δ readout). */
  hovered?: CvdCandleSnapshot | null;
};

/**
 * Build CvdBar[] from candle.cvd for hover / charts (skip candles with no cvd).
 * Values are always YES-space from polycandles (NO buys→YES sells, USD @ raw p; summed on YES).
 */
export function cvdBarsFromCandles(
  candles: ReadonlyArray<{ time: number; cvd?: CvdCandleSnapshot }>,
  throughIdx: number,
): CvdBar[] {
  const out: CvdBar[] = [];
  const hi = Math.min(throughIdx, candles.length - 1);
  for (let i = 0; i <= hi; i++) {
    const c = candles[i];
    const snap = c?.cvd;
    if (!snap) continue;
    const buyUsd = Number.isFinite(snap.buyUsd) ? snap.buyUsd : 0;
    const sellUsd = Number.isFinite(snap.sellUsd) ? snap.sellUsd : 0;
    const deltaUsd = Number.isFinite(snap.deltaUsd) ? snap.deltaUsd : buyUsd - sellUsd;
    out.push({
      t: c!.time,
      buyUsd,
      sellUsd,
      deltaUsd,
      cumDeltaUsd: Number.isFinite(snap.cumDeltaUsd) ? snap.cumDeltaUsd : deltaUsd,
      tradeCount: Number.isFinite(snap.tradeCount) ? snap.tradeCount : 0,
    });
  }
  return out;
}

/**
 * Candle-hover CVD strip — Polymarket per-bar Δ (same as mitobot continuous TUI CVD).
 */
export const ChartObHoverCvdStrip = memo(function ChartObHoverCvdStrip({
  bars,
  highlightT,
  intervalLabel,
  hovered,
}: ChartObHoverCvdStripProps) {
  const hoveredBar = useMemo(
    () => bars.find((b) => b.t === highlightT) ?? null,
    [bars, highlightT],
  );
  const delta = hovered?.deltaUsd ?? hoveredBar?.deltaUsd;
  const cum = hovered?.cumDeltaUsd ?? hoveredBar?.cumDeltaUsd;
  const buy = hovered?.buyUsd ?? hoveredBar?.buyUsd;
  const sell = hovered?.sellUsd ?? hoveredBar?.sellUsd;

  if (bars.length === 0 && delta == null) return null;

  const signedCls = (v: number | null | undefined, pos = 'text-green-400', neg = 'text-red-400') =>
    v == null
      ? 'text-gray-500'
      : v > 1e-9
        ? pos
        : v < -1e-9
          ? neg
          : 'text-cyan-400';

  const barCount = Math.max(bars.length, 1);

  return (
    <div className="mb-2 border-b border-gray-700/80 pb-2">
      <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
        <span
          className="text-[9px] font-bold uppercase tracking-wide text-sky-400/90"
          title="Always YES-space: YES + NO remapped (BUY NO→YES sell); USD uses trade price p not 1−p"
        >
          CVD · YES
        </span>
        <span className="flex items-center gap-2 text-[10px] font-bold tabular-nums">
          <span className={signedCls(delta)} title="buyUsd − sellUsd this bar">
            Δ {delta != null ? fmtCvdUsd(delta) : '—'}
          </span>
          <span className={signedCls(cum, 'text-sky-400', 'text-fuchsia-400')} title="Running cumDeltaUsd">
            Σ {cum != null ? fmtCvdUsd(cum) : '—'}
          </span>
        </span>
      </div>
      {buy != null && sell != null ? (
        <div className="mb-1 flex justify-between gap-2 px-0.5 text-[8px] tabular-nums text-gray-500">
          <span>
            Buy <span className="text-green-400/90">{fmtCvdUsd(buy)}</span>
          </span>
          <span>
            Sell <span className="text-red-400/90">{fmtCvdUsd(sell)}</span>
          </span>
        </div>
      ) : null}
      <CvdBarChart
        bars={bars}
        barCount={barCount}
        intervalLabel={intervalLabel}
        highlightT={highlightT}
        mode="delta"
        compact
        emptyLabel="No CVD on these candles"
      />
      <div className="mt-1.5 border-t border-gray-800/80 pt-1.5">
        <div className="mb-0.5 px-0.5 text-[8px] font-semibold uppercase tracking-wide text-gray-500">
          Cumulative
        </div>
        <CvdBarChart
          bars={bars}
          barCount={barCount}
          intervalLabel={intervalLabel}
          highlightT={highlightT}
          mode="cum"
          compact
          emptyLabel="No cumulative CVD"
        />
      </div>
    </div>
  );
});
