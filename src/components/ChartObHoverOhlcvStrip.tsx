import { formatMarketCountdown } from '../lib/marketCountdown';

export type ChartObHoverOhlcv = {
  timeMs: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

function fmtCandleTime(timeMs: number, interval?: string): string {
  const d = new Date(timeMs);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (interval === '5s') return `${hm}:${String(d.getSeconds()).padStart(2, '0')}`;
  const date = `${d.getMonth() + 1}/${d.getDate()}`;
  return `${date} ${hm}`;
}

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

export function ChartObHoverOhlcvStrip({
  ohlcv,
  interval,
  expiryMs,
}: {
  ohlcv: ChartObHoverOhlcv;
  interval?: string;
  /** Market expiry — show TTL remaining as of candle open time. */
  expiryMs?: number;
}) {
  const isBull = ohlcv.c >= ohlcv.o;
  const color = isBull ? 'text-emerald-400' : 'text-red-400';
  const ttl =
    expiryMs != null && Number.isFinite(expiryMs)
      ? formatMarketCountdown(new Date(expiryMs).toISOString(), ohlcv.timeMs)
      : null;

  return (
    <div className="mb-2 border-b border-gray-700/80 pb-2 px-0.5">
      <div className="mb-1.5 text-[10px] font-semibold tabular-nums text-gray-300 text-center">
        {fmtCandleTime(ohlcv.timeMs, interval)}
        {ttl?.text ? (
          <span
            className={`ml-1.5 font-bold ${
              ttl.remaining <= 0
                ? 'text-gray-500'
                : ttl.remaining < 3_600_000
                  ? 'text-amber-400'
                  : 'text-cyan-400/90'
            }`}
            title="Time to expiry at this candle"
          >
            · {ttl.remaining <= 0 ? 'expired' : `${ttl.text} left`}
          </span>
        ) : null}
      </div>
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
