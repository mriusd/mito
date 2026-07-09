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
  const yes = yesTokenId ? getBidAskMarketRow(yesTokenId) : undefined;
  const no = noTokenId ? getBidAskMarketRow(noTokenId) : undefined;
  const prev = pairSnapshotCache.get(key);
  // Keep same snap object when row refs unchanged — digest bumps must not wake every cell.
  if (prev && prev.snap.yes === yes && prev.snap.no === no) {
    if (prev.digest !== digest) pairSnapshotCache.set(key, { digest, snap: prev.snap });
    return prev.snap;
  }

  const snap: ThrottledBidAskPair = { yes, no };
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
