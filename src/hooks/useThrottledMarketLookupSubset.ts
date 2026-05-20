import { useEffect, useRef, useState } from 'react';
import type { Market } from '../types';
import { bidAskWsRowEqual, GRID_BID_ASK_THROTTLE_MS } from '../lib/bidAskMarketLookup';
import { useMarketLookupSubset } from './useMarketLookupSubset';

/** Grid subset of `marketLookup` at most every `ms` (default 2s grid bid/ask throttle). */
export function useThrottledMarketLookupSubset(
  tokenIds: readonly string[],
  ms = GRID_BID_ASK_THROTTLE_MS,
): Record<string, Market> {
  const live = useMarketLookupSubset(tokenIds);
  const [subset, setSubset] = useState(live);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const latest = liveRef.current;
      setSubset((prev) => {
        const keys = new Set([...Object.keys(prev), ...Object.keys(latest)]);
        let same = true;
        for (const id of keys) {
          const p = prev[id];
          const l = latest[id];
          if (p === l) continue;
          if (p && l && bidAskWsRowEqual(p, l)) continue;
          same = false;
          break;
        }
        return same ? prev : latest;
      });
    };

    const schedule = () => {
      if (timer != null) return;
      timer = setTimeout(flush, ms);
    };

    schedule();

    return () => {
      if (timer != null) clearTimeout(timer);
    };
  }, [live, ms]);

  return subset;
}
