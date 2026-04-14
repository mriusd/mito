import { useEffect, useRef, useState, useCallback } from 'react';
import { API_BASE } from '../lib/env';

interface OBLevel {
  price: string;
  size: string;
}

export interface LiveTrade {
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
  timestamp: number;
  txHash?: string;
  /** On-chain log index when present (stable list keys, on-chain tape). */
  logIndex?: number;
  maker?: string;
  taker?: string;
}

interface BookState {
  bids: OBLevel[];
  asks: OBLevel[];
}

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
// Shared local book maps — kept outside React state for perf,
// flushed to React state via flushBook.
let localBids: Map<string, string> = new Map();
let localAsks: Map<string, string> = new Map();
let localTrades: LiveTrade[] = [];
const MAX_TRADES = 30;

function sortedBook(bids: Map<string, string>, asks: Map<string, string>): BookState {
  const sortedBids = Array.from(bids.entries())
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
    .slice(0, 15);
  const sortedAsks = Array.from(asks.entries())
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
    .slice(0, 15);
  return { bids: sortedBids, asks: sortedAsks };
}

export function usePolymarketOB(tokenId: string | null) {
  const [book, setBook] = useState<BookState>({ bids: [], asks: [] });
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const tokenIdRef = useRef<string | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotLoaded = useRef(false);

  const cleanup = useCallback(() => {
    if (pingTimer.current) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    const tid = tokenIdRef.current;
    if (!tid) return;

    cleanup();
    localBids = new Map();
    localAsks = new Map();
    localTrades = [];
    snapshotLoaded.current = false;
    setLoading(true);
    setTrades([]);

    // Fetch recent trades from backend to seed the list
    fetch(`${API_BASE}/api/trades/${tid}?limit=100`)
      .then(r => r.json())
      .then((data: { price: number; size: number; side: string; timestamp: number }[] | null) => {
        if (!data || !Array.isArray(data)) return;
        const fetched: LiveTrade[] = data.map(t => ({
          price: String(t.price),
          size: String(t.size),
          side: (t.side || 'BUY') as 'BUY' | 'SELL',
          timestamp: t.timestamp,
        }));
        // Merge with any WS trades that arrived in the meantime
        const existing = new Set(localTrades.map(t => `${t.timestamp}-${t.price}-${t.size}`));
        for (const t of fetched) {
          if (!existing.has(`${t.timestamp}-${t.price}-${t.size}`)) {
            localTrades.push(t);
          }
        }
        localTrades.sort((a, b) => b.timestamp - a.timestamp);
        localTrades = localTrades.slice(0, MAX_TRADES);
        setTrades([...localTrades]);
      })
      .catch(() => {});

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      // Subscribe to WS channel
      ws.send(JSON.stringify({
        type: 'market',
        assets_ids: [tid],
        custom_feature_enabled: true,
      }));

      // Heartbeat keepalive
      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('PING');
        }
      }, 10000);
    };

    ws.onmessage = (event) => {
      const raw = event.data;
      if (raw === 'PONG') return;
      if (raw === 'PING') { ws.send('PONG'); return; }

      let parsed: any;
      try { parsed = JSON.parse(raw); } catch { return; }

      // WS can send arrays (e.g. book snapshots) or single objects
      const messages = Array.isArray(parsed) ? parsed : [parsed];

      for (const msg of messages) {
        if (!msg.event_type) continue;

        switch (msg.event_type) {
          case 'book': {
            // Full snapshot — filter to our token
            if (msg.asset_id && msg.asset_id !== tid) break;
            localBids = new Map();
            localAsks = new Map();
            for (const b of msg.bids || []) {
              localBids.set(b.price, b.size);
            }
            for (const a of msg.asks || []) {
              localAsks.set(a.price, a.size);
            }
            snapshotLoaded.current = true;
            setLoading(false);
            setBook(sortedBook(localBids, localAsks));
            break;
          }

          case 'price_change': {
            if (!snapshotLoaded.current) break;
            let changed = false;
            for (const change of msg.price_changes || []) {
              if (change.asset_id && change.asset_id !== tid) continue;
              const map = change.side === 'BUY' ? localBids : localAsks;
              const size = parseFloat(change.size);
              if (size <= 0) {
                map.delete(change.price);
              } else {
                map.set(change.price, change.size);
              }
              changed = true;
            }
            if (changed) setBook(sortedBook(localBids, localAsks));
            break;
          }

          case 'last_trade_price': {
            if (msg.asset_id && msg.asset_id !== tid) break;
            const trade: LiveTrade = {
              price: msg.price,
              size: msg.size,
              side: msg.side || 'BUY',
              timestamp: parseInt(msg.timestamp) || Date.now(),
            };
            localTrades = [trade, ...localTrades].slice(0, MAX_TRADES);
            setTrades([...localTrades]);
            break;
          }
        }
      }
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      if (tokenIdRef.current === tid) {
        reconnectTimer.current = setTimeout(connect, 2000);
      }
    };
  }, [cleanup]);

  useEffect(() => {
    tokenIdRef.current = tokenId;

    if (!tokenId) {
      cleanup();
      localBids = new Map();
      localAsks = new Map();
      localTrades = [];
      snapshotLoaded.current = false;
      setLoading(false);
      setBook({ bids: [], asks: [] });
      setTrades([]);
      return;
    }

    // Clear old book immediately so stale OB doesn't show while loading
    setBook({ bids: [], asks: [] });
    connect();

    return () => {
      cleanup();
    };
  }, [tokenId, connect, cleanup]);

  return { bids: book.bids, asks: book.asks, trades, loading };
}
