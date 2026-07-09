import { useSyncExternalStore } from 'react';
import type { Market } from '../types';
import {
  getBidAskMarketRow,
  getBidAskGridFlushDigest,
  subscribeBidAskMarketLookupGridFlush,
} from '../lib/bidAskMarketLookup';

type RowCacheEntry = { digest: number; snap: Market | undefined };
const rowSnapshotCache = new Map<string, RowCacheEntry>();

function getGridBidAskMarketRowSnapshot(tokenId: string): Market | undefined {
  const digest = getBidAskGridFlushDigest();
  const tid = String(tokenId || '').trim();
  if (!tid) return undefined;

  const snap = getBidAskMarketRow(tid);
  const prev = rowSnapshotCache.get(tid);
  if (prev && prev.snap === snap) {
    if (prev.digest !== digest) rowSnapshotCache.set(tid, { digest, snap: prev.snap });
    return prev.snap;
  }

  rowSnapshotCache.set(tid, { digest, snap });
  return snap;
}

/** WS market row on 2s store flush — grid stats; live bid/ask uses `useBidAskMarketRow`. */
export function useThrottledBidAskMarketRow(tokenId: string): Market | undefined {
  const tid = String(tokenId || '').trim();
  return useSyncExternalStore(
    subscribeBidAskMarketLookupGridFlush,
    () => getGridBidAskMarketRowSnapshot(tid),
    () => getGridBidAskMarketRowSnapshot(tid),
  );
}
