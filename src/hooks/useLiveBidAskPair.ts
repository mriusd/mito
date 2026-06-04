import { useCallback, useEffect, useState } from 'react';
import type { Market } from '../types';
import {
  bidAskWsRowEqual,
  getBidAskMarketRow,
  subscribeBidAskMarketLookup,
} from '../lib/bidAskMarketLookup';
import type { ThrottledBidAskPair } from './useThrottledBidAskPair';

function readPair(yesTokenId: string, noTokenId: string): ThrottledBidAskPair {
  return {
    yes: yesTokenId ? getBidAskMarketRow(yesTokenId) : undefined,
    no: noTokenId ? getBidAskMarketRow(noTokenId) : undefined,
  };
}

function pairEqual(a: ThrottledBidAskPair, b: ThrottledBidAskPair): boolean {
  const yA = a.yes;
  const yB = b.yes;
  const nA = a.no;
  const nB = b.no;
  if (yA === yB && nA === nB) return true;
  if (yA && yB && bidAskWsRowEqual(yA, yB) && (!nA && !nB || (nA && nB && bidAskWsRowEqual(nA, nB)))) return true;
  if (!yA && !yB && nA && nB && bidAskWsRowEqual(nA, nB)) return true;
  return false;
}

/** Live WS yes/no pair — re-renders only when these two token rows change (not whole batch). */
export function useLiveBidAskPair(yesTokenId: string, noTokenId: string): ThrottledBidAskPair {
  const read = useCallback(() => readPair(yesTokenId, noTokenId), [yesTokenId, noTokenId]);
  const [pair, setPair] = useState(read);

  useEffect(() => {
    const flush = () => {
      setPair((prev) => {
        const next = read();
        return pairEqual(prev, next) ? prev : next;
      });
    };
    const unsub = subscribeBidAskMarketLookup(flush);
    flush();
    return unsub;
  }, [read]);

  return pair;
}

export function bidAskLookupFromPair(
  yesTokenId: string,
  noTokenId: string,
  pair: ThrottledBidAskPair,
): Record<string, Market> {
  const o: Record<string, Market> = {};
  if (yesTokenId && pair.yes) o[yesTokenId] = pair.yes;
  if (noTokenId && pair.no) o[noTokenId] = pair.no;
  return o;
}
