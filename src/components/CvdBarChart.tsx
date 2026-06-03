import { useMemo } from 'react';
import type { CvdBar } from '../lib/binanceCvdFeed';
import { fmtCvdUsd } from '../lib/binanceCvdFeed';

export function CvdBarChart({ bars }: { bars: readonly CvdBar[] }) {
  const { maxDelta, visible } = useMemo(() => {
    const tail = bars.slice(-120);
    let max = 0;
    for (const b of tail) {
      max = Math.max(max, Math.abs(b.deltaUsd));
    }
    return { maxDelta: max, visible: tail };
  }, [bars]);

  if (visible.length === 0) {
    return <div className="flex h-full items-center justify-center text-[10px] text-gray-500">Waiting for trades…</div>;
  }

  const barW = Math.max(2, Math.min(8, Math.floor(800 / visible.length)));

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="relative flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="absolute inset-x-0 top-1/2 h-px bg-gray-600/80" />
        <div className="flex h-full items-center gap-px px-1" style={{ minWidth: visible.length * (barW + 1) }}>
          {visible.map((b) => {
            const up = b.deltaUsd >= 0;
            const h = maxDelta > 0 ? (Math.abs(b.deltaUsd) / maxDelta) * 50 : 0;
            return (
              <div
                key={b.t}
                className="relative flex flex-col justify-center shrink-0 h-full"
                style={{ width: barW }}
                title={`${new Date(b.t).toLocaleTimeString()}\nBuy ${fmtCvdUsd(b.buyUsd)}\nSell ${fmtCvdUsd(b.sellUsd)}\nΔ ${fmtCvdUsd(b.deltaUsd)}`}
              >
                {up ? (
                  <div className="flex-1 flex flex-col justify-end items-stretch">
                    <div className="bg-green-500/85 rounded-t-sm min-h-0" style={{ height: `${h}%` }} />
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
                {!up ? (
                  <div className="flex-1 flex flex-col justify-start items-stretch">
                    <div className="bg-red-500/85 rounded-b-sm min-h-0" style={{ height: `${h}%` }} />
                  </div>
                ) : (
                  <div className="flex-1" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-between text-[8px] text-gray-500 px-1 shrink-0">
        <span>5s · net Δ</span>
        <span className="tabular-nums">max {fmtCvdUsd(maxDelta)}</span>
      </div>
    </div>
  );
}
