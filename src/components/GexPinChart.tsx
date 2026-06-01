import { useMemo, useState } from 'react';
import type { GexExpiryBucket } from '../lib/deribitGexFeed';

function fmtPinAxis(v: number, compact: boolean): string {
  if (v >= 1000) {
    const k = v / 1000;
    return compact ? `${k.toFixed(0)}k` : `${k.toFixed(v >= 100000 ? 0 : 1)}k`;
  }
  return v.toFixed(0);
}

function fmtPinHover(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

type GexPinChartProps = {
  expirations: GexExpiryBucket[];
  spot: number;
  compact?: boolean;
};

export function GexPinChart({ expirations, spot, compact = false }: GexPinChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const points = useMemo(() => {
    const now = Date.now();
    return expirations
      .filter(
        (e) =>
          e.expiryMs > now &&
          e.pinStrike != null &&
          Number.isFinite(e.pinStrike) &&
          (e.pinStrike as number) > 0,
      )
      .sort((a, b) => a.expiryMs - b.expiryMs)
      .map((e) => ({ label: e.label, expiryMs: e.expiryMs, pin: e.pinStrike as number }));
  }, [expirations]);

  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const W = compact ? 100 : 320;
    const H = compact ? 22 : 108;
    const padL = compact ? 13 : 34;
    const padR = compact ? 1 : 6;
    const padT = compact ? 1 : 6;
    const padB = compact ? 1 : 22;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const pins = points.map((p) => p.pin);
    let yMin = Math.min(...pins, spot);
    let yMax = Math.max(...pins, spot);
    const span = yMax - yMin || spot * 0.01;
    const yPad = span * (compact ? 0.06 : 0.1);
    yMin -= yPad;
    yMax += yPad;

    const xAt = (i: number) => padL + (i / (points.length - 1)) * plotW;
    const yAt = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    const linePath = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(2)} ${yAt(p.pin).toFixed(2)}`)
      .join(' ');

    const spotY = yAt(spot);
    const tickCount = compact ? 2 : 4;
    const yTicks = Array.from({ length: tickCount }, (_, i) => {
      const v = yMin + ((yMax - yMin) * i) / (tickCount - 1);
      return { v, y: yAt(v), label: fmtPinAxis(v, compact) };
    });

    const labelEvery = points.length <= 8 ? 1 : Math.ceil(points.length / 6);
    const xLabels = compact
      ? []
      : points
          .map((p, i) => ({ ...p, i, x: xAt(i) }))
          .filter((_, i) => i === 0 || i === points.length - 1 || i % labelEvery === 0);

    return { W, H, padL, padT, plotW, plotH, linePath, spotY, yTicks, xLabels, xAt, yAt, points };
  }, [compact, points, spot]);

  if (!geometry) return null;

  const { W, H, padL, padT, plotW, plotH, linePath, spotY, yTicks, xLabels, points: pts, xAt, yAt } =
    geometry;
  const hovered = hoverIdx != null ? pts[hoverIdx] : null;
  const hoverX = hoverIdx != null ? xAt(hoverIdx) : 0;
  const hoverY = hovered != null ? yAt(hovered.pin) : 0;

  return (
    <div className={compact ? 'relative h-full w-full min-w-0' : 'relative mb-1.5 w-full'} title="Pin strike by expiry">
      {!compact ? (
        <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
          Pin by expiry
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={`block w-full h-full min-h-0 min-w-0 ${compact ? '' : 'h-auto'}`}
        aria-label="Pin strike by expiration"
        preserveAspectRatio={compact ? 'none' : 'xMidYMid meet'}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {!compact ? (
          <rect x={padL} y={padT} width={plotW} height={plotH} fill="rgb(17 24 39 / 0.35)" rx="2" />
        ) : null}
        {yTicks.map((t) => (
          <g key={`${t.label}-${t.v}`}>
            {!compact ? (
              <line
                x1={padL}
                y1={t.y}
                x2={padL + plotW}
                y2={t.y}
                stroke="rgb(55 65 81 / 0.45)"
                strokeWidth="0.5"
              />
            ) : null}
            <text
              x={padL - 2}
              y={t.y + (compact ? 2 : 3)}
              textAnchor="end"
              className="fill-gray-500"
              style={{ fontSize: compact ? 5 : 7 }}
            >
              {t.label}
            </text>
          </g>
        ))}
        <line
          x1={padL}
          y1={spotY}
          x2={padL + plotW}
          y2={spotY}
          stroke="rgb(156 163 175 / 0.55)"
          strokeWidth={compact ? 0.5 : 0.75}
          strokeDasharray={compact ? '2 2' : '3 2'}
        />
        <path
          d={linePath}
          fill="none"
          stroke="rgb(250 204 21 / 0.85)"
          strokeWidth={compact ? 1 : 1.5}
          strokeLinejoin="round"
        />
        {pts.map((p, i) => {
          const cx = xAt(i);
          const cy = yAt(p.pin);
          const active = hoverIdx === i;
          return (
            <g key={p.expiryMs}>
              <circle
                cx={cx}
                cy={cy}
                r={compact ? 5 : 6}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIdx(i)}
              />
              <circle
                cx={cx}
                cy={cy}
                r={active ? (compact ? 2 : 3) : compact ? 1 : 2.2}
                fill="rgb(250 204 21)"
                stroke={active ? 'rgb(255 255 255)' : 'rgb(17 24 39)'}
                strokeWidth={active ? 0.6 : 0.4}
                pointerEvents="none"
              />
            </g>
          );
        })}
        {xLabels.map((p) => (
          <text
            key={p.expiryMs}
            x={p.x}
            y={H - 4}
            textAnchor="middle"
            className="fill-gray-500"
            style={{ fontSize: 6.5 }}
          >
            {p.label}
          </text>
        ))}
      </svg>
      {hovered ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-gray-950/95 px-1 py-px text-[8px] font-bold tabular-nums text-yellow-300 shadow-sm ring-1 ring-gray-700/80"
          style={{
            left: `${(hoverX / W) * 100}%`,
            top: `${(hoverY / H) * 100}%`,
            marginTop: compact ? -2 : -4,
          }}
        >
          {fmtPinHover(hovered.pin)}
        </div>
      ) : null}
      {!compact ? (
        <div className="text-[8px] text-gray-600 px-0.5">
          <span className="inline-block w-3 border-t border-dashed border-gray-500 align-middle mr-1" />
          spot
        </div>
      ) : null}
    </div>
  );
}
