import { useEffect } from 'react';
import {
  enqueueBidAskMarketPatches,
  type BidAskWsItem,
} from '../lib/bidAskMarketLookup';
import { subscribeChartBidAsk } from '../lib/chartWsShared';

export { bidAskWsRowEqual } from '../lib/bidAskMarketLookup';

export function useBidAskWS() {
  useEffect(() => {
    const unsub = subscribeChartBidAsk((msg) => {
      if (msg.type === 'bidAskBatch' && Array.isArray(msg.data)) {
        enqueueBidAskMarketPatches(msg.data as unknown as BidAskWsItem[]);
      } else if (msg.type === 'bidAskUpDown' && msg.data && typeof msg.data === 'object') {
        enqueueBidAskMarketPatches([msg.data as unknown as BidAskWsItem]);
      }
    });

    return () => {
      unsub();
      // Do NOT clear liveTopOfBook / pending here — a host remount would wipe live
      // quotes and look like "stale until full reload". Only drop the WS subscription.
    };
  }, []);
}
