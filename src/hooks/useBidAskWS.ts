import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { WS_BASE } from '../lib/env';

export function useBidAskWS() {
  const updateBidAsk = useAppStore((s) => s.updateBidAsk);
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
            const store = useAppStore.getState();
            const lookup = store.marketLookup;
            let changed = false;
            const patch: Record<string, any> = {};
            for (const item of msg.data) {
              if (!item.assetId) continue;
              const entry = lookup[item.assetId];
              if (!entry) continue;
              patch[item.assetId] = { ...entry, bestBid: item.bestBid || 0, bestAsk: item.bestAsk || 0 };
              changed = true;
            }
            if (changed) {
              useAppStore.setState({
                marketLookup: { ...lookup, ...patch },
                bidAskTick: store.bidAskTick + 1,
              });
            }
          }
        } catch {}
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
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [updateBidAsk]);
}
