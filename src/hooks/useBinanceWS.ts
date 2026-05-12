import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import type { AssetSymbol } from '../types';

const TICKER_SYMBOLS: AssetSymbol[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];

export function useBinanceWS() {
  const setBinanceTickerBatch = useAppStore((s) => s.setBinanceTickerBatch);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Partial<Record<AssetSymbol, number>>>({});
  const flushRafRef = useRef<number | null>(null);

  useEffect(() => {
    function flushTickerBatch() {
      flushRafRef.current = null;
      const snapshot = pendingRef.current;
      const keys = Object.keys(snapshot);
      pendingRef.current = {};
      if (keys.length === 0) return;
      setBinanceTickerBatch(snapshot);
    }

    /** Throttle to 4 Hz — every animation frame was triggering 50+ subscribers to re-render and accumulate fiber.alternate detached DOM. */
    function scheduleFlush() {
      if (flushRafRef.current != null) return;
      flushRafRef.current = window.setTimeout(() => flushTickerBatch(), 250) as unknown as number;
    }

    function connect() {
      const streams = ['btcusdt@ticker', 'ethusdt@ticker', 'solusdt@ticker', 'xrpusdt@ticker'];
      const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams.join('/')}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (!data.data?.s) return;
        const symbol = data.data.s as AssetSymbol;
        const price = parseFloat(data.data.c);
        if (!Number.isFinite(price)) return;
        pendingRef.current[symbol] = price;
        scheduleFlush();
      };

      ws.onclose = () => {
        setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    fetch('https://api.binance.com/api/v3/ticker/price')
      .then((r) => r.json())
      .then((data) => {
        const patch: Partial<Record<AssetSymbol, number>> = {};
        for (const item of data as { symbol?: string; price?: string }[]) {
          if (!item.symbol || !TICKER_SYMBOLS.includes(item.symbol as AssetSymbol)) continue;
          const p = parseFloat(item.price || '');
          if (!Number.isFinite(p)) continue;
          patch[item.symbol as AssetSymbol] = p;
        }
        setBinanceTickerBatch(patch);
      })
      .catch((err) => {
        console.error('binance ticker init:', err);
      });

    connect();

    return () => {
      if (flushRafRef.current != null) {
        clearTimeout(flushRafRef.current);
        flushRafRef.current = null;
      }
      const tail = pendingRef.current;
      pendingRef.current = {};
      if (Object.keys(tail).length > 0) setBinanceTickerBatch(tail);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [setBinanceTickerBatch]);
}
