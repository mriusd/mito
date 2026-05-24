import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Market } from '../types';
import {
  bidAskWsRowEqual,
  getBidAskMarketRow,
  GRID_BID_ASK_THROTTLE_MS,
  subscribeBidAskMarketLookup,
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

/** Grid subset at most every `ms` — WS pending patch only (no zustand flush subscription). */
export function useThrottledMarketLookupSubset(
  tokenIds: readonly string[],
  ms = GRID_BID_ASK_THROTTLE_MS,
): Record<string, Market> {
  const idsKey = tokenIds.join('\0');
  const ids = useMemo(() => tokenIds.filter(Boolean), [idsKey]);

  const readSubset = useCallback((): Record<string, Market> => {
    const out: Record<string, Market> = {};
    for (const id of ids) {
      const row = getBidAskMarketRow(id);
      if (row) out[id] = row;
    }
    return out;
  }, [ids]);

  const [subset, setSubset] = useState(readSubset);

  useEffect(() => {
    let latest = readSubset();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      setSubset((prev) => (subsetEqual(prev, latest) ? prev : latest));
    };

    const schedule = () => {
      latest = readSubset();
      if (timer != null) return;
      timer = setTimeout(flush, ms);
    };

    const unsub = subscribeBidAskMarketLookup(schedule);
    schedule();

    return () => {
      unsub();
      if (timer != null) clearTimeout(timer);
    };
  }, [readSubset, ms]);

  return subset;
}
