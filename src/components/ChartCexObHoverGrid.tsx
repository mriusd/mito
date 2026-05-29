import { Triangle } from 'lucide-react';
import { formatSpotObImpactUsd, formatSpotObMovePctLabel } from '../lib/binanceSpotObImpact';
import {
  SPOT_OB_MOVE_PCT_LEVELS,
  cexObCellForPct,
  type CexObAssetPanel,
  type CexObCandleSnapshot,
  type CexObExchangePanels,
} from '../lib/cexObSnapshot';
import type { AssetName } from '../types';
import { formatPrice } from '../utils/format';

function impactFromCell(cell: ReturnType<typeof cexObCellForPct>) {
  if (!cell) return null;
  return { usd: cell.usd, depthCapped: cell.capped };
}

function impactPair(panel: CexObAssetPanel | null | undefined, pct: number) {
  const up = impactFromCell(cexObCellForPct(panel?.up ?? [], pct));
  const down = impactFromCell(cexObCellForPct(panel?.down ?? [], pct));
  const upUsd = up?.usd ?? 0;
  const downUsd = down?.usd ?? 0;
  const total = upUsd + downUsd;
  return {
    up,
    down,
    upFrac: total > 0 ? upUsd / total : 0,
    downFrac: total > 0 ? downUsd / total : 0,
  };
}

function ImpactCell({
  value,
  frac,
  tone,
}: {
  value: ReturnType<typeof impactFromCell>;
  frac: number;
  tone: 'up' | 'down';
}) {
  const barClass = tone === 'up' ? 'bg-green-900/55' : 'bg-red-900/55';
  const textClass = tone === 'up' ? 'text-green-300/95' : 'text-red-300/95';
  const widthPct = Math.max(0, Math.min(100, frac * 100));
  return (
    <td
      className={`relative overflow-hidden py-0.5 px-1 text-right text-[9px] tabular-nums font-bold whitespace-nowrap w-[52px] ${textClass}`}
    >
      {widthPct > 0 ? (
        <div className={`absolute inset-y-0 right-0 ${barClass}`} style={{ width: `${widthPct}%` }} />
      ) : null}
      <span className="relative z-[1]">{formatSpotObImpactUsd(value)}</span>
    </td>
  );
}

function ExchangeTable({
  exchangeLabel,
  panel,
  asset,
}: {
  exchangeLabel: string;
  panel: CexObAssetPanel;
  asset: AssetName;
}) {
  const mid = panel.mid ?? null;
  return (
    <table className="w-full border-collapse text-[9px] mb-1.5 last:mb-0">
      <thead>
        <tr className="text-gray-500">
          <th className="w-[52px] py-0.5 px-1 font-medium text-left" />
          <th className="w-[26px] py-0.5 px-1 font-medium text-center">U/D</th>
          {SPOT_OB_MOVE_PCT_LEVELS.map((pct) => (
            <th key={pct} className="text-right font-medium py-0.5 px-1">
              {formatSpotObMovePctLabel(pct)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="border-t border-gray-800/80">
          <td className="py-0.5 px-0.5 text-center align-middle" rowSpan={2}>
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[8px] font-bold text-gray-400">{exchangeLabel}</span>
              <span className="text-[8px] tabular-nums text-gray-500 whitespace-nowrap">
                {mid != null ? formatPrice(mid, asset) : '—'}
              </span>
            </div>
          </td>
          <td className="py-0.5 px-0.5 text-center">
            <Triangle className="mx-auto h-2 w-2 fill-green-400 stroke-green-400 text-green-400" strokeWidth={1.5} />
          </td>
          {SPOT_OB_MOVE_PCT_LEVELS.map((pct) => {
            const { up, upFrac } = impactPair(panel, pct);
            return <ImpactCell key={`up-${pct}`} value={up} frac={upFrac} tone="up" />;
          })}
        </tr>
        <tr className="border-t border-gray-800/60">
          <td className="py-0.5 px-0.5 text-center">
            <Triangle className="mx-auto h-2 w-2 rotate-180 fill-red-400 stroke-red-400 text-red-400" strokeWidth={1.5} />
          </td>
          {SPOT_OB_MOVE_PCT_LEVELS.map((pct) => {
            const { down, downFrac } = impactPair(panel, pct);
            return <ImpactCell key={`down-${pct}`} value={down} frac={downFrac} tone="down" />;
          })}
        </tr>
      </tbody>
    </table>
  );
}

function MarketSection({
  label,
  panels,
  asset,
}: {
  label: string;
  panels: CexObExchangePanels | null | undefined;
  asset: AssetName;
}) {
  if (!panels?.binance && !panels?.okx) return null;
  return (
    <div className="mb-2 last:mb-0">
      <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</div>
      {panels.binance ? (
        <ExchangeTable exchangeLabel="BIN" panel={panels.binance} asset={asset} />
      ) : null}
      {panels.okx ? <ExchangeTable exchangeLabel="OKX" panel={panels.okx} asset={asset} /> : null}
    </div>
  );
}

export function ChartCexObHoverGrid({ snapshot }: { snapshot: CexObCandleSnapshot }) {
  if (!snapshot.spot && !snapshot.futures) return null;
  const asset = snapshot.asset as AssetName;
  return (
    <div className="mt-2 pt-2 border-t border-gray-700">
      <div className="text-[10px] font-bold text-gray-300 mb-1.5">{asset} CEX OB</div>
      <MarketSection label="spot" panels={snapshot.spot} asset={asset} />
      <MarketSection label="futures" panels={snapshot.futures} asset={asset} />
    </div>
  );
}
