import { useSyncExternalStore } from 'react';
import type { Market } from '../types';
import {
  bidAskWsRowEqual,
  getBidAskMarketRow,
  getBidAskGridFlushDigest,
  subscribeBidAskMarketLookupGridFlush,
} from '../lib/bidAskMarketLookup';

const rowSnapshotCache = new Map<string, Market | undefined>();

function getGridBidAskMarketRowSnapshot(tokenId: string): Market | undefined {
  getBidAskGridFlushDigest();
  const tid = String(tokenId || '').trim();
  if (!tid) return undefined;
  const next = getBidAskMarketRow(tid);
  const cached = rowSnapshotCache.get(tid);
  if (cached === next) return cached;
  if (cached && next && bidAskWsRowEqual(cached, next)) return cached;
  rowSnapshotCache.set(tid, next);
  return next;
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
