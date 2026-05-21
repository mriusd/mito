import { getBidAskMarketRow } from './bidAskMarketLookup';

export const SIDEBAR_NOTIFY_SOUND_MAX_PRICE_CENTS_KEY = 'polybot-sidebar-notify-sound-max-price-cents';

export function readNotifySoundMaxPriceCents(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_SOUND_MAX_PRICE_CENTS_KEY);
    const n = parseFloat(raw ?? '95');
    if (!Number.isFinite(n)) return 95;
    return Math.min(99, Math.max(1, Math.round(n)));
  } catch {
    return 95;
  }
}

/** WS mid in cents: (bestBid+bestAsk)/2, or bestBid only if no ask. */
export function wsQuoteMidCents(tokenId: string | undefined | null): number | null {
  const tid = String(tokenId || '').trim();
  if (!tid) return null;
  const row = getBidAskMarketRow(tid);
  if (!row) return null;
  const b =
    typeof row.bestBid === 'number' && Number.isFinite(row.bestBid) ? row.bestBid * 100 : null;
  const a =
    typeof row.bestAsk === 'number' && Number.isFinite(row.bestAsk) ? row.bestAsk * 100 : null;
  if (b != null && a != null) return (b + a) / 2;
  if (b != null) return b;
  return null;
}

/** True when YES or NO WS quote exceeds max cents — mutes all notification sounds. */
export function isNotifySoundPriceMuted(
  yesTokenId: string | undefined | null,
  noTokenId: string | undefined | null,
  maxCents: number = readNotifySoundMaxPriceCents(),
): boolean {
  const yesCents = wsQuoteMidCents(yesTokenId);
  const noCents = wsQuoteMidCents(noTokenId);
  if (yesCents != null && yesCents > maxCents) return true;
  if (noCents != null && noCents > maxCents) return true;
  return false;
}
