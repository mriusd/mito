import { useSyncExternalStore } from 'react';
import type { Market } from '../types';
import { getBidAskMarketRow, subscribeBidAskMarketLookup } from '../lib/bidAskMarketLookup';

/** Live WS best bid/ask row — pending patch + store; not throttled to grid flush. */
export function useBidAskMarketRow(tokenId: string): Market | undefined {
  const tid = String(tokenId || '').trim();
  return useSyncExternalStore(
    subscribeBidAskMarketLookup,
    () => (tid ? getBidAskMarketRow(tid) : undefined),
    () => (tid ? getBidAskMarketRow(tid) : undefined),
  );
}
