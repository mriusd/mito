import { useSyncExternalStore } from 'react';
import type { Market } from '../types';
import {
  bidAskWsRowEqual,
  getBidAskMarketRow,
  getBidAskGridFlushDigest,
  subscribeBidAskMarketLookupGridFlush,
} from '../lib/bidAskMarketLookup';

export type ThrottledBidAskPair = { yes?: Market; no?: Market };

const pairSnapshotCache = new Map<string, ThrottledBidAskPair>();

function gridPairCacheKey(yesTokenId: string, noTokenId: string): string {
  return `${yesTokenId}\x00${noTokenId}`;
}

export function getGridBidAskPairSnapshot(yesTokenId: string, noTokenId: string): ThrottledBidAskPair {
  getBidAskGridFlushDigest();
  const key = gridPairCacheKey(yesTokenId, noTokenId);
  const yes = yesTokenId ? getBidAskMarketRow(yesTokenId) : undefined;
  const no = noTokenId ? getBidAskMarketRow(noTokenId) : undefined;
  const cached = pairSnapshotCache.get(key);
  if (cached) {
    if (cached.yes === yes && cached.no === no) return cached;
    if (bidAskWsRowEqual(cached.yes, yes) && bidAskWsRowEqual(cached.no, no)) return cached;
  }
  const snap: ThrottledBidAskPair = { yes, no };
  pairSnapshotCache.set(key, snap);
  return snap;
}

/** Grid cell WS rows — 2s store flush only; no per-cell timer on every WS patch. */
export function useThrottledBidAskPair(yesTokenId: string, noTokenId: string): ThrottledBidAskPair {
  return useSyncExternalStore(
    subscribeBidAskMarketLookupGridFlush,
    () => getGridBidAskPairSnapshot(yesTokenId, noTokenId),
    () => getGridBidAskPairSnapshot(yesTokenId, noTokenId),
  );
}
