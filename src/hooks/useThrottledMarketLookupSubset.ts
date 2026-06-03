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

function subsetSnapEqual(a: Record<string, Market>, b: Record<string, Market>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of keys) {
    if (a[id] === b[id]) continue;
    return false;
  }
  return true;
}

function getGridMarketLookupSubsetSnapshot(idsKey: string, ids: readonly string[]): Record<string, Market> {
  const digest = getBidAskGridFlushDigest();
  const snap = readSubset(ids);
  const prev = subsetSnapshotCache.get(idsKey);
  if (prev && prev.digest === digest && subsetSnapEqual(prev.snap, snap)) return prev.snap;

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
