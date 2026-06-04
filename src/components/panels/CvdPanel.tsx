import { useState } from 'react';
import { CvdBarChart } from '../CvdBarChart';
import {
  CVD_ASSETS,
  fmtCvdUsd,
  useBinanceCvdConnected,
  useBinanceCvdConnection,
  useBinanceCvdSnapshot,
  type CvdAsset,
} from '../../lib/binanceCvdFeed';

const CVD_BAR_COUNT_OPTIONS = [30, 60, 90, 120, 180, 240] as const;
type CvdBarCount = (typeof CVD_BAR_COUNT_OPTIONS)[number];

function readStoredAsset(panelId: string): CvdAsset {
  const saved = localStorage.getItem(`polybot-cvd-asset-${panelId}`);
  return CVD_ASSETS.includes(saved as CvdAsset) ? (saved as CvdAsset) : 'BTC';
}

function readStoredBarCount(panelId: string): CvdBarCount {
  const saved = Number(localStorage.getItem(`polybot-cvd-bars-${panelId}`));
  return (CVD_BAR_COUNT_OPTIONS as readonly number[]).includes(saved)
    ? (saved as CvdBarCount)
    : 60;
}

function fmtSpot(v: number, asset: string): string {
  if (v <= 0) return '—';
  if (asset === 'XRP') return `$${v.toFixed(4)}`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function CvdPanel({ panelId }: { panelId: string }) {
  useBinanceCvdConnection(true);
  const connected = useBinanceCvdConnected();
  const snap = useBinanceCvdSnapshot();
  const [asset, setAsset] = useState<CvdAsset>(() => readStoredAsset(panelId));
  const [barCount, setBarCount] = useState<CvdBarCount>(() => readStoredBarCount(panelId));

  const selected = snap?.assets[asset] ?? null;
  const lastBar = selected?.bars[selected.bars.length - 1];

  return (
    <div className="panel-wrapper flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-gray-900/80 p-2">
      <div className="panel-header mb-1 flex items-center justify-between gap-2 shrink-0 cursor-grab">
        <div className="text-[10px] font-bold text-yellow-400/90">CVD · Binance spot</div>
        <div className="no-drag flex items-center gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
          <span className={`text-[8px] ${connected ? 'text-green-500' : 'text-gray-600'}`}>
            {connected ? 'mito' : '…'}
          </span>
          <select
            className="rounded border border-gray-700 bg-gray-950 px-1.5 py-0.5 text-[10px] font-semibold text-gray-200 focus:outline-none"
            value={barCount}
            title="Bars shown"
            onChange={(e) => {
              const next = Number(e.target.value) as CvdBarCount;
              setBarCount(next);
              localStorage.setItem(`polybot-cvd-bars-${panelId}`, String(next));
            }}
          >
            {CVD_BAR_COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}b
              </option>
            ))}
          </select>
          <select
            className="rounded border border-gray-700 bg-gray-950 px-1.5 py-0.5 text-[10px] font-semibold text-gray-200 focus:outline-none"
            value={asset}
            onChange={(e) => {
              const next = e.target.value as CvdAsset;
              setAsset(next);
              localStorage.setItem(`polybot-cvd-asset-${panelId}`, next);
            }}
          >
            {CVD_ASSETS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[9px] shrink-0">
        <span className="text-gray-500">
          Spot <span className="tabular-nums text-gray-300">{fmtSpot(selected?.spot ?? 0, asset)}</span>
        </span>
        <span className="text-gray-500">
          Cum Δ{' '}
          <span
            className={`tabular-nums font-bold ${(selected?.cumDeltaUsd ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}
          >
            {fmtCvdUsd(selected?.cumDeltaUsd ?? 0)}
          </span>
        </span>
        {lastBar ? (
          <span className="text-gray-500">
            Bar Δ{' '}
            <span className={`tabular-nums ${lastBar.deltaUsd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {fmtCvdUsd(lastBar.deltaUsd)}
            </span>
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        {selected && selected.bars.length > 0 ? (
          <CvdBarChart bars={selected.bars} barCount={barCount} />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-gray-500">
            {connected ? 'Waiting for mito CVD…' : 'Connecting to mito…'}
          </div>
        )}
      </div>
    </div>
  );
}
