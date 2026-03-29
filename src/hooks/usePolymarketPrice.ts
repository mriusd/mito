import { useEffect, useState } from 'react';
import { WS_BASE } from '../lib/env';

interface PriceState {
  price: number | null;
  timestamp: number | null;
}

/**
 * Subscribe to our backend's /ws/prices for live Chainlink prices.
 * Backend proxies Polymarket's WS with correct Origin header for undelayed feed.
 * Returns current price and timestamp. Auto-reconnects on disconnect.
 */
export function usePolymarketPrice(asset: string | null): PriceState {
  const [state, setState] = useState<PriceState>({ price: null, timestamp: null });

  useEffect(() => {
    setState({ price: null, timestamp: null });

    if (!asset) return;
    const assetUpper = asset.toUpperCase();

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;

      ws = new WebSocket(`${WS_BASE}/ws/prices`);

      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(event.data);
          // Messages: { asset: "BTC", price: 70500.12, timestamp: 1774009608084 }
          if (msg.asset === assetUpper && typeof msg.price === 'number' && msg.price > 0) {
            setState({ price: msg.price, timestamp: msg.timestamp });
          }
        } catch {}
      };

      ws.onerror = () => {};

      ws.onclose = () => {
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        ws = null;
      }
    };
  }, [asset]);

  return state;
}

export type ChainlinkPricesMap = Record<string, number>;

/**
 * Single WS to /ws/prices: keeps latest Chainlink spot per asset (keys uppercased, e.g. BTC).
 * Use for grids that need all tracked assets without opening one socket per cell.
 */
export function useChainlinkPricesMap(): ChainlinkPricesMap {
  const [prices, setPrices] = useState<ChainlinkPricesMap>({});

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (cancelled) return;
      ws = new WebSocket(`${WS_BASE}/ws/prices`);

      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(event.data) as { asset?: string; price?: number };
          if (typeof msg.asset !== 'string' || typeof msg.price !== 'number' || msg.price <= 0) return;
          const k = msg.asset.toUpperCase();
          setPrices((prev) => (prev[k] === msg.price ? prev : { ...prev, [k]: msg.price }));
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {};

      ws.onclose = () => {
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        ws = null;
      }
    };
  }, []);

  return prices;
}
