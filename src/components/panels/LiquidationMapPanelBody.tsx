import { memo } from 'react';
import { LiquidationMapChart } from '../LiquidationMapChart';
import {
  useBinanceLiqAssetSnapshot,
  useBinanceLiqConnected,
  type LiqAsset,
} from '../../lib/binanceLiqFeed';

type LiqMode = 'estimate' | 'events';

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPrice(v: number, asset: string): string {
  if (asset === 'XRP') return v.toFixed(3);
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k`;
  if (v >= 1) return v.toFixed(0);
  return v.toFixed(4);
}

function fmtPct(v: number): string {
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(1)}%`;
}

export const LiquidationMapPanelBody = memo(function LiquidationMapPanelBody({
  asset,
  mode,
}: {
  asset: LiqAsset;
  mode: LiqMode;
}) {
  const connected = useBinanceLiqConnected();
  const selected = useBinanceLiqAssetSnapshot(asset);

  if (!selected) {
    return (
      <div className="text-[10px] text-gray-500 p-2 flex-1">
        {connected ? 'Waiting for Binance liquidation data…' : 'Connecting…'}
      </div>
    );
  }

  const cluster = selected.nearestCluster;
  const longFrac =
    selected.longShortRatio > 0 ? selected.longShortRatio / (1 + selected.longShortRatio) : 0.5;

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap mb-1 shrink-0 text-[9px]">
        <span className="font-bold text-white">{selected.asset}</span>
        {cluster ? (
          <span
            className={`px-1 py-px rounded text-[8px] font-bold uppercase ${
              cluster.side === 'long' ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'
            }`}
          >
            {cluster.side} wall {fmtPrice(cluster.price, asset)} ({fmtPct(cluster.pctToSpot)})
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
  );
});
