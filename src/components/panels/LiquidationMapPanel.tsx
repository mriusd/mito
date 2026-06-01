import { useState } from 'react';
import { LiquidationMapChart } from '../LiquidationMapChart';
import {
  LIQ_ASSETS,
  useBinanceLiqConnected,
  useBinanceLiqConnection,
  useBinanceLiqSnapshot,
  type LiqAsset,
} from '../../lib/binanceLiqFeed';

type LiqMode = 'estimate' | 'events';

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

export function LiquidationMapPanel({ panelId }: { panelId: string }) {
  useBinanceLiqConnection(true);
  const connected = useBinanceLiqConnected();
  const snap = useBinanceLiqSnapshot();
  const [asset, setAsset] = useState<LiqAsset>(() => readStoredAsset(panelId));
  const [mode, setMode] = useState<LiqMode>(() => readStoredMode(panelId));

  const selected =
    snap?.assets[asset] ??
    (snap ? (LIQ_ASSETS.map((a) => snap.assets[a]).find(Boolean) ?? null) : null);

  const cluster = selected?.nearestCluster;
  const longFrac =
    selected && selected.longShortRatio > 0
      ? selected.longShortRatio / (1 + selected.longShortRatio)
      : 0.5;

  return (
    <div className="panel-wrapper flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-gray-900/80 p-2">
      <div className="panel-header mb-1 flex items-center justify-between gap-2 shrink-0 cursor-grab">
        <div className="text-[10px] font-bold text-yellow-400/90">Liquidation Map · Binance</div>
        <div className="no-drag flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex rounded border border-gray-700 overflow-hidden text-[9px] font-semibold">
            {(['estimate', 'events'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`px-1.5 py-0.5 ${
                  mode === m ? 'bg-yellow-500/80 text-gray-900' : 'bg-gray-950 text-gray-400'
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
            className="rounded border border-gray-700 bg-gray-950 px-1.5 py-0.5 text-[10px] font-semibold text-gray-200 focus:outline-none"
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

      {selected ? (
        <>
          <div className="flex items-center gap-1.5 flex-wrap mb-1 shrink-0 text-[9px]">
            <span className="font-bold text-white">{selected.asset}</span>
            {cluster ? (
              <span
                className={`px-1 py-px rounded text-[8px] font-bold uppercase ${
                  cluster.side === 'long' ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'
                }`}
              >
                {cluster.side} wall {fmtPrice(cluster.price)} ({fmtPct(cluster.pctToSpot)})
              </span>
            ) : null}
            <span className="text-gray-600 ml-auto tabular-nums">
              OI {fmtUsd(selected.totalOiUsd)} · L/S {selected.longShortRatio.toFixed(2)} ({(longFrac * 100).toFixed(0)}%L)
            </span>
          </div>
          <div className="min-h-0 flex-1 flex flex-col justify-center">
            <LiquidationMapChart snap={selected} mode={mode} />
          </div>
        </>
      ) : (
        <div className="text-[10px] text-gray-500 p-2 flex-1">
          {connected ? 'Waiting for Binance liquidation data…' : 'Connecting…'}
        </div>
      )}
    </div>
  );
}
