export type ChartObHoverOhlcv = {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

function fmtCandleVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (v >= 100) return v.toFixed(0);
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

function fmtCents(v: number): string {
  return `${v.toFixed(1)}¢`;
}

export function ChartObHoverOhlcvStrip({ ohlcv }: { ohlcv: ChartObHoverOhlcv }) {
  const isBull = ohlcv.c >= ohlcv.o;
  const color = isBull ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="mb-2 border-b border-gray-700/80 pb-2 px-0.5">
      <div className="grid grid-cols-5 gap-x-1 mb-1 text-[9px] font-medium text-gray-500">
        <span>O</span>
        <span>H</span>
        <span>L</span>
        <span>C</span>
        <span className="text-right">V</span>
      </div>
      <div className={`grid grid-cols-5 gap-x-1 text-[10px] font-bold tabular-nums ${color}`}>
        <span title={fmtCents(ohlcv.o)}>{fmtCents(ohlcv.o)}</span>
        <span title={fmtCents(ohlcv.h)}>{fmtCents(ohlcv.h)}</span>
        <span title={fmtCents(ohlcv.l)}>{fmtCents(ohlcv.l)}</span>
        <span title={fmtCents(ohlcv.c)}>{fmtCents(ohlcv.c)}</span>
        <span className="text-right text-gray-200" title={`Volume ${ohlcv.v}`}>
          {fmtCandleVolume(ohlcv.v)}
        </span>
      </div>
    </div>
  );
}
