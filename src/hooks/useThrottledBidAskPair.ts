import { useCallback, useEffect, useState } from 'react';
import type { Market } from '../types';
import {
  bidAskWsRowEqual,
  getBidAskMarketRow,
  GRID_BID_ASK_THROTTLE_MS,
  subscribeBidAskMarketLookup,
} from '../lib/bidAskMarketLookup';

export type ThrottledBidAskPair = { yes?: Market; no?: Market };

/** Grid cell WS rows — pending patch + 2s throttle; no zustand `marketLookup` subscription. */
export function useThrottledBidAskPair(
  yesTokenId: string,
  noTokenId: string,
  ms = GRID_BID_ASK_THROTTLE_MS,
): ThrottledBidAskPair {
  const readPair = useCallback((): ThrottledBidAskPair => {
    const o: ThrottledBidAskPair = {};
    if (yesTokenId) o.yes = getBidAskMarketRow(yesTokenId);
    if (noTokenId) o.no = getBidAskMarketRow(noTokenId);
    return o;
  }, [yesTokenId, noTokenId]);

  const [pair, setPair] = useState<ThrottledBidAskPair>(readPair);

  useEffect(() => {
    let latest = readPair();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      setPair((prev) => {
        const next = latest;
        if (prev.yes === next.yes && prev.no === next.no) return prev;
        if (bidAskWsRowEqual(prev.yes, next.yes) && bidAskWsRowEqual(prev.no, next.no)) return prev;
        return next;
      });
    };

    const schedule = () => {
      latest = readPair();
      if (timer != null) return;
      timer = setTimeout(flush, ms);
    };

    const unsub = subscribeBidAskMarketLookup(schedule);
    schedule();

    return () => {
      unsub();
      if (timer != null) clearTimeout(timer);
    };
  }, [readPair, ms]);

  return pair;
}
