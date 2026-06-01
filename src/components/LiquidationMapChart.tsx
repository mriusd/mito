import { useMemo, useState } from 'react';
import type { LiqAssetSnapshot } from '../lib/binanceLiqFeed';

type LiqMode = 'estimate' | 'events';

const BINS = 52;

type Bin = { price: number; long: number; short: number; idx: number };

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtHoverPrice(v: number, spot: number): string {
  if (spot >= 1000) return `$${(v / 1000).toFixed(2)}k`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function fmtAxisPrice(v: number, span: number): string {
  if (v >= 1000) {
    const k = v / 1000;
    if (span <= 0.06) return `${k.toFixed(2)}K`;
    if (span <= 0.1) return `${k.toFixed(1)}K`;
    return `${k.toFixed(k >= 100 ? 0 : 1)}K`;
  }
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

function fmtSpotLabel(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(2)}K`;
  return v.toFixed(2);
}

function fmtAxisVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

function binEntries(
  entries: Array<{ price: number; long: number; short: number }>,
  spot: number,
  span: number,
): Bin[] {
  if (entries.length === 0 || spot <= 0) return [];
  const lo = spot * (1 - span);
  const hi = spot * (1 + span);
  const step = (hi - lo) / BINS;
  const bins: Bin[] = Array.from({ length: BINS }, (_, i) => ({
    price: lo + step * (i + 0.5),
    long: 0,
    short: 0,
    idx: i,
  }));
  for (const e of entries) {
    if (e.price < lo || e.price > hi) continue;
    let idx = Math.floor((e.price - lo) / step);
    if (idx < 0) idx = 0;
    if (idx >= BINS) idx = BINS - 1;
    bins[idx].long += e.long;
    bins[idx].short += e.short;
  }
  return bins;
}

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let nice = 1;
  if (norm > 5) nice = 10;
  else if (norm > 2) nice = 5;
  else if (norm > 1) nice = 2;
  return nice * mag;
}

function buildCumLongPts(below: Bin[], spotX: number, xAt: (p: number) => number): Array<{ x: number; y: number }> {
  if (below.length === 0) return [{ x: spotX, y: 0 }];
  const pts: Array<{ x: number; y: number }> = [];
  for (const b of below) {
    let cum = 0;
    for (const o of below) {
      if (o.price >= b.price) cum += o.long;
    }
    pts.push({ x: xAt(b.price), y: cum });
  }
  pts.push({ x: spotX, y: 0 });
  return pts;
}

function buildCumShortPts(above: Bin[], spotX: number, xAt: (p: number) => number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [{ x: spotX, y: 0 }];
  let cum = 0;
  for (const b of above) {
    cum += b.short;
    pts.push({ x: xAt(b.price), y: cum });
  }
  return pts;
}

type ChartGeom = {
  W: number;
  H: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  plotW: number;
  plotH: number;
  span: number;
  spot: number;
  spotX: number;
  bins: Bin[];
  maxBar: number;
  maxCum: number;
  xAt: (p: number) => number;
  yBar: (v: number) => number;
  yCum: (v: number) => number;
  barW: number;
  cumLongPath: string;
  cumShortPath: string;
  xTicks: number[];
  yBarTicks: number[];
  yCumTicks: number[];
};

function buildChartGeom(bins: Bin[], spot: number, span: number): ChartGeom | null {
  if (bins.length === 0 || spot <= 0) return null;

  const W = 640;
  const H = 220;
  const padL = 38;
  const padR = 44;
  const padT = 28;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const lo = spot * (1 - span);
  const hi = spot * (1 + span);

  let maxBar = 0;
  for (const b of bins) {
    const v = b.price <= spot ? b.long : b.short;
    if (v > maxBar) maxBar = v;
  }
  if (maxBar <= 0) maxBar = 1;

  const xAt = (p: number) => padL + ((p - lo) / (hi - lo)) * plotW;
  const yBar = (v: number) => padT + plotH - (v / maxBar) * plotH * 0.92;
  const spotX = xAt(spot);

  const below = bins.filter((b) => b.price <= spot);
  const above = bins.filter((b) => b.price >= spot);

  const cumLongPts = buildCumLongPts(below, spotX, xAt);
  const cumShortPts = buildCumShortPts(above, spotX, xAt);

  let maxCum = 0;
  for (const p of [...cumLongPts, ...cumShortPts]) {
    if (p.y > maxCum) maxCum = p.y;
  }
  if (maxCum <= 0) maxCum = 1;

  const yCum = (v: number) => padT + plotH - (v / maxCum) * plotH * 0.92;

  const toPath = (pts: Array<{ x: number; y: number }>) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${yCum(p.y).toFixed(2)}`).join(' ');

  const barW = Math.max(1.5, (plotW / BINS) * 0.72);

  const tickStep = niceStep(hi - lo, 14);
  const xTicks: number[] = [];
  for (let p = Math.ceil(lo / tickStep) * tickStep; p <= hi + tickStep * 0.01; p += tickStep) {
    xTicks.push(p);
  }

  const yBarTicks = [0, maxBar * 0.5, maxBar];
  const yCumTicks = [0, maxCum * 0.5, maxCum];

  return {
    W,
    H,
    padL,
    padR,
    padT,
    padB,
    plotW,
    plotH,
    span,
    spot,
    spotX,
    bins,
    maxBar,
    maxCum,
    xAt,
    yBar,
    yCum,
    barW,
    cumLongPath: toPath(cumLongPts),
    cumShortPath: toPath(cumShortPts),
    xTicks,
    yBarTicks,
    yCumTicks,
  };
}

type LiquidationMapChartProps = {
  snap: LiqAssetSnapshot;
  mode: LiqMode;
};

export function LiquidationMapChart({ snap, mode }: LiquidationMapChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const geom = useMemo(() => {
    const entries =
      mode === 'events'
        ? snap.events.map((e) => ({ price: e.price, long: e.longUsd, short: e.shortUsd }))
        : snap.levels.map((l) => ({ price: l.price, long: l.longLiqUsd, short: l.shortLiqUsd }));
    const span = mode === 'events' && entries.length > 0 ? 0.08 : 0.12;
    const bins = binEntries(entries, snap.spot, span);
    return buildChartGeom(bins, snap.spot, span);
  }, [snap, mode]);

  if (!geom) {
    return (
      <div className="text-[9px] text-gray-600 px-1 py-4 text-center">
        {mode === 'events' ? 'no liquidations in window yet' : 'waiting for OI data…'}
      </div>
    );
  }

  const {
    W,
    H,
    padL,
    padT,
    plotH,
    span,
    spot,
    spotX,
    bins,
    xAt,
    yBar,
    barW,
    cumLongPath,
    cumShortPath,
    xTicks,
    yBarTicks,
    yCumTicks,
    yCum,
  } = geom;

  const hovered = hoverIdx != null ? bins[hoverIdx] : null;
  const hoverVal = hovered ? (hovered.price <= spot ? hovered.long : hovered.short) : 0;
  const hoverX = hovered ? xAt(hovered.price) : 0;
  const hoverY = hovered && hoverVal > 0 ? yBar(hoverVal) : padT;

  return (
    <div className="relative w-full min-h-0 flex flex-col">
      <div className="text-center text-[10px] font-semibold text-gray-200 mb-0.5 shrink-0">
        Current Price ({fmtSpotLabel(spot)})
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block"
        aria-label="Liquidation map"
        onMouseLeave={() => setHoverIdx(null)}
      >
        <rect x={padL} y={padT} width={geom.plotW} height={plotH} fill="rgb(15 23 42 / 0.55)" rx="2" />
        {yBarTicks.map((t) => (
          <line
            key={`g-${t}`}
            x1={padL}
            y1={yBar(t)}
            x2={padL + geom.plotW}
            y2={yBar(t)}
            stroke="rgb(55 65 81 / 0.35)"
            strokeWidth="0.5"
          />
        ))}
        {xTicks.map((p) => (
          <line
            key={`vx-${p}`}
            x1={xAt(p)}
            y1={padT}
            x2={xAt(p)}
            y2={padT + plotH}
            stroke="rgb(55 65 81 / 0.2)"
            strokeWidth="0.5"
          />
        ))}
        {bins.map((b) => {
          const v = b.price <= spot ? b.long : b.short;
          if (v <= 0) return null;
          const x = xAt(b.price) - barW / 2;
          const y = yBar(v);
          const h = padT + plotH - y;
          const below = b.price <= spot;
          const active = hoverIdx === b.idx;
          return (
            <g key={b.idx}>
              <rect
                x={x - 1}
                y={padT}
                width={barW + 2}
                height={plotH}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIdx(b.idx)}
              />
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                fill={below ? 'rgb(185 28 28 / 0.75)' : 'rgb(22 163 74 / 0.75)'}
                stroke={active ? 'rgb(250 204 21 / 0.9)' : 'none'}
                strokeWidth={active ? 0.8 : 0}
                rx="0.5"
                pointerEvents="none"
              />
            </g>
          );
        })}
        <path d={cumLongPath} fill="none" stroke="rgb(74 222 128 / 0.95)" strokeWidth="1.8" />
        <path d={cumShortPath} fill="none" stroke="rgb(248 113 113 / 0.95)" strokeWidth="1.8" />
        <line
          x1={spotX}
          y1={padT}
          x2={spotX}
          y2={padT + plotH}
          stroke="rgb(250 204 21 / 0.85)"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
        {xTicks.map((p) => (
          <text
            key={p}
            x={xAt(p)}
            y={H - 5}
            textAnchor="middle"
            className="fill-gray-500"
            style={{ fontSize: 7.5 }}
          >
            {fmtAxisPrice(p, span)}
          </text>
        ))}
        <text
          x={8}
          y={padT + plotH / 2}
          transform={`rotate(-90 8 ${padT + plotH / 2})`}
          textAnchor="middle"
          className="fill-gray-500"
          style={{ fontSize: 8 }}
        >
          Liquidations
        </text>
        {yBarTicks.slice(1).map((t) => (
          <text
            key={`yl-${t}`}
            x={padL - 4}
            y={yBar(t) + 3}
            textAnchor="end"
            className="fill-gray-600"
            style={{ fontSize: 7 }}
          >
            {fmtAxisVol(t)}
          </text>
        ))}
        <text
          x={W - 6}
          y={padT + plotH / 2}
          transform={`rotate(90 ${W - 6} ${padT + plotH / 2})`}
          textAnchor="middle"
          className="fill-gray-500"
          style={{ fontSize: 8 }}
        >
          Cumulative
        </text>
        {yCumTicks.slice(1).map((t) => (
          <text
            key={`yr-${t}`}
            x={W - padL + 4}
            y={yCum(t) + 3}
            textAnchor="start"
            className="fill-gray-600"
            style={{ fontSize: 7 }}
          >
            {fmtAxisVol(t)}
          </text>
        ))}
      </svg>
      {hovered && hoverVal > 0 ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded bg-gray-950/95 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-yellow-300 shadow ring-1 ring-gray-700/80"
          style={{
            left: `${(hoverX / W) * 100}%`,
            top: `${((hoverY - 8) / H) * 100}%`,
          }}
        >
          {fmtHoverPrice(hovered.price, spot)} · {hovered.price <= spot ? 'long' : 'short'}{' '}
          {fmtUsd(hoverVal)}
        </div>
      ) : null}
      <div className="flex items-center justify-center gap-3 text-[8px] text-gray-500 shrink-0 mt-0.5">
        <span>
          <span className="inline-block w-2 h-2 bg-red-700/80 align-middle mr-1 rounded-sm" />
          long liqs
        </span>
        <span>
          <span className="inline-block w-2 h-2 bg-green-600/80 align-middle mr-1 rounded-sm" />
          short liqs
        </span>
        <span>
          <span className="inline-block w-3 border-t-2 border-green-400 align-middle mr-1" />
          cum long ↓ spot
        </span>
        <span>
          <span className="inline-block w-3 border-t-2 border-red-400 align-middle mr-1" />
          cum short ↑
        </span>
      </div>
    </div>
  );
}
