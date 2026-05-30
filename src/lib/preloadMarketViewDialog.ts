let preloadPromise: Promise<unknown> | null = null;

/** Warm MarketViewDialog chunk before click — avoids lazy suspend + stale-chunk reload. */
export function preloadMarketViewDialog(): void {
  if (!preloadPromise) {
    preloadPromise = import('../components/MarketViewDialog');
  }
}
