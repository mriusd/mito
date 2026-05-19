import { useEffect, useRef } from 'react';
import {
  enqueueBidAskMarketPatches,
  resetBidAskMarketLookupPending,
  type BidAskWsItem,
} from '../lib/bidAskMarketLookup';
import { WS_BASE } from '../lib/env';

export { bidAskWsRowEqual } from '../lib/bidAskMarketLookup';

export function useBidAskWS() {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let pingIv: ReturnType<typeof setInterval>;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      const ws = new WebSocket(`${WS_BASE}/ws/chart`);
      wsRef.current = ws;

      ws.onopen = () => {
        pingIv = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'bidAskBatch' && Array.isArray(msg.data)) {
            enqueueBidAskMarketPatches(msg.data as BidAskWsItem[]);
          } else if (msg.type === 'bidAskUpDown' && msg.data && typeof msg.data === 'object') {
            enqueueBidAskMarketPatches([msg.data as BidAskWsItem]);
          }
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        clearInterval(pingIv);
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearInterval(pingIv);
      clearTimeout(reconnectTimeout);
      resetBidAskMarketLookupPending();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);
}
