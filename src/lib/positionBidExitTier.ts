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
