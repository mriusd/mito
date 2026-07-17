export type PositionBidExitTier = 'green' | 'yellow' | 'red';

/** Same thresholds as Bid column in TradesPositionsOrders (exit vs entry %). */
export function positionBidExitTier(entryPriceCents: number, currentBidCents: number): PositionBidExitTier {
  const exitChange =
    entryPriceCents > 0 ? ((currentBidCents - entryPriceCents) / entryPriceCents) * 100 : 0;
  if (exitChange > 20) return 'green';
  if (exitChange < -20) return 'red';
  return 'yellow';
}

export const POSITION_BID_EXIT_TAILWIND: Record<PositionBidExitTier, string> = {
  green: 'text-green-400',
  yellow: 'text-yellow-400',
  red: 'text-red-400',
};

/** TPO Sell column tint 0..1: red (bid=0) → green (bid≥sell). -1 = no sell order. */
export function positionSellPriceTintScore(
  bidCents: number,
  sellCents: number | null | undefined,
): number {
  if (sellCents == null || !Number.isFinite(sellCents) || sellCents <= 0) return -1;
  const bid = Number.isFinite(bidCents) && bidCents > 0 ? bidCents : 0;
  return Math.min(1, Math.max(0, bid / sellCents));
}

/** TPO Sell column: red (bid=0) → yellow → green (bid=sell). */
export function positionSellPriceColorStyle(
  bidCents: number,
  sellCents: number,
): { color: string } {
  const ratio = positionSellPriceTintScore(bidCents, sellCents);
  const hue = (ratio < 0 ? 0 : ratio) * 120;
  return { color: `hsl(${hue}, 75%, 58%)` };
}
