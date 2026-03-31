import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, WS_BASE } from '../lib/env';
import type { LiveTrade } from './usePolymarketOB';

const MAX_TRADES = 40;

interface OnchainFillRow {
  makerAmount?: number;
  takerAmount?: number;
  makerAssetId?: string;
  takerAssetId?: string;
  blockNumber?: number;
}

export function useOnchainTradesWS(tokenId: string | null) {
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    tokenRef.current = tokenId;
    if (!tokenId) {
      cleanup();
      setTrades([]);
      return;
    }

    const loadFromAPI = () =>
      fetch(`${API_BASE}/api/onchain-fills?token_id=${encodeURIComponent(tokenId)}&limit=30`)
        .then((r) => r.json())
        .then((res) => {
        const fills = Array.isArray(res?.fills) ? (res.fills as OnchainFillRow[]) : [];
        const mapped: LiveTrade[] = [];
        for (const f of fills) {
          const makerAmt = Number(f.makerAmount ?? 0);
          const takerAmt = Number(f.takerAmount ?? 0);
          const makerAsset = String(f.makerAssetId ?? '');
          const takerAsset = String(f.takerAssetId ?? '');
          const makerIsUSDC = makerAsset === '0';
          const takerIsUSDC = takerAsset === '0';
          const size = makerIsUSDC ? takerAmt : makerAmt;
          const price = makerIsUSDC
            ? (takerAmt > 0 ? makerAmt / takerAmt : 0)
            : (makerAmt > 0 ? takerAmt / makerAmt : 0);
          const side = (makerIsUSDC ? 'BUY' : takerIsUSDC ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
          const ts = Date.now() - Number(f.blockNumber ?? 0) % 1000;
          if (size > 0 && price > 0) {
            mapped.push({ side, size: String(size), price: String(price), timestamp: ts });
          }
        }
        mapped.sort((a, b) => b.timestamp - a.timestamp);
        setTrades(mapped.slice(0, MAX_TRADES));
      })
      .catch(() => {});

    const startPollingFallback = () => {
      if (pollRef.current) return;
      void loadFromAPI();
      pollRef.current = setInterval(() => {
        if (!tokenRef.current) return;
        void loadFromAPI();
      }, 2500);
    };

    setTrades([]);
    void loadFromAPI();

    let disposed = false;
    let ws: WebSocket | null = null;
    let attempt = 0;

    const connect = () => {
      if (disposed || !tokenRef.current) return;
      cleanup();
      const url = `${WS_BASE}/ws/onchain-trades?token_id=${encodeURIComponent(tokenRef.current)}`;
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        pingRef.current = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg?.type !== 'onchainTrade' || !msg?.data) return;
          const d = msg.data as { tokenId?: string; side?: string; size?: number; price?: number; timestamp?: number };
          if (!d.tokenId || d.tokenId !== tokenRef.current) return;
          const side = (d.side === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
          const size = Number(d.size ?? 0);
          const price = Number(d.price ?? 0);
          const ts = Number(d.timestamp ?? Date.now());
          if (!(size > 0 && price > 0)) return;
          const t: LiveTrade = { side, size: String(size), price: String(price), timestamp: ts };
          setTrades((prev) => [t, ...prev].slice(0, MAX_TRADES));
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        if (pingRef.current) {
          clearInterval(pingRef.current);
          pingRef.current = null;
        }
        if (disposed || !tokenRef.current) return;
        // If endpoint is unavailable (proxy/backend not deployed), stop WS spam and use polling fallback.
        if (attempt >= 2) {
          startPollingFallback();
          return;
        }
        const delay = Math.min(15000, 1000 * 2 ** Math.min(attempt, 4));
        attempt += 1;
        reconnectRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [tokenId, cleanup]);

  return { trades };
}

