import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Market } from '../types';
import {
  bidAskWsRowEqual,
  getBidAskMarketRow,
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

/** Unthrottled WS bid/ask subset — pending patch via `getBidAskMarketRow` (notify / flash gates). */
export function useLiveBidAskLookupSubset(tokenIds: readonly string[]): Record<string, Market> {
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
    const flush = () => {
      setSubset((prev) => {
        const latest = readSubset();
        return subsetEqual(prev, latest) ? prev : latest;
      });
    };
    const unsub = subscribeBidAskMarketLookup(flush);
    flush();
    return unsub;
  }, [readSubset]);

  return subset;
}
