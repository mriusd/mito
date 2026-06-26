import { effectiveMarketExpiryMs } from './weatherMarketExpiry';

export function isMarketExpired(
  market: { closed?: boolean; endDate?: string; question?: string; eventSlug?: string } | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!market) return false;
  if (market.closed) return true;
  const endMs = effectiveMarketExpiryMs(market);
  return endMs != null && endMs <= nowMs;
}
