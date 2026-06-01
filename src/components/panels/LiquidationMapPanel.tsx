import { useMemo, useState } from 'react';
import {
  LIQ_ASSETS,
  useBinanceLiqConnection,
  useBinanceLiqSnapshot,
  type LiqAsset,
  type LiqAssetSnapshot,
} from '../../lib/binanceLiqFeed';

type LiqMode = 'estimate' | 'events';

const DISPLAY_ROWS = 30;

function readStoredAsset(panelId: string): LiqAsset {
  const saved = localStorage.getItem(`polybot-liq-asset-${panelId}`);
  return LIQ_ASSETS.includes(saved as LiqAsset) ? (saved as LiqAsset) : 'BTC';
}

function readStoredMode(panelId: string): LiqMode {
  return localStorage.getItem(`polybot-liq-mode-${panelId}`) === 'events' ? 'events' : 'estimate';
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k`;
  if (v >= 1) return v.toFixed(0);
  return v.toFixed(4);
}

function fmtPct(v: number): string {
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(1)}%`;
}

type Row = { price: number; long: number; short: number };

function buildRows(
  entries: Array<{ price: number; long: number; short: number }>,
): Row[] {
  if (entries.length === 0) return [];
  const prices = entries.map((e) => e.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max <= min) {
    return entries.map((e) => ({ price: e.price, long: e.long, short: e.short }));
  }
  const step = (max - min) / DISPLAY_ROWS;
  const rows: Row[] = Array.from({ length: DISPLAY_ROWS }, (_, i) => ({
    price: min + step * (i + 0.5),
    long: 0,
    short: 0,
  }));
  for (const e of entries) {
    let idx = Math.floor((e.price - min) / step);
    if (idx < 0) idx = 0;
    if (idx >= DISPLAY_ROWS) idx = DISPLAY_ROWS - 1;
    rows[idx].long += e.long;
    rows[idx].short += e.short;
  }
  return rows.filter((r) => r.long > 0 || r.short > 0);
}

function AssetLiqMap({ snap, mode }: { snap: LiqAssetSnapshot; mode: LiqMode }) {
  const rows = useMemo(() => {
    const entries =
      mode === 'events'
        ? snap.events.map((e) => ({ price: e.price, long: e.longUsd, short: e.shortUsd }))
        : snap.levels.map((l) => ({ price: l.price, long: l.longLiqUsd, short: l.shortLiqUsd }));
    return buildRows(entries).sort((a, b) => b.price - a.price);
  }, [snap, mode]);

  const maxSide = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.long, r.short), 0),
    [rows],
  );

  const cluster = snap.nearestCluster;
  const longFrac = snap.longShortRatio > 0 ? snap.longShortRatio / (1 + snap.longShortRatio) : 0.5;

  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center gap-1.5 flex-wrap mb-1">
        <span className="text-[11px] font-bold text-white leading-none">{snap.asset}</span>
        <span className="text-[10px] tabular-nums text-gray-400 leading-none">
          ${snap.spot.toLocaleString(undefined, { maximumFractionDigits: snap.spot >= 1 ? 0 : 4 })}
        </span>
        {cluster ? (
          <span
            className={`px-1 py-px rounded text-[8px] font-bold uppercase tracking-wide leading-none ${
              cluster.side === 'long' ? 'bg-red-900/60 text-red-300' : 'bg-green-900/60 text-green-300'
            }`}
            title="Largest estimated liquidation cluster"
          >
            {cluster.side === 'long' ? 'long' : 'short'} wall {fmtPrice(cluster.price)} ({fmtPct(cluster.pctToSpot)})
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-x-2 gap-y-0 text-[9px] leading-tight mb-1">
        <div className="flex justify-between gap-1 min-w-0">
          <span className="text-gray-500 shrink-0">OI</span>
          <span className="tabular-nums text-gray-300 truncate text-right">{fmtUsd(snap.totalOiUsd)}</span>
        </div>
        <div className="flex justify-between gap-1 min-w-0">
          <span className="text-gray-500 shrink-0">L/S</span>
          <span className="tabular-nums text-gray-300 truncate text-right">
            {snap.longShortRatio > 0 ? snap.longShortRatio.toFixed(2) : '—'}{' '}
            <span className="text-gray-600">({(longFrac * 100).toFixed(0)}%L)</span>
          </span>
        </div>
        <div className="flex justify-between gap-1 min-w-0">
          <span className="text-gray-500 shrink-0">{snap.windowHours.toFixed(0)}h liq</span>
          <span className="tabular-nums truncate text-right">
            <span className="text-red-400">{fmtUsd(snap.eventLongUsd)}</span>
            <span className="text-gray-600">/</span>
            <span className="text-green-400">{fmtUsd(snap.eventShortUsd)}</span>
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-[9px] text-gray-600 px-1 py-2">
          {mode === 'events' ? 'no liquidations in window yet' : 'waiting for OI data…'}
        </div>
      ) : (
        <div className="flex flex-col gap-px">
          {rows.map((r) => {
            const longW = maxSide > 0 ? (r.long / maxSide) * 100 : 0;
            const shortW = maxSide > 0 ? (r.short / maxSide) * 100 : 0;
            const nearSpot = Math.abs(r.price - snap.spot) / snap.spot < 0.004;
            return (
              <div key={r.price} className="flex items-center gap-1 h-[11px]">
                <div
                  className={`w-[40px] shrink-0 text-right text-[8px] tabular-nums ${
                    nearSpot ? 'text-yellow-300 font-bold' : 'text-gray-500'
                  }`}
                >
                  {fmtPrice(r.price)}
                </div>
                <div className="relative flex-1 h-[9px] flex items-center">
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-700" />
                  <div className="absolute right-1/2 left-0 flex items-center justify-end pr-px">
                    {r.long > 0 ? (
                      <div
                        className="h-[7px] bg-red-500/70 rounded-l-sm"
                        style={{ width: `${longW}%` }}
                        title={`long liq ${fmtUsd(r.long)} @ ${fmtPrice(r.price)}`}
                      />
                    ) : null}
                  </div>
                  <div className="absolute left-1/2 right-0 flex items-center justify-start pl-px">
                    {r.short > 0 ? (
                      <div
                        className="h-[7px] bg-green-500/70 rounded-r-sm"
                        style={{ width: `${shortW}%` }}
                        title={`short liq ${fmtUsd(r.short)} @ ${fmtPrice(r.price)}`}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LiquidationMapPanel({ panelId }: { panelId: string }) {
  useBinanceLiqConnection(true);
  const snap = useBinanceLiqSnapshot();
  const [asset, setAsset] = useState<LiqAsset>(() => readStoredAsset(panelId));
  const [mode, setMode] = useState<LiqMode>(() => readStoredMode(panelId));

  const selected = snap?.assets[asset] ?? null;

  return (
    <div className="panel-wrapper flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-gray-800/50 p-3">
      <div className="panel-header mb-1.5 flex items-center justify-between gap-2 shrink-0 cursor-grab">
        <div className="text-[11px] font-bold text-yellow-400">Liquidation Map (Binance)</div>
        <div className="no-drag flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex rounded border border-gray-600 overflow-hidden text-[9px] font-semibold">
            {(['estimate', 'events'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`px-1.5 py-0.5 ${
                  mode === m ? 'bg-yellow-500/80 text-gray-900' : 'bg-gray-900 text-gray-300'
                }`}
                onClick={() => {
                  setMode(m);
                  localStorage.setItem(`polybot-liq-mode-${panelId}`, m);
                }}
              >
                {m === 'estimate' ? 'Est' : 'Real'}
              </button>
            ))}
          </div>
          <select
            className="rounded border border-gray-600 bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-gray-200 focus:outline-none"
            value={asset}
            onChange={(e) => {
              const next = e.target.value as LiqAsset;
              setAsset(next);
              localStorage.setItem(`polybot-liq-asset-${panelId}`, next);
            }}
          >
            {LIQ_ASSETS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="text-[8px] text-gray-500 mb-1 px-0.5 shrink-0">
        {mode === 'estimate'
          ? 'estimated leverage clusters (model) · red=long liqs below · green=short liqs above'
          : 'real liquidations (forceOrder) · red=longs · green=shorts'}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {selected ? (
          <AssetLiqMap key={asset} snap={selected} mode={mode} />
        ) : (
          <div className="text-[10px] text-gray-500 p-2">Connecting to Binance liquidation feed…</div>
        )}
      </div>
    </div>
  );
}
