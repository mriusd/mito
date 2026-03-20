import { useEffect, useState } from 'react';

const WS_URL = 'wss://ws-live-data.polymarket.com/';

const ASSET_SYMBOL_MAP: Record<string, string> = {
  BTC: 'btc/usd',
  ETH: 'eth/usd',
  SOL: 'sol/usd',
  XRP: 'xrp/usd',
};

interface PriceState {
  price: number | null;
  timestamp: number | null;
}

/**
 * Subscribe to Polymarket's crypto_prices_chainlink WS for live asset prices.
 * Returns current price and timestamp. Auto-reconnects on disconnect.
 */
export function usePolymarketPrice(asset: string | null): PriceState {
  const [state, setState] = useState<PriceState>({ price: null, timestamp: null });

  useEffect(() => {
    setState({ price: null, timestamp: null });

    if (!asset) return;
    const symbol = ASSET_SYMBOL_MAP[asset.toUpperCase()];
    if (!symbol) return;

    // Per-connection cancelled flag — not shared across effect re-runs
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingIv: ReturnType<typeof setInterval> | null = null;

    function connect() {
      if (cancelled) return;

      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        if (cancelled) { ws?.close(); return; }
        ws!.send(JSON.stringify({
          action: 'subscribe',
          subscriptions: [
            {
              topic: 'crypto_prices_chainlink',
              type: 'update',
              filters: JSON.stringify({ symbol }),
            },
          ],
        }));
        // Send periodic pings to keep connection alive
        pingIv = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(event.data);

          // Initial subscribe response: topic "crypto_prices", type "subscribe"
          if (msg.topic === 'crypto_prices' && msg.type === 'subscribe' && msg.payload?.data) {
            const arr = msg.payload.data;
            if (Array.isArray(arr) && arr.length > 0) {
              const last = arr[arr.length - 1];
              if (typeof last.value === 'number' && last.value > 0) {
                setState({ price: last.value, timestamp: last.timestamp });
              }
            }
            return;
          }

          // Live update: topic "crypto_prices_chainlink", type "update"
          if (msg.topic === 'crypto_prices_chainlink' && msg.payload?.symbol === symbol) {
            const value = msg.payload.value;
            const ts = msg.payload.timestamp || msg.timestamp;
            if (typeof value === 'number' && value > 0) {
              setState({ price: value, timestamp: ts });
            }
          }
        } catch {}
      };

      ws.onerror = () => {};

      ws.onclose = () => {
        if (pingIv) { clearInterval(pingIv); pingIv = null; }
        // Auto-reconnect after 3s unless cancelled
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (pingIv) { clearInterval(pingIv); pingIv = null; }
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
