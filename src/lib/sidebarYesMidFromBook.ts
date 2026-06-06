import type { SidebarPolymarketBookSnapshot } from '../components/SidebarPolymarketOBHost';

type ObLevel = { price: string; size: string };

function levelPriceCents(level: ObLevel | undefined): number | null {
  if (!level) return null;
  const p = parseFloat(level.price);
  if (!Number.isFinite(p) || p <= 0) return null;
  return Math.min(100, Math.max(0, p * 100));
}

/** Best bid/ask from CLOB arrays (bids desc → [0] is best bid; asks asc → [0] is best ask). */
export function outcomeMidCentsFromSidebarBook(
  bids: ObLevel[],
  asks: ObLevel[],
): number | null {
  const bidCents = bids.length > 0 ? levelPriceCents(bids[0]) : null;
  const askCents = asks.length > 0 ? levelPriceCents(asks[0]) : null;
  if (bidCents != null && askCents != null) return (bidCents + askCents) / 2;
  if (bidCents != null) return bidCents;
  if (askCents != null) return askCents;
  return null;
}

/**
 * Canonical YES mid for prob tilt — same on YES/NO toggle.
 * Prefer 100 − NO book mid when NO leg is quoted; else YES book mid.
 */
export function yesMidCentsFromSidebarBook(
  snap: SidebarPolymarketBookSnapshot | null | undefined,
): number | null {
  if (!snap || snap.obLoading) return null;

  const noMid = outcomeMidCentsFromSidebarBook(snap.noBids ?? [], snap.noAsks ?? []);
  if (noMid != null) return Math.min(100, Math.max(0, 100 - noMid));

  const yesMid = outcomeMidCentsFromSidebarBook(snap.yesBids ?? [], snap.yesAsks ?? []);
  if (yesMid != null) return yesMid;

  const displayMid = outcomeMidCentsFromSidebarBook(snap.displayBids, snap.displayAsks);
  return displayMid;
}
