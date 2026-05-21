export function isMarketExpired(
  market: { closed?: boolean; endDate?: string } | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!market) return false;
  if (market.closed) return true;
  const endDate = String(market.endDate || '').trim();
  if (!endDate) return false;
  const endMs = new Date(endDate).getTime();
  return Number.isFinite(endMs) && endMs <= nowMs;
}
