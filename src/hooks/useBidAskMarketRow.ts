import { useEffect, useState } from 'react';
import type { Market } from '../types';
import {
  bidAskWsRowEqual,
  getBidAskMarketRow,
  subscribeBidAskMarketLookup,
} from '../lib/bidAskMarketLookup';

/** Live WS best bid/ask row — pending patch + live top-of-book; not grid-throttled. */
export function useBidAskMarketRow(tokenId: string): Market | undefined {
  const tid = String(tokenId || '').trim();
  const [row, setRow] = useState<Market | undefined>(() => (tid ? getBidAskMarketRow(tid) : undefined));

  useEffect(() => {
    if (!tid) {
      setRow(undefined);
      return;
    }
    const flush = () => {
      setRow((prev) => {
        const next = getBidAskMarketRow(tid);
        if (prev === next) return prev;
        if (prev && next && bidAskWsRowEqual(prev, next) && prev.bestBid === next.bestBid && prev.bestAsk === next.bestAsk) {
          return prev;
        }
        return next;
      });
    };
    const unsub = subscribeBidAskMarketLookup(flush);
    flush();
    return unsub;
  }, [tid]);

  return row;
}
