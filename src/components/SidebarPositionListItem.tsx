import { memo } from 'react';
import { useBidAskMarketRow } from '../hooks/useBidAskMarketRow';

export type SidebarPositionListItemProps = {
  tokenId: string;
  size: number;
  avg: number;
  outcomeLabel: string;
  outcomeColor: string;
  isMarketExpired: boolean;
  closing: boolean;
  onSetOrderAmount: (amount: string) => void;
  onClose: () => void;
};

export const SidebarPositionListItem = memo(function SidebarPositionListItem({
  tokenId,
  size,
  avg,
  outcomeLabel,
  outcomeColor,
  isMarketExpired,
  closing,
  onSetOrderAmount,
  onClose,
}: SidebarPositionListItemProps) {
  const wsRow = useBidAskMarketRow(tokenId);
  const tokenBestBid = wsRow?.bestBid;
  const currentPrice =
    typeof tokenBestBid === 'number' && Number.isFinite(tokenBestBid) && tokenBestBid > 0
      ? tokenBestBid
      : 0;
  const cost = size * avg;
  const currentValue = size * currentPrice;
  const pnl = currentValue - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const pnlColor = pnl >= 0 ? 'text-green-400' : 'text-red-400';
  const pnlSign = pnl >= 0 ? '+' : '';

  return (
    <div className="bg-gray-700/30 rounded px-1.5 py-0.5 text-[12px] min-w-0">
      <div className="flex justify-between items-start gap-1">
        <div
          className="min-w-0 flex-1 text-gray-300 leading-tight break-words"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          <span className={`${outcomeColor} font-medium`}>{outcomeLabel}</span>
          <span
            className="cursor-pointer hover:underline"
            onClick={() => onSetOrderAmount((Math.floor(size * 100) / 100).toString())}
            title="Net contracts held for this outcome (after sells; fills may report slightly different share amounts vs order size due to fees/rounding). Click to use as order amount."
          >
            {' '}
            {Math.floor(size * 100) / 100}
          </span>
          <span className="text-gray-500"> @ </span>
          <span className="text-yellow-400">{(avg * 100).toFixed(1)}¢</span>
          <span className="text-gray-400">
            {' '}
            ${currentValue.toFixed(2)}\${cost.toFixed(2)}
          </span>
        </div>
        {!isMarketExpired && (
          <button
            type="button"
            onClick={() => !closing && onClose()}
            disabled={closing}
            className="w-4 h-4 shrink-0 rounded-sm flex items-center justify-center bg-red-600 hover:bg-red-500 disabled:bg-red-600/50"
            title="Market sell entire position (FAK)"
          >
            {closing ? <span className="cancel-spinner" /> : <span className="text-black text-[10px] font-bold leading-none">✕</span>}
          </button>
        )}
      </div>
      <div className={`${pnlColor} w-full leading-tight`}>
        {pnlSign}${Math.abs(Math.round(pnl))} ({pnlSign}
        {Math.round(pnlPct)}%)
      </div>
    </div>
  );
});
