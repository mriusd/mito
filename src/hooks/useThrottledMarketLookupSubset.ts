import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Market } from '../types';
import {
  getBidAskMarketRow,
  getBidAskGridFlushDigest,
  subscribeBidAskMarketLookupGridFlush,
} from '../lib/bidAskMarketLookup';

function readSubset(ids: readonly string[]): Record<string, Market> {
  const out: Record<string, Market> = {};
  for (const id of ids) {
    const row = getBidAskMarketRow(id);
    if (row) out[id] = row;
  }
  return out;
}

type SubsetCacheEntry = { digest: number; snap: Record<string, Market> };
const subsetSnapshotCache = new Map<string, SubsetCacheEntry>();

function getGridMarketLookupSubsetSnapshot(idsKey: string, ids: readonly string[]): Record<string, Market> {
  const digest = getBidAskGridFlushDigest();
  const prev = subsetSnapshotCache.get(idsKey);
  if (prev && prev.digest === digest) return prev.snap;

  const snap = readSubset(ids);
  subsetSnapshotCache.set(idsKey, { digest, snap });
  return snap;
}

/** Grid subset on 2s store flush — snapshot tied to flush digest. */
export function useThrottledMarketLookupSubset(tokenIds: readonly string[]): Record<string, Market> {
  const idsKey = tokenIds.join('\0');
  const ids = useMemo(() => tokenIds.filter(Boolean), [idsKey]);

  const getSnapshot = useCallback(
    () => getGridMarketLookupSubsetSnapshot(idsKey, ids),
    [idsKey, ids],
  );

  return useSyncExternalStore(subscribeBidAskMarketLookupGridFlush, getSnapshot, getSnapshot);
}
