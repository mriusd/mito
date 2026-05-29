import { memo, useMemo, useState } from 'react';
import { Triangle } from 'lucide-react';
import {
  SPOT_OB_MOVE_PCT_LEVELS,
  binanceSpotBookMid,
  formatSpotObImpactUsd,
  formatSpotObMovePctLabel,
  usdToMoveBinanceSpotDown,
  usdToMoveBinanceSpotUp,
  type BinanceSpotBook,
} from '../../lib/binanceSpotObImpact';
import {
  BINANCE_SPOT_OB_ASSETS,
  binanceObDepthLimit,
  useBinanceObOrderbooks,
  type BinanceObMarket,
  type BinanceSpotObAsset,
} from '../../lib/binanceSpotOrderbookFeed';
import { formatPrice } from '../../utils/format';

const MARKET_LABEL: Record<BinanceObMarket, string> = {
  spot: 'spot',
  futures: 'futures',
};

const AssetRows = memo(function AssetRows({
  asset,
  book,
  connected,
  market,
}: {
  asset: BinanceSpotObAsset;
  book: BinanceSpotBook | null;
  connected: boolean;
  market: BinanceObMarket;
}) {
  const upCells = useMemo(
    () => SPOT_OB_MOVE_PCT_LEVELS.map((move) => usdToMoveBinanceSpotUp(book, move)),
    [book],
  );
  const downCells = useMemo(
    () => SPOT_OB_MOVE_PCT_LEVELS.map((move) => usdToMoveBinanceSpotDown(book, move)),
    [book],
  );
  const mkt = MARKET_LABEL[market];
  const mid = binanceSpotBookMid(book);
  const depthLimit = binanceObDepthLimit(market);

  return (
    <>
      <tr className="border-b border-gray-800/80">
        <td rowSpan={2} className="py-1.5 px-2 align-middle border-r border-gray-800">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-bold text-white">{asset}</span>
            <span className="text-[9px] tabular-nums font-medium text-gray-400">
              {mid != null ? formatPrice(mid, asset) : '—'}
            </span>
          </div>
        </td>
        <td className="py-1 px-2 text-center whitespace-nowrap border-r border-gray-800/60">
          <Triangle className="mx-auto h-2.5 w-2.5 fill-green-400 stroke-green-400 text-green-400" strokeWidth={1.5} aria-label="Up" />
        </td>
        {upCells.map((v, i) => {
          const pct = SPOT_OB_MOVE_PCT_LEVELS[i]!;
          const pctLabel = formatSpotObMovePctLabel(pct);
          return (
            <td
              key={`${asset}-up-${pct}`}
              className="py-1 px-2 text-right text-[10px] tabular-nums font-bold text-green-300/95"
              title={
                connected
                  ? v?.depthCapped
                    ? `Book depth exhausted before ~${pctLabel} up (+ = capped at ${depthLimit} levels)`
                    : `USD to lift ${mkt} ~${pctLabel}`
                  : 'Waiting for Binance book'
              }
            >
              {formatSpotObImpactUsd(v)}
            </td>
          );
        })}
      </tr>
      <tr className="border-b border-gray-800">
        <td className="py-1 px-2 text-center whitespace-nowrap border-r border-gray-800/60">
          <Triangle className="mx-auto h-2.5 w-2.5 rotate-180 fill-red-400 stroke-red-400 text-red-400" strokeWidth={1.5} aria-label="Down" />
        </td>
        {downCells.map((v, i) => {
          const pct = SPOT_OB_MOVE_PCT_LEVELS[i]!;
          const pctLabel = formatSpotObMovePctLabel(pct);
          return (
            <td
              key={`${asset}-down-${pct}`}
              className="py-1 px-2 text-right text-[10px] tabular-nums font-bold text-red-300/95"
              title={
                connected
                  ? v?.depthCapped
                    ? `Book depth exhausted before ~${pctLabel} down (+ = capped at ${depthLimit} levels)`
                    : `USD to hit ${mkt} ~${pctLabel}`
                  : 'Waiting for Binance book'
              }
            >
              {formatSpotObImpactUsd(v)}
            </td>
          );
        })}
      </tr>
    </>
  );
});

function readStoredMarket(panelId: string): BinanceObMarket {
  const saved = localStorage.getItem(`polybot-spot-ob-market-${panelId}`);
  return saved === 'futures' ? 'futures' : 'spot';
}

export function SpotOrderbookPanel({ panelId }: { panelId: string }) {
  const [market, setMarket] = useState<BinanceObMarket>(() => readStoredMarket(panelId));
  const books = useBinanceObOrderbooks(market);
  const connected = BINANCE_SPOT_OB_ASSETS.some((a) => books[a] != null);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-900/40 p-2">
      <div className="panel-header mb-2 flex items-center justify-between gap-2 shrink-0 cursor-grab">
        <div className="text-[11px] font-bold text-yellow-400">Orderbook</div>
        <div className="flex items-center gap-2 no-drag" onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex shrink-0 overflow-hidden rounded border border-gray-600">
            <button
              type="button"
              className={`px-2 py-0.5 text-[9px] font-semibold ${market === 'spot' ? 'bg-cyan-900/75 text-cyan-200' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}
              onClick={() => {
                setMarket('spot');
                localStorage.setItem(`polybot-spot-ob-market-${panelId}`, 'spot');
              }}
            >
              Spot
            </button>
            <button
              type="button"
              className={`border-l border-gray-600 px-2 py-0.5 text-[9px] font-semibold ${market === 'futures' ? 'bg-cyan-900/75 text-cyan-200' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}
              onClick={() => {
                setMarket('futures');
                localStorage.setItem(`polybot-spot-ob-market-${panelId}`, 'futures');
              }}
            >
              Futures
            </button>
          </div>
          <div className={`text-[9px] tabular-nums ${connected ? 'text-emerald-400' : 'text-gray-500'}`}>
            {connected ? `Binance ${MARKET_LABEL[market]} live` : 'Connecting…'}
          </div>
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
              <AssetRows key={asset} asset={asset} book={books[asset]} connected={connected} market={market} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
