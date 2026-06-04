import { memo, useState } from 'react';
import { LiquidationMapPanelBody } from './LiquidationMapPanelBody';
import { LIQ_ASSETS, useBinanceLiqConnection, type LiqAsset } from '../../lib/binanceLiqFeed';

type LiqMode = 'estimate' | 'events';

function readStoredAsset(panelId: string): LiqAsset {
  const saved = localStorage.getItem(`polybot-liq-asset-${panelId}`);
  return LIQ_ASSETS.includes(saved as LiqAsset) ? (saved as LiqAsset) : 'BTC';
}

function readStoredMode(panelId: string): LiqMode {
  return localStorage.getItem(`polybot-liq-mode-${panelId}`) === 'events' ? 'events' : 'estimate';
}

function LiquidationMapPanelShell({ panelId }: { panelId: string }) {
  useBinanceLiqConnection(true);
  const [asset, setAsset] = useState<LiqAsset>(() => readStoredAsset(panelId));
  const [mode, setMode] = useState<LiqMode>(() => readStoredMode(panelId));

  return (
    <div className="panel-wrapper flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-gray-900/80 p-2">
      <div className="panel-header mb-1 flex items-center justify-between gap-2 shrink-0 cursor-grab">
        <div className="text-[10px] font-bold text-yellow-400/90">Liq Map · Binance</div>
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

      <div className="min-h-0 flex-1 flex flex-col">
        <LiquidationMapPanelBody asset={asset} mode={mode} />
      </div>
    </div>
  );
}

export const LiquidationMapPanel = memo(LiquidationMapPanelShell);
