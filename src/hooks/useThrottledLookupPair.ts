import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';
import { bidAskWsRowEqual, GRID_BID_ASK_THROTTLE_MS } from '../lib/bidAskMarketLookup';

export type LookupPair = { yes?: Market; no?: Market };

/** Per-cell WS row slice at most every `ms` — was 4 Hz × every GridMarketCell. */
export function useThrottledLookupPair(
  yesTokenId: string,
  noTokenId: string,
  ms = GRID_BID_ASK_THROTTLE_MS,
): LookupPair {
  const live = useAppStore(
    useShallow((s): LookupPair => {
      const o: LookupPair = {};
      if (yesTokenId) o.yes = s.marketLookup[yesTokenId];
      if (noTokenId) o.no = s.marketLookup[noTokenId];
      return o;
    }),
  );

  const [pair, setPair] = useState<LookupPair>(live);

  useEffect(() => {
    let latest = live;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      setPair((prev) => {
        const py = prev.yes;
        const ly = latest.yes;
        const pn = prev.no;
        const ln = latest.no;
        if (py === ly && pn === ln) return prev;
        if (py && ly && bidAskWsRowEqual(py, ly) && bidAskWsRowEqual(pn, ln)) return prev;
        return latest;
      });
    };

    const schedule = () => {
      if (timer != null) return;
      timer = setTimeout(flush, ms);
    };

    latest = live;
    schedule();

    return () => {
      if (timer != null) clearTimeout(timer);
    };
  }, [live, ms]);

  return pair;
}
