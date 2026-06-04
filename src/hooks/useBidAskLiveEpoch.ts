import { useEffect, useState } from 'react';
import { subscribeBidAskMarketLookup } from '../lib/bidAskMarketLookup';

/** Bumps on each WS bid/ask patch (unthrottled; not marketLookupEpoch store flush). */
export function useBidAskLiveEpoch(): number {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => subscribeBidAskMarketLookup(() => setEpoch((n) => n + 1)), []);
  return epoch;
}
