import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Market } from '../types';
import {
  bidAskWsRowEqual,
  getBidAskMarketRow,
  getBidAskGridFlushDigest,
  subscribeBidAskMarketLookupGridFlush,
} from '../lib/bidAskMarketLookup';

function subsetEqual(prev: Record<string, Market>, next: Record<string, Market>): boolean {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const id of keys) {
    const p = prev[id];
    const l = next[id];
    if (p === l) continue;
    if (p && l && bidAskWsRowEqual(p, l)) continue;
    return false;
  }
  return true;
}

const subsetSnapshotCache = new Map<string, Record<string, Market>>();

function readSubset(ids: readonly string[]): Record<string, Market> {
  const out: Record<string, Market> = {};
  for (const id of ids) {
    const row = getBidAskMarketRow(id);
    if (row) out[id] = row;
  }
  return out;
}

function getGridMarketLookupSubsetSnapshot(idsKey: string, ids: readonly string[]): Record<string, Market> {
  getBidAskGridFlushDigest();
  const next = readSubset(ids);
  const cached = subsetSnapshotCache.get(idsKey);
  if (cached && subsetEqual(cached, next)) return cached;
  subsetSnapshotCache.set(idsKey, next);
  return next;
}

/** Grid subset on 2s store flush — not on every WS patch. */
export function useThrottledMarketLookupSubset(tokenIds: readonly string[]): Record<string, Market> {
  const idsKey = tokenIds.join('\0');
  const ids = useMemo(() => tokenIds.filter(Boolean), [idsKey]);

  const getSnapshot = useCallback(
    () => getGridMarketLookupSubsetSnapshot(idsKey, ids),
    [idsKey, ids],
  );

  return useSyncExternalStore(subscribeBidAskMarketLookupGridFlush, getSnapshot, getSnapshot);
}
