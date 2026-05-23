import { memo } from 'react';
import { useBidAskMarketRow } from '../hooks/useBidAskMarketRow';

/** Limit sell @ ¢ — left/right of BS math (M) pill. */
const SIDEBAR_POSITION_LIMIT_SELL_CENTS_LEFT = [15, 25, 35, 45] as const;
const SIDEBAR_POSITION_LIMIT_SELL_CENTS_RIGHT = [55, 65, 75, 85, 95] as const;
const SIDEBAR_POSITION_LIMIT_SELL_RED_COUNT =
  SIDEBAR_POSITION_LIMIT_SELL_CENTS_LEFT.length + SIDEBAR_POSITION_LIMIT_SELL_CENTS_RIGHT.length;

const SIDEBAR_BS_MATH_BTN_CLASS =
  'bg-yellow-900/55 hover:bg-yellow-800/65 text-amber-200 disabled:pointer-events-none disabled:opacity-40';

function sidebarPositionSellBg(i: number, n: number): string {
  const t = n <= 1 ? 0 : i / (n - 1);
  const lStart = 28;
  const lEnd = 10;
  const l = lStart - t * (lStart - lEnd);
  return `hsl(351 78% ${l}%)`;
}

function bsMathButtonLabel(cents: number | null | undefined): string {
  return cents == null || !Number.isFinite(cents) ? 'M' : `${Math.round(cents)}c`;
}

export type SidebarPositionListItemProps = {
  tokenId: string;
  size: number;
  avg: number;
  outcomeLabel: string;
  outcomeColor: string;
  isMarketExpired: boolean;
  closing: boolean;
  limitSelling: boolean;
  /** BS math limit price (¢) for this position's outcome; null when unavailable. */
  bsMathCents: number | null;
  onSetOrderAmount: (amount: string) => void;
  onClosePosition: () => void;
  onLimitSellAtPrice: (priceCents: number) => void;
};

export const SidebarPositionListItem = memo(function SidebarPositionListItem({
  tokenId,
  size,
  avg,
  outcomeLabel,
  outcomeColor,
  isMarketExpired,
  closing,
  limitSelling,
  bsMathCents,
  onSetOrderAmount,
  onClosePosition,
  onLimitSellAtPrice,
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
  const shareSize = Math.floor(size * 100) / 100;
  const orderBusy = closing || limitSelling;
  const bsDisabled = orderBusy || shareSize <= 0 || bsMathCents == null;

  const renderLimitSellCents = (cents: number, redIndex: number) => {
    const disabled = orderBusy || shareSize <= 0;
    return (
      <button
        key={cents}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && onLimitSellAtPrice(cents)}
        style={{ backgroundColor: sidebarPositionSellBg(redIndex, SIDEBAR_POSITION_LIMIT_SELL_RED_COUNT) }}
        className="h-5 rounded text-[8px] font-bold tabular-nums text-white disabled:opacity-35 disabled:cursor-not-allowed"
        title={`Limit sell ${shareSize} @ ${cents}¢`}
      >
        {cents}c
      </button>
    );
  };

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
            onClick={() => onSetOrderAmount(shareSize.toString())}
            title="Net contracts held for this outcome (after sells; fills may report slightly different share amounts vs order size due to fees/rounding). Click to use as order amount."
          >
            {' '}
            {shareSize}
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
            onClick={() => !closing && onClosePosition()}
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
      {!isMarketExpired ? (
        <div className="mt-1 grid grid-cols-10 gap-[2px]">
          {SIDEBAR_POSITION_LIMIT_SELL_CENTS_LEFT.map((cents, i) => renderLimitSellCents(cents, i))}
          <button
            type="button"
            disabled={bsDisabled}
            onClick={() => bsMathCents != null && onLimitSellAtPrice(bsMathCents)}
            className={`h-5 rounded text-[8px] font-bold tabular-nums ${SIDEBAR_BS_MATH_BTN_CLASS}`}
            title={
              bsMathCents != null
                ? `Limit sell ${shareSize} @ ${Math.round(bsMathCents)}¢ (BS math)`
                : 'BS math probability unavailable'
            }
            aria-label="Limit sell at BS math probability for this outcome"
          >
            {bsMathButtonLabel(bsMathCents)}
          </button>
          {SIDEBAR_POSITION_LIMIT_SELL_CENTS_RIGHT.map((cents, i) =>
            renderLimitSellCents(cents, SIDEBAR_POSITION_LIMIT_SELL_CENTS_LEFT.length + i),
          )}
        </div>
      ) : null}
    </div>
  );
});
