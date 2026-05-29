import { memo, useMemo } from 'react';
import {
  SPOT_OB_MOVE_PCT_LEVELS,
  formatSpotObMovePctLabel,
  usdToMoveBinanceSpotDown,
  usdToMoveBinanceSpotUp,
  type BinanceSpotBook,
} from '../../lib/binanceSpotObImpact';
import {
  BINANCE_SPOT_OB_ASSETS,
  useBinanceSpotOrderbooks,
  type BinanceSpotObAsset,
} from '../../lib/binanceSpotOrderbookFeed';
import { formatPolymarketVolumeKInteger } from '../../utils/format';

function fmtImpactUsd(v: number | null): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return '—';
  return `$${formatPolymarketVolumeKInteger(v)}`;
}

const AssetRows = memo(function AssetRows({
  asset,
  book,
  connected,
}: {
  asset: BinanceSpotObAsset;
  book: BinanceSpotBook | null;
  connected: boolean;
}) {
  const upCells = useMemo(
    () => SPOT_OB_MOVE_PCT_LEVELS.map((move) => usdToMoveBinanceSpotUp(book, move)),
    [book],
  );
  const downCells = useMemo(
    () => SPOT_OB_MOVE_PCT_LEVELS.map((move) => usdToMoveBinanceSpotDown(book, move)),
    [book],
  );

  return (
    <>
      <tr className="border-b border-gray-800/80">
        <td rowSpan={2} className="py-1.5 px-2 text-[11px] font-bold text-white align-middle border-r border-gray-800">
          {asset}
        </td>
        <td className="py-1 px-2 text-[10px] font-semibold text-green-400 whitespace-nowrap border-r border-gray-800/60">
          UP
        </td>
        {upCells.map((v, i) => {
          const pct = SPOT_OB_MOVE_PCT_LEVELS[i]!;
          const pctLabel = formatSpotObMovePctLabel(pct);
          return (
          <td
            key={`${asset}-up-${pct}`}
            className="py-1 px-2 text-right text-[10px] tabular-nums font-bold text-green-300/95"
            title={connected ? `USD to lift spot ~${pctLabel}` : 'Waiting for Binance book'}
          >
            {fmtImpactUsd(v)}
          </td>
          );
        })}
      </tr>
      <tr className="border-b border-gray-800">
        <td className="py-1 px-2 text-[10px] font-semibold text-red-400 whitespace-nowrap border-r border-gray-800/60">
          DOWN
        </td>
        {downCells.map((v, i) => {
          const pct = SPOT_OB_MOVE_PCT_LEVELS[i]!;
          const pctLabel = formatSpotObMovePctLabel(pct);
          return (
          <td
            key={`${asset}-down-${pct}`}
            className="py-1 px-2 text-right text-[10px] tabular-nums font-bold text-red-300/95"
            title={connected ? `USD to hit spot ~${pctLabel}` : 'Waiting for Binance book'}
          >
            {fmtImpactUsd(v)}
          </td>
          );
        })}
      </tr>
    </>
  );
});

export function SpotOrderbookPanel() {
  const books = useBinanceSpotOrderbooks();
  const connected = BINANCE_SPOT_OB_ASSETS.some((a) => books[a] != null);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-900/40 p-2">
      <div className="panel-header mb-2 flex items-center justify-between gap-2 shrink-0 cursor-grab">
        <div className="text-[11px] font-bold text-yellow-400">Spot Orderbook</div>
        <div className={`text-[9px] tabular-nums ${connected ? 'text-emerald-400' : 'text-gray-500'}`}>
          {connected ? 'Binance live' : 'Connecting…'}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-[1] bg-gray-900">
            <tr className="text-[9px] font-medium text-gray-500 border-b border-gray-700">
              <th className="py-1 px-2 font-medium">Asset</th>
              <th className="py-1 px-2 font-medium">U/D</th>
              {SPOT_OB_MOVE_PCT_LEVELS.map((n) => (
                <th key={n} className="py-1 px-2 text-right font-medium tabular-nums">
                  {formatSpotObMovePctLabel(n)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BINANCE_SPOT_OB_ASSETS.map((asset) => (
              <AssetRows key={asset} asset={asset} book={books[asset]} connected={connected} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
