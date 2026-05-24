import { useEffect, useRef, useState, useCallback } from 'react';
import { API_BASE } from '../lib/env';
import { onchainFillKey, polymarketTradeKey } from '../lib/tradeKeys';

interface OBLevel {
  price: string;
  size: string;
}

export interface LiveTrade {
  /** Stable row/dedupe key — set once at ingest. */
  id?: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
  timestamp: number;
  txHash?: string;
  /** On-chain log index when present (stable list keys, on-chain tape). */
  logIndex?: number;
  maker?: string;
  taker?: string;
  /** Mempool overlay (not yet mined). UI may render distinctly; row is replaced on confirm. */
  pending?: boolean;
}

interface BookState {
  bids: OBLevel[];
  asks: OBLevel[];
}

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
// Shared local book maps — kept outside React state for perf; React book state is RAF-coalesced on price deltas.
function scheduleRaf(cb: () => void, slot: { current: number | null }): void {
  if (slot.current !== null) return;
  slot.current = requestAnimationFrame(() => {
    slot.current = null;
    cb();
  });
}

function cancelRaf(slot: { current: number | null }): void {
  if (slot.current !== null) {
    cancelAnimationFrame(slot.current);
    slot.current = null;
  }
}

const MAX_BOOK_LEVELS = 500;

function trimBookSide(map: Map<string, string>, cap: number, bidSide: boolean) {
  if (map.size <= cap) return;
  const kept = Array.from(map.entries())
    .sort((a, b) => (bidSide ? parseFloat(b[0]) - parseFloat(a[0]) : parseFloat(a[0]) - parseFloat(b[0])))
    .slice(0, cap);
  map.clear();
  for (const [price, size] of kept) map.set(price, size);
}

function trimBookMaps(bids: Map<string, string>, asks: Map<string, string>) {
  trimBookSide(bids, MAX_BOOK_LEVELS, true);
  trimBookSide(asks, MAX_BOOK_LEVELS, false);
}

let localBids: Map<string, string> = new Map();
let localAsks: Map<string, string> = new Map();
let localTrades: LiveTrade[] = [];
const MAX_TRADES = 30;

function sortedBook(bids: Map<string, string>, asks: Map<string, string>, limit: number): BookState {
  const capped = Number.isFinite(limit) && limit > 0 ? limit : 15;
  const sortedBids = Array.from(bids.entries())
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
    .slice(0, capped);
  const sortedAsks = Array.from(asks.entries())
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
    .slice(0, capped);
  return { bids: sortedBids, asks: sortedAsks };
}

export function usePolymarketOB(tokenId: string | null, bookLimit = 15) {
  const [book, setBook] = useState<BookState>({ bids: [], asks: [] });
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const tokenIdRef = useRef<string | null>(null);
  const bookLimitRef = useRef(bookLimit);

  bookLimitRef.current = bookLimit;
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotLoaded = useRef(false);
  const bookRafSlot = useRef<number | null>(null);
  const tradesRafSlot = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    cancelRaf(bookRafSlot);
    cancelRaf(tradesRafSlot);
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
        const fetched: LiveTrade[] = data.map(t => {
          const price = String(t.price);
          const size = String(t.size);
          return {
            id: polymarketTradeKey(t.timestamp, price, size),
            price,
            size,
            side: (t.side || 'BUY') as 'BUY' | 'SELL',
            timestamp: t.timestamp,
          };
        });
        const existing = new Set(localTrades.map(t => t.id ?? polymarketTradeKey(t.timestamp, t.price, t.size)));
        for (const t of fetched) {
          const k = t.id ?? polymarketTradeKey(t.timestamp, t.price, t.size);
          if (!existing.has(k)) {
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
            cancelRaf(bookRafSlot);
            setBook(sortedBook(localBids, localAsks, bookLimitRef.current));
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
            if (changed) {
              trimBookMaps(localBids, localAsks);
              scheduleRaf(() => {
                setBook(sortedBook(localBids, localAsks, bookLimitRef.current));
              }, bookRafSlot);
            }
            break;
          }

          case 'last_trade_price': {
            if (msg.asset_id && msg.asset_id !== tid) break;
            const price = msg.price;
            const size = msg.size;
            const timestamp = parseInt(msg.timestamp) || Date.now();
            const trade: LiveTrade = {
              id: polymarketTradeKey(timestamp, price, size),
              price,
              size,
              side: msg.side || 'BUY',
              timestamp,
            };
            localTrades = [trade, ...localTrades].slice(0, MAX_TRADES);
            scheduleRaf(() => {
              setTrades([...localTrades]);
            }, tradesRafSlot);
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
      cancelRaf(bookRafSlot);
      cancelRaf(tradesRafSlot);
      setBook({ bids: [], asks: [] });
      setTrades([]);
      return;
    }

    // Clear old book immediately so stale OB doesn't show while loading
    cancelRaf(bookRafSlot);
    cancelRaf(tradesRafSlot);
    setBook({ bids: [], asks: [] });
    connect();

    return () => {
      cleanup();
    };
  }, [tokenId, connect, cleanup]);

  useEffect(() => {
    bookLimitRef.current = bookLimit;
    if (!tokenId || !snapshotLoaded.current) return;
    cancelRaf(bookRafSlot);
    setBook(sortedBook(localBids, localAsks, bookLimit));
  }, [tokenId, bookLimit]);

  return { bids: book.bids, asks: book.asks, trades, loading };
}
