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
  return useBidAskLookupSubset(tokenIds, 0);
}

/** Bid/ask subset; `ms > 0` coalesces WS patches (TPO / heavy panels). */
export function useThrottledBidAskLookupSubset(
  tokenIds: readonly string[],
  ms = 500,
): Record<string, Market> {
  return useBidAskLookupSubset(tokenIds, ms);
}

function useBidAskLookupSubset(tokenIds: readonly string[], ms: number): Record<string, Market> {
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
    let timer: ReturnType<typeof setTimeout> | null = null;

    const apply = () => {
      timer = null;
      setSubset((prev) => {
        const latest = readSubset();
        return subsetEqual(prev, latest) ? prev : latest;
      });
    };

    const onPatch = () => {
      if (ms <= 0) {
        apply();
        return;
      }
      if (timer != null) return;
      timer = setTimeout(apply, ms);
    };

    const unsub = subscribeBidAskMarketLookup(onPatch);
    apply();
    return () => {
      unsub();
      if (timer != null) clearTimeout(timer);
    };
  }, [readSubset, ms]);

  return subset;
}
