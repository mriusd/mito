import { useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { getStoredApiCredsForEoa, hasCredsForWallet, triggerWalletRefresh } from '../lib/clobClient';
import { isWebMode } from '../lib/env';
import {
  POLY_USER_ORDERS_WS_URL,
  applyUserOrderWsEvent,
  buildUserOrdersSubscribePayload,
  normalizeConditionIdForWs,
  type PolyUserOrderWsMsg,
} from '../lib/polymarketUserOrdersWs';

const PING_MS = 10_000;
const RECONNECT_MS = 3_000;

function uniqueMarkets(...groups: string[][]): string[] {
  const s = new Set<string>();
  for (const g of groups) {
    for (const raw of g) {
      const id = normalizeConditionIdForWs(raw);
      if (id.length > 2) s.add(id);
    }
  }
  return [...s].sort();
}

/**
 * Real-time open orders via Polymarket CLOB user WS (`/ws/user`).
 * Patches `appStore.orders` on PLACEMENT / UPDATE / CANCELLATION.
 */
export function usePolymarketUserOrdersWS(eoa: string | null | undefined, proxyWallet: string | null | undefined) {
  const selectedConditionId = useAppStore(
    (s) => normalizeConditionIdForWs(s.selectedMarket?.conditionId || s.selectedMarket?.id || ''),
  );
  const orders = useAppStore((s) => s.orders);

  const orderMarketIds = useMemo(
    () => uniqueMarkets(orders.map((o) => o.market || '')),
    [orders],
  );

  const targetMarkets = useMemo(
    () => uniqueMarkets([selectedConditionId], orderMarketIds),
    [selectedConditionId, orderMarketIds],
  );

  const targetMarketsRef = useRef(targetMarkets);
  targetMarketsRef.current = targetMarkets;

  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
  const credsRef = useRef<ReturnType<typeof getStoredApiCredsForEoa>>(null);

  useEffect(() => {
    if (!isWebMode) return;

    const eoaLc = (eoa || '').trim().toLowerCase();
    const proxyLc = (proxyWallet || '').trim().toLowerCase();
    if (!eoaLc || !proxyLc || !hasCredsForWallet(proxyLc, eoaLc)) return;

    const creds = getStoredApiCredsForEoa(eoaLc);
    if (!creds) return;
    credsRef.current = creds;

    let cancelled = false;

    const clearPing = () => {
      if (pingRef.current) {
        clearInterval(pingRef.current);
        pingRef.current = null;
      }
    };

    const clearReconnect = () => {
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      clearReconnect();
      reconnectRef.current = setTimeout(() => {
        if (!cancelled) connect();
      }, RECONNECT_MS);
    };

    const subscribeMarkets = (markets: string[], initialDump: boolean) => {
      const ws = wsRef.current;
      const auth = credsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !auth || markets.length === 0) return;
      ws.send(JSON.stringify(buildUserOrdersSubscribePayload(markets, auth, initialDump)));
      for (const m of markets) subscribedRef.current.add(m);
    };

    const handleOrderMsg = (msg: PolyUserOrderWsMsg) => {
      const st = useAppStore.getState();
      st.setMarketData({ orders: applyUserOrderWsEvent(st.orders, msg) });
    };

    const handleTradeMsg = () => {
      triggerWalletRefresh();
    };

    const onMessage = (raw: string) => {
      if (raw === 'PONG') return;
      if (raw === 'PING') {
        wsRef.current?.send('PONG');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      for (const msg of messages) {
        if (!msg || typeof msg !== 'object') continue;
        const m = msg as PolyUserOrderWsMsg & { event_type?: string; status?: string };
        const et = String(m.event_type || '').toLowerCase();
        if (et === 'order') {
          handleOrderMsg(m);
        } else if (et === 'trade') {
          const st = String(m.status || '').toUpperCase();
          if (st === 'MATCHED' || st === 'CONFIRMED' || st === 'MINED') {
            handleTradeMsg();
          }
        }
      }
    };

    const connect = () => {
      if (cancelled) return;
      clearPing();
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      subscribedRef.current = new Set();

      const ws = new WebSocket(POLY_USER_ORDERS_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        subscribeMarkets(targetMarketsRef.current, true);
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('PING');
        }, PING_MS);
      };

      ws.onmessage = (ev) => onMessage(String(ev.data));
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        clearPing();
        if (!cancelled) scheduleReconnect();
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearPing();
      clearReconnect();
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      subscribedRef.current = new Set();
    };
  }, [eoa, proxyWallet]);

  // Subscribe to newly seen markets without reconnecting.
  useEffect(() => {
    const ws = wsRef.current;
    const auth = credsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !auth) return;

    const pending = targetMarkets.filter((m) => !subscribedRef.current.has(m));
    if (pending.length === 0) return;

    ws.send(JSON.stringify(buildUserOrdersSubscribePayload(pending, auth, true)));
    for (const m of pending) subscribedRef.current.add(m);
  }, [targetMarkets]);
}
