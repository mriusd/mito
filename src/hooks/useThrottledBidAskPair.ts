import { useSyncExternalStore } from 'react';
import type { Market } from '../types';
import {
  getBidAskMarketRow,
  getBidAskGridFlushDigest,
  subscribeBidAskMarketLookupGridFlush,
} from '../lib/bidAskMarketLookup';

export type ThrottledBidAskPair = { yes?: Market; no?: Market };

type PairCacheEntry = { digest: number; snap: ThrottledBidAskPair };
const pairSnapshotCache = new Map<string, PairCacheEntry>();

function gridPairCacheKey(yesTokenId: string, noTokenId: string): string {
  return `${yesTokenId}\x00${noTokenId}`;
}

export function getGridBidAskPairSnapshot(yesTokenId: string, noTokenId: string): ThrottledBidAskPair {
  const digest = getBidAskGridFlushDigest();
  const key = gridPairCacheKey(yesTokenId, noTokenId);
  const prev = pairSnapshotCache.get(key);
  if (prev && prev.digest === digest) return prev.snap;

  const snap: ThrottledBidAskPair = {
    yes: yesTokenId ? getBidAskMarketRow(yesTokenId) : undefined,
    no: noTokenId ? getBidAskMarketRow(noTokenId) : undefined,
  };
  pairSnapshotCache.set(key, { digest, snap });
  return snap;
}

/** Grid cell WS rows — 2s store flush; snapshot tied to flush digest for useSyncExternalStore. */
export function useThrottledBidAskPair(yesTokenId: string, noTokenId: string): ThrottledBidAskPair {
  return useSyncExternalStore(
    subscribeBidAskMarketLookupGridFlush,
    () => getGridBidAskPairSnapshot(yesTokenId, noTokenId),
    () => getGridBidAskPairSnapshot(yesTokenId, noTokenId),
  );
}
