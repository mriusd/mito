import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchToxicFlow, type ToxicFlowData } from '../api';
import { toxicFlowPayloadEqual, clearToxicFlowTabWalletViewsCache } from '../lib/toxicFlowStakeCohort';
import { applyToxicFlowWSMessage, toxicFlowFullSnapshot, type ToxicFlowWSMessage } from '../lib/toxicFlowWs';
import { WS_BASE } from '../lib/env';

export type ToxicFlowMarketStream = {
  data: ToxicFlowData | null;
  /** Refetch full toxic-flow snapshot over HTTP (replaces local state). */
  refresh: () => Promise<void>;
  refreshing: boolean;
};

/** HTTP snapshot + `/ws/toxic-flow` full on subscribe, then add/update/remove deltas. */
export function useToxicFlowMarketStream(
  marketId: string | undefined | null,
  enabled = true,
): ToxicFlowMarketStream {
  const mid = typeof marketId === 'string' ? marketId.trim() : '';
  const [data, setData] = useState<ToxicFlowData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const dataRef = useRef<ToxicFlowData | null>(null);

  const applyMessage = useCallback((msg: ToxicFlowWSMessage) => {
    const next = applyToxicFlowWSMessage(dataRef.current, msg);
    if (!next) return;
    if (dataRef.current && toxicFlowPayloadEqual(dataRef.current, next)) return;
    dataRef.current = next;
    setData(next);
  }, []);

  const refresh = useCallback(async () => {
    if (!mid) return;
    setRefreshing(true);
    try {
      const d = await fetchToxicFlow(mid);
      const snap = toxicFlowFullSnapshot(d);
      dataRef.current = snap;
      setData(snap);
    } catch {
      /* keep prior */
    } finally {
      setRefreshing(false);
    }
  }, [mid]);

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
          const snap = toxicFlowFullSnapshot(d);
          dataRef.current = snap;
          setData(snap);
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
          const msg = JSON.parse(String(ev.data)) as ToxicFlowWSMessage;
          applyMessage(msg);
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
  }, [enabled, mid, applyMessage]);

  return {
    data: enabled && mid ? data : null,
    refresh,
    refreshing,
  };
}
