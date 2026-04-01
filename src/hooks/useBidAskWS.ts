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
          const applyUpdates = (items: any[]) => {
            const store = useAppStore.getState();
            const lookup = store.marketLookup;
            let changed = false;
            const patch: Record<string, any> = {};
            for (const item of items) {
              if (!item.assetId) continue;
              const entry = lookup[item.assetId];
              // WS batches always include numeric bid/ask; when a side is missing it will be 0.
              // Even if the token is not present in marketLookup yet, we still patch bestBid/bestAsk
              // so quote helpers don't keep falling back to older values.
              const bestBid = item.bestBid ?? 0;
              const bestAsk = item.bestAsk ?? 0;
              const next = entry
                ? {
                    ...entry,
                    bestBid,
                    bestAsk,
                  }
                : ({
                    id: item.assetId,
                    clobTokenIds: [item.assetId],
                    bestBid,
                    bestAsk,
                  } as any);
              const v = (item.usdcVolume ?? item.volume);
              if (typeof v === 'number' && Number.isFinite(v)) {
                next.volume = v;
              }
              if (typeof item.sharesInExistence === 'number' && Number.isFinite(item.sharesInExistence)) {
                next.sharesInExistence = item.sharesInExistence;
              }
              if (typeof item.marketNetDirection === 'number' && Number.isFinite(item.marketNetDirection)) {
                next.marketNetDirection = item.marketNetDirection;
              }
              if (typeof item.holders === 'number' && Number.isFinite(item.holders)) {
                next.holders = item.holders;
              }
              if (typeof item.smartMoneyBias === 'number' && Number.isFinite(item.smartMoneyBias)) {
                next.smartMoneyBias = item.smartMoneyBias;
              }
              if (typeof item.provenSMS === 'number' && Number.isFinite(item.provenSMS)) {
                next.provenSMS = item.provenSMS;
              }
              if (typeof item.crowdBias === 'number' && Number.isFinite(item.crowdBias)) {
                next.crowdBias = item.crowdBias;
              }
              if (typeof item.liveBias === 'number' && Number.isFinite(item.liveBias)) {
                next.liveBias = item.liveBias;
              }
              if (typeof item.liveBiasWindowMin === 'number' && item.liveBiasWindowMin > 0) {
                next.liveBiasWindowMin = item.liveBiasWindowMin;
              }
              if (typeof item.concentration === 'number' && Number.isFinite(item.concentration)) {
                next.concentration = item.concentration;
              }
              patch[item.assetId] = next;
              changed = true;
            }
            if (changed) {
              useAppStore.setState({
                marketLookup: { ...lookup, ...patch },
                bidAskTick: store.bidAskTick + 1,
              });
            }
          };

          if (msg.type === 'bidAskBatch' && Array.isArray(msg.data)) {
            applyUpdates(msg.data);
          } else if (msg.type === 'bidAskUpDown' && msg.data && typeof msg.data === 'object') {
            applyUpdates([msg.data]);
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
