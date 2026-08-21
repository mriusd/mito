import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CvdBar } from '../lib/binanceCvdFeed';
import { fmtCvdUsd } from '../lib/binanceCvdFeed';

export type CvdBarChartMode = 'delta' | 'cum';

/**
 * CVD bars — green = positive, red = negative, height scaled by max |value| in window.
 * - `delta`: per-bar buyUsd − sellUsd (mitobot continuous TUI / CVD panel)
 * - `cum`: running cumDeltaUsd through each bar
 */
export function CvdBarChart({
  bars,
  barCount,
  intervalLabel = '5s',
  highlightT,
  compact = false,
  emptyLabel = 'Waiting for trades…',
  mode = 'delta',
  footerLabel,
}: {
  bars: readonly CvdBar[];
  barCount: number;
  /** Shown in footer (e.g. chart candle interval). */
  intervalLabel?: string;
  /** Highlight this bar open time (ms) — candle hover. */
  highlightT?: number | null;
  /** Shorter height for hover popups. */
  compact?: boolean;
  emptyLabel?: string;
  mode?: CvdBarChartMode;
  /** Override footer left text (default depends on mode). */
  footerLabel?: string;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const useCum = mode === 'cum';

  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setChartWidth(w > 0 ? Math.floor(w) : 0);
    });
    ro.observe(el);
    setChartWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const { maxAbs, visible, barW } = useMemo(() => {
    const n = Math.max(1, Math.floor(barCount));
    const slice = bars.length > n ? bars.slice(-n) : bars;
    // For cum mode, forward-fill / rebuild running sum so gaps don't drop the line to 0.
    let run = 0;
    const visible = slice.map((b) => {
      if (useCum) {
        if (Number.isFinite(b.cumDeltaUsd) && (b.tradeCount > 0 || Math.abs(b.deltaUsd) > 1e-9 || Math.abs(b.cumDeltaUsd) > 1e-9)) {
          run = b.cumDeltaUsd;
        } else {
          run += b.deltaUsd;
        }
        return { ...b, cumDeltaUsd: run };
      }
      return b;
    });
    let max = 0;
    for (const b of visible) {
      const v = useCum ? b.cumDeltaUsd : b.deltaUsd;
      max = Math.max(max, Math.abs(v));
    }
    const gap = 1;
    const inner = Math.max(0, chartWidth - 8);
    const w =
      visible.length > 0
        ? Math.max(2, Math.min(12, Math.floor((inner - gap * (visible.length - 1)) / visible.length)))
        : 2;
    return { maxAbs: max, visible, barW: w };
  }, [bars, barCount, chartWidth, useCum]);

  if (visible.length === 0) {
    return (
      <div className={`flex items-center justify-center text-[10px] text-gray-500 ${compact ? 'h-14' : 'h-full'}`}>
        {emptyLabel}
      </div>
    );
  }

  const modeTag = useCum ? 'cum Σ' : 'net Δ';

  return (
    <div className={`flex min-h-0 w-full flex-col gap-1 ${compact ? 'h-[4.5rem]' : 'h-full'}`}>
      <div ref={chartRef} className="relative min-h-0 w-full flex-1 overflow-hidden">
        <div className="absolute inset-x-0 top-1/2 h-px bg-gray-600/80" />
        <div className="flex h-full w-full max-w-full items-center justify-end gap-px px-1">
          {visible.map((b) => {
            const value = useCum ? b.cumDeltaUsd : b.deltaUsd;
            const up = value >= 0;
            const flat = Math.abs(value) < 1e-9;
            const h = maxAbs > 0 ? (Math.abs(value) / maxAbs) * 50 : 0;
            const highlighted = highlightT != null && b.t === highlightT;
            // Avoid ring-* on the column — at ~2px bar width a full-height sky ring
            // looks like a weird vertical blue stripe in the hover popup.
            const fillCls = useCum
              ? highlighted
                ? 'bg-sky-300'
                : 'bg-sky-400/85'
              : highlighted
                ? 'bg-green-400'
                : 'bg-green-500/85';
            const fillNegCls = useCum
              ? highlighted
                ? 'bg-fuchsia-300'
                : 'bg-fuchsia-400/85'
              : highlighted
                ? 'bg-red-400'
                : 'bg-red-500/85';
            return (
              <div
                key={b.t}
                className="relative flex h-full shrink-0 flex-col justify-center"
                style={{ width: barW }}
                title={
                  `${new Date(b.t).toLocaleTimeString()}\n` +
                  `Buy ${fmtCvdUsd(b.buyUsd)}\nSell ${fmtCvdUsd(b.sellUsd)}\n` +
                  `Δ ${fmtCvdUsd(b.deltaUsd)}\nΣ ${fmtCvdUsd(b.cumDeltaUsd)}`
                }
              >
                {highlighted ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-0.5 rounded-sm bg-amber-300"
                    aria-hidden
                  />
                ) : null}
                {up && !flat ? (
                  <div className="flex flex-1 flex-col items-stretch justify-end">
                    <div
                      className={`min-h-0 rounded-t-sm ${fillCls}`}
                      style={{ height: `${h}%` }}
                    />
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
                {flat ? (
                  <div className="absolute inset-x-0 top-1/2 z-[1] h-0.5 -translate-y-1/2 bg-cyan-400/70" />
                ) : null}
                {!up && !flat ? (
                  <div className="flex flex-1 flex-col items-stretch justify-start">
                    <div
                      className={`min-h-0 rounded-b-sm ${fillNegCls}`}
                      style={{ height: `${h}%` }}
                    />
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex shrink-0 justify-between px-1 text-[8px] text-gray-500">
        <span>
          {footerLabel ?? `${intervalLabel} · ${modeTag} · ${visible.length} bars`}
        </span>
        <span className="tabular-nums">max {fmtCvdUsd(maxAbs)}</span>
      </div>
    </div>
  );
}
