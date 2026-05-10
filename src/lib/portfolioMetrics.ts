import type { Position } from '../types';

/** Data API `currentValue` when present, else size × curPrice. */
export function portfolioPositionsValueUsd(positions: readonly Position[]): number {
  let sum = 0;
  for (const p of positions) {
    if (p.currentValue != null && Number.isFinite(p.currentValue)) {
      sum += p.currentValue;
      continue;
    }
    const size = p.size || 0;
    const price = p.curPrice || 0;
    sum += size * price;
  }
  return sum;
}
