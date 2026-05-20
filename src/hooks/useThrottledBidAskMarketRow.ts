import { useEffect, useState } from 'react';
import type { Market } from '../types';
import {
  bidAskWsRowEqual,
  getBidAskMarketRow,
  GRID_BID_ASK_THROTTLE_MS,
  subscribeBidAskMarketLookup,
} from '../lib/bidAskMarketLookup';

/** WS market row at most every `ms` — grid stats; live bid/ask uses `useBidAskMarketRow`. */
export function useThrottledBidAskMarketRow(
  tokenId: string,
  ms = GRID_BID_ASK_THROTTLE_MS,
): Market | undefined {
  const tid = String(tokenId || '').trim();

  const readRow = () => (tid ? getBidAskMarketRow(tid) : undefined);

  const [row, setRow] = useState<Market | undefined>(readRow);

  useEffect(() => {
    if (!tid) {
      setRow(undefined);
      return;
    }

    let latest = readRow();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      setRow((prev) => {
        const next = latest;
        if (prev === next) return prev;
        if (prev && next && bidAskWsRowEqual(prev, next)) return prev;
        return next;
      });
    };

    const schedule = () => {
      if (timer != null) return;
      timer = setTimeout(flush, ms);
    };

    const unsub = subscribeBidAskMarketLookup(() => {
      latest = readRow();
      schedule();
    });

    latest = readRow();
    schedule();

    return () => {
      unsub();
      if (timer != null) clearTimeout(timer);
    };
  }, [tid, ms]);

  return row;
}
