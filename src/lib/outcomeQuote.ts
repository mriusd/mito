import type { Market } from '../types';

/** Treat non-positive values as “no level” (WS uses 0 when missing). */
function hasQuoteSide(p: number | undefined): p is number {
  return p != null && Number.isFinite(p) && p > 0;
}

function pickSide(
  liveSide: number | undefined,
  gammaSide: number | undefined
): number | undefined {
  if (hasQuoteSide(liveSide)) return liveSide;
  if (hasQuoteSide(gammaSide)) return gammaSide;
  return undefined;
}

/**
 * Mid (bid+ask)/2 when both sides have a quote; otherwise the sole bid or ask in [0,1].
 * Uses live book per token; falls back to Gamma on a side only when that side is missing from WS (0/empty).
 */
export function outcomeMidOrOneSideProb(
  tokenId: string | undefined,
  lookup: Record<string, Market>,
  gammaFallback?: { bestBid?: number; bestAsk?: number }
): number | null {
  const live = tokenId ? lookup[tokenId] : null;
  const bb = pickSide(live?.bestBid, gammaFallback?.bestBid);
  const ba = pickSide(live?.bestAsk, gammaFallback?.bestAsk);
  const hb = hasQuoteSide(bb);
  const ha = hasQuoteSide(ba);
  if (hb && ha) return (bb! + ba!) / 2;
  if (hb) return bb!;
  if (ha) return ba!;
  return null;
}
