import { useEffect, useRef, useState } from 'react';
import { fetchToxicFlow, type ToxicFlowData } from '../api';
import { toxicFlowPayloadEqual, coalesceToxicFlowPayload, clearToxicFlowTabWalletViewsCache } from '../lib/toxicFlowStakeCohort';
import { WS_BASE } from '../lib/env';

/** HTTP snapshot + `/ws/toxic-flow` increments (same payload shape as ToxicFlowDialog when open). */
export function useToxicFlowMarketStream(marketId: string | undefined | null, enabled = true): ToxicFlowData | null {
  const mid = typeof marketId === 'string' ? marketId.trim() : '';
  const [data, setData] = useState<ToxicFlowData | null>(null);
  const dataRef = useRef<ToxicFlowData | null>(null);

  useEffect(() => {
    if (!enabled || !mid) {
      dataRef.current = null;
      setData(null);
      clearToxicFlowTabWalletViewsCache();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const d = await fetchToxicFlow(mid);
        if (!cancelled) {
          const merged = coalesceToxicFlowPayload(dataRef.current, d);
          dataRef.current = merged;
          setData(merged);
        }
      } catch {
        if (!cancelled) {
          dataRef.current = null;
          setData(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, mid]);

  useEffect(() => {
    if (!enabled || !mid) return;
    clearToxicFlowTabWalletViewsCache();

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let pingIv: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      if (cancelled) return;
      const url = `${WS_BASE}/ws/toxic-flow?market_id=${encodeURIComponent(mid)}`;
      ws = new WebSocket(url);
      ws.onopen = () => {
        attempt = 0;
        if (pingIv != null) clearInterval(pingIv);
        pingIv = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25_000);
      };
      ws.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(String(ev.data)) as { type?: string; data?: ToxicFlowData };
          if (msg.type === 'toxicFlow' && msg.data && typeof msg.data === 'object') {
            const next = msg.data;
            const prev = dataRef.current;
            const merged = coalesceToxicFlowPayload(prev, next);
            if (prev && toxicFlowPayloadEqual(prev, merged)) return;
            dataRef.current = merged;
            setData(merged);
          }
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        const delay = Math.min(30_000, 800 * Math.pow(2, Math.min(attempt, 8)));
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (pingIv != null) clearInterval(pingIv);
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
      if (ws != null) {
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [enabled, mid]);

  return enabled && mid ? data : null;
}
