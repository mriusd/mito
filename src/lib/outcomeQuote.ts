import type { Market } from '../types';

/** Treat non-positive values as “no level” (WS uses 0 when missing). */
function hasQuoteSide(p: number | undefined): p is number {
  return p != null && Number.isFinite(p) && p > 0;
}

function pickSide(liveSide: number | undefined, gammaSide: number | undefined): number | undefined {
  // Important: WS uses `0` to mean "no quote". In that case we must *not* fall back to Gamma,
  // otherwise the UI can look stale after background WS updates.
  // We only fall back to Gamma when the WS field is truly `undefined` (never populated).
  if (liveSide == null) {
    return hasQuoteSide(gammaSide) ? gammaSide : undefined;
  }
  return hasQuoteSide(liveSide) ? liveSide : undefined;
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
 * NO outcome best bid/ask: live NO token when quoted; else complete-market implied from YES
 * (noBid ≈ 1 − yesAsk, noAsk ≈ 1 − yesBid) with same WS vs Gamma rules as `outcomeMidOrOneSideProb`.
 */
export function noOutcomeBidAsk(
  yesTokenId: string | undefined,
  noTokenId: string | undefined,
  lookup: Record<string, Market>,
  gammaYes?: { bestBid?: number; bestAsk?: number }
): { bestBid?: number; bestAsk?: number } {
  const yesLive = yesTokenId ? lookup[yesTokenId] : undefined;
  const yesBid = pickSide(yesLive?.bestBid, gammaYes?.bestBid);
  const yesAsk = pickSide(yesLive?.bestAsk, gammaYes?.bestAsk);
  const impliedNoBid = hasQuoteSide(yesAsk) ? 1 - yesAsk! : undefined;
  const impliedNoAsk = hasQuoteSide(yesBid) ? 1 - yesBid! : undefined;

  const noLive = noTokenId ? lookup[noTokenId] : undefined;
  const noBid = pickSide(noLive?.bestBid, impliedNoBid);
  const noAsk = pickSide(noLive?.bestAsk, impliedNoAsk);
  return { bestBid: noBid, bestAsk: noAsk };
}

/**
 * Approximate NO-token best bid from YES Gamma book when NO token not quoted (complete-market bound: 1 − yesAsk).
 */
export function gammaImpliedNoBestBid(gammaYesBook: { bestAsk?: number }): { bestBid: number } | undefined {
  const ba = gammaYesBook.bestAsk;
  if (!hasQuoteSide(ba)) return undefined;
  const implied = 1 - ba!;
  return hasQuoteSide(implied) ? { bestBid: implied } : undefined;
}

/** Best bid on outcome token as implied probability [0,1]; live book + optional Gamma fallback (same pick rules as mid). */
export function outcomeBestBidProb(
  tokenId: string | undefined,
  lookup: Record<string, Market>,
  gammaFallback?: { bestBid?: number; bestAsk?: number }
): number | null {
  const live = tokenId ? lookup[tokenId] : null;
  const bb = pickSide(live?.bestBid, gammaFallback?.bestBid);
  if (hasQuoteSide(bb)) return bb!;
  return null;
}

/** TPO exit: best bid only — 0 when no bids (never ask/mid). */
export function positionExitBidProb(
  tokenId: string | undefined,
  lookup: Record<string, Market>,
): number {
  const tid = String(tokenId || '').trim();
  if (!tid) return 0;

  const live = lookup[tid];
  const gamma = live ? { bestBid: live.bestBid, bestAsk: live.bestAsk } : undefined;
  const direct = outcomeBestBidProb(tid, lookup, gamma);
  if (direct != null) return direct;

  for (const row of Object.values(lookup)) {
    const ids = row.clobTokenIds || [];
    if (ids[0] === tid) {
      const bb = outcomeBestBidProb(tid, lookup, { bestBid: row.bestBid, bestAsk: row.bestAsk });
      return bb != null ? bb : 0;
    }
    if (ids[1] === tid) {
      const noBook = noOutcomeBidAsk(ids[0], tid, lookup, {
        bestBid: row.bestBid,
        bestAsk: row.bestAsk,
      });
      const bb = noBook.bestBid;
      return bb != null && bb > 0 ? bb : 0;
    }
  }

  return 0;
}
