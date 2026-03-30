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

/**
 * NO-token price in [0,1] from the NO book, or synthetic (1 − p_YES) when NO book has no quote.
 */
export function noTokenQuoteProb(
  noTokenId: string | undefined,
  yesTokenId: string | undefined,
  lookup: Record<string, Market>,
  gammaYes?: { bestBid?: number; bestAsk?: number }
): number | null {
  const fromNo = outcomeMidOrOneSideProb(noTokenId, lookup, undefined);
  if (fromNo != null) return fromNo;
  const yesP = outcomeMidOrOneSideProb(yesTokenId, lookup, gammaYes);
  if (yesP == null) return null;
  return 1 - yesP;
}

/**
 * Grid NO column: implied probability in cents (0–100) as seen from the orderbook —
 * `100 × (1 − p_NO)` where `p_NO` is the NO-token mid / one-sided quote, or synthetic from YES when NO is empty.
 * Matches “YES bid 99.8¢, NO thin” → **99.8** not 0.2.
 */
export function impliedNoQuoteDisplayCents(
  noTokenId: string | undefined,
  yesTokenId: string | undefined,
  lookup: Record<string, Market>,
  gammaYes?: { bestBid?: number; bestAsk?: number }
): number | null {
  const pNo = noTokenQuoteProb(noTokenId, yesTokenId, lookup, gammaYes);
  if (pNo == null) return null;
  return (1 - pNo) * 100;
}
