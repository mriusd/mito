import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CvdBar } from '../lib/binanceCvdFeed';
import { fmtCvdUsd } from '../lib/binanceCvdFeed';

export function CvdBarChart({
  bars,
  barCount,
}: {
  bars: readonly CvdBar[];
  barCount: number;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);

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

  const { maxDelta, visible, barW } = useMemo(() => {
    const n = Math.max(1, Math.floor(barCount));
    const visible = bars.length > n ? bars.slice(-n) : bars;
    let max = 0;
    for (const b of visible) {
      max = Math.max(max, Math.abs(b.deltaUsd));
    }
    const gap = 1;
    const inner = Math.max(0, chartWidth - 8);
    const w =
      visible.length > 0
        ? Math.max(2, Math.min(12, Math.floor((inner - gap * (visible.length - 1)) / visible.length)))
        : 2;
    return { maxDelta: max, visible, barW: w };
  }, [bars, barCount, chartWidth]);

  if (visible.length === 0) {
    return <div className="flex h-full items-center justify-center text-[10px] text-gray-500">Waiting for trades…</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-1">
      <div ref={chartRef} className="relative min-h-0 w-full flex-1 overflow-hidden">
        <div className="absolute inset-x-0 top-1/2 h-px bg-gray-600/80" />
        <div className="flex h-full w-full max-w-full items-center justify-end gap-px px-1">
          {visible.map((b) => {
            const up = b.deltaUsd >= 0;
            const h = maxDelta > 0 ? (Math.abs(b.deltaUsd) / maxDelta) * 50 : 0;
            return (
              <div
                key={b.t}
                className="relative flex h-full shrink-0 flex-col justify-center"
                style={{ width: barW }}
                title={`${new Date(b.t).toLocaleTimeString()}\nBuy ${fmtCvdUsd(b.buyUsd)}\nSell ${fmtCvdUsd(b.sellUsd)}\nΔ ${fmtCvdUsd(b.deltaUsd)}`}
              >
                {up ? (
                  <div className="flex flex-1 flex-col items-stretch justify-end">
                    <div className="min-h-0 rounded-t-sm bg-green-500/85" style={{ height: `${h}%` }} />
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
                {!up ? (
                  <div className="flex flex-1 flex-col items-stretch justify-start">
                    <div className="min-h-0 rounded-b-sm bg-red-500/85" style={{ height: `${h}%` }} />
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
        <span>5s · net Δ · {visible.length} bars</span>
        <span className="tabular-nums">max {fmtCvdUsd(maxDelta)}</span>
      </div>
    </div>
  );
}
