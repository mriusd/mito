import { useEffect, useRef, useState, useCallback } from 'react';
import { API_BASE } from '../lib/env';
import { obBookSideUsdTotal } from '../lib/orderbookBookImbalance';
import { polymarketTradeKey } from '../lib/tradeKeys';

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
  /** Ledger wallet on pending mempool overlays. */
  wallet?: string;
  /** Outcome CLOB token this fill traded (on-chain tape). */
  tokenId?: string;
  /** Mempool overlay (not yet mined). UI may render distinctly; row is replaced on confirm. */
  pending?: boolean;
  /** true = price is LIMIT/approximate from calldata fast path; will be refined by trace broadcast. */
  priceApproximate?: boolean;
}

interface BookState {
  bids: OBLevel[];
  asks: OBLevel[];
}

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

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
const MAX_TRADES = 30;

function trimAskSideNearTouch(map: Map<string, string>, cap: number) {
  if (map.size <= cap) return;
  const sorted = Array.from(map.entries()).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
  const best = parseFloat(sorted[0]?.[0] ?? '0');
  if (!Number.isFinite(best)) return;
  const floor = Math.max(0.05, best - 0.01);
  let kept = sorted.filter(([price]) => {
    const p = parseFloat(price);
    return Number.isFinite(p) && p >= floor;
  });
  if (kept.length > cap) kept = kept.slice(0, cap);
  map.clear();
  for (const [price, size] of kept) map.set(price, size);
}

function trimBookSide(map: Map<string, string>, cap: number, bidSide: boolean) {
  if (map.size <= cap) return;
  if (!bidSide) {
    trimAskSideNearTouch(map, cap);
    return;
  }
  const kept = Array.from(map.entries())
    .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
    .slice(0, cap);
  map.clear();
  for (const [price, size] of kept) map.set(price, size);
}

function trimBookMaps(bids: Map<string, string>, asks: Map<string, string>) {
  trimBookSide(bids, MAX_BOOK_LEVELS, true);
  trimBookSide(asks, MAX_BOOK_LEVELS, false);
}

function sortedBook(
  bids: Map<string, string>,
  asks: Map<string, string>,
  limit: number,
): BookState & { bidUsdTotal: number; askUsdTotal: number } {
  const capped = Number.isFinite(limit) && limit > 0 ? limit : 15;
  const sortedBids = Array.from(bids.entries())
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
    .slice(0, capped);
  const sortedAsks = Array.from(asks.entries())
    .map(([price, size]) => ({ price, size }))
    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
    .slice(0, capped);
  return {
    bids: sortedBids,
    asks: sortedAsks,
    bidUsdTotal: obBookSideUsdTotal(sortedBids),
    askUsdTotal: obBookSideUsdTotal(sortedAsks),
  };
}

function fullBookUsdTotals(bids: Map<string, string>, asks: Map<string, string>) {
  const allBids = Array.from(bids.entries()).map(([price, size]) => ({ price, size }));
  const allAsks = Array.from(asks.entries()).map(([price, size]) => ({ price, size }));
  return {
    bidUsdTotal: obBookSideUsdTotal(allBids),
    askUsdTotal: obBookSideUsdTotal(allAsks),
  };
}

export function usePolymarketOB(tokenId: string | null, bookLimit = 15) {
  const [book, setBook] = useState<BookState>({ bids: [], asks: [] });
  const [bidUsdTotal, setBidUsdTotal] = useState(0);
  const [askUsdTotal, setAskUsdTotal] = useState(0);
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const tokenIdRef = useRef<string | null>(null);
  const bookLimitRef = useRef(bookLimit);
  const localBidsRef = useRef(new Map<string, string>());
  const localAsksRef = useRef(new Map<string, string>());
  const localTradesRef = useRef<LiveTrade[]>([]);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotLoaded = useRef(false);
  const bookRafSlot = useRef<number | null>(null);
  const tradesRafSlot = useRef<number | null>(null);

  bookLimitRef.current = bookLimit;

  const resetLocalBook = useCallback(() => {
    localBidsRef.current = new Map();
    localAsksRef.current = new Map();
    localTradesRef.current = [];
    snapshotLoaded.current = false;
    setBidUsdTotal(0);
    setAskUsdTotal(0);
  }, []);

  const publishBook = useCallback((limit: number) => {
    const next = sortedBook(localBidsRef.current, localAsksRef.current, limit);
    const totals = fullBookUsdTotals(localBidsRef.current, localAsksRef.current);
    setBook({ bids: next.bids, asks: next.asks });
    setBidUsdTotal(totals.bidUsdTotal);
    setAskUsdTotal(totals.askUsdTotal);
    if (next.bids.length > 0 || next.asks.length > 0) {
      setLoading(false);
    }
  }, []);

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
    resetLocalBook();
    setLoading(true);
    setTrades([]);

    fetch(`${API_BASE}/api/trades/${tid}?limit=100`)
      .then((r) => r.json())
      .then((data: { price: number; size: number; side: string; timestamp: number }[] | null) => {
        if (!data || !Array.isArray(data)) return;
        const fetched: LiveTrade[] = data.map((t) => {
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
        const existing = new Set(
          localTradesRef.current.map((t) => t.id ?? polymarketTradeKey(t.timestamp, t.price, t.size)),
        );
        for (const t of fetched) {
          const k = t.id ?? polymarketTradeKey(t.timestamp, t.price, t.size);
          if (!existing.has(k)) {
            localTradesRef.current.push(t);
          }
        }
        localTradesRef.current.sort((a, b) => b.timestamp - a.timestamp);
        localTradesRef.current = localTradesRef.current.slice(0, MAX_TRADES);
        setTrades([...localTradesRef.current]);
      })
      .catch(() => {});

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'market',
          assets_ids: [tid],
          custom_feature_enabled: true,
        }),
      );

      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send('PING');
        }
      }, 10000);
    };

    ws.onmessage = (event) => {
      const raw = event.data;
      if (raw === 'PONG') return;
      if (raw === 'PING') {
        ws.send('PONG');
        return;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }

      const messages = Array.isArray(parsed) ? parsed : [parsed];

      for (const msg of messages) {
        if (!msg.event_type) continue;

        switch (msg.event_type) {
          case 'book': {
            if (msg.asset_id && msg.asset_id !== tid) break;
            const nextBids = new Map<string, string>();
            const nextAsks = new Map<string, string>();
            for (const b of msg.bids || []) {
              nextBids.set(b.price, b.size);
            }
            for (const a of msg.asks || []) {
              nextAsks.set(a.price, a.size);
            }
            localBidsRef.current = nextBids;
            localAsksRef.current = nextAsks;
            snapshotLoaded.current = true;
            setLoading(false);
            cancelRaf(bookRafSlot);
            publishBook(bookLimitRef.current);
            break;
          }

          case 'price_change': {
            if (!snapshotLoaded.current) break;
            let changed = false;
            for (const change of msg.price_changes || []) {
              if (change.asset_id && change.asset_id !== tid) continue;
              const map = change.side === 'BUY' ? localBidsRef.current : localAsksRef.current;
              const size = parseFloat(change.size);
              if (size <= 0) {
                map.delete(change.price);
              } else {
                map.set(change.price, change.size);
              }
              changed = true;
            }
            if (changed) {
              trimBookMaps(localBidsRef.current, localAsksRef.current);
              scheduleRaf(() => {
                publishBook(bookLimitRef.current);
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
            localTradesRef.current = [trade, ...localTradesRef.current].slice(0, MAX_TRADES);
            scheduleRaf(() => {
              setTrades([...localTradesRef.current]);
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
  }, [cleanup, resetLocalBook, publishBook]);

  useEffect(() => {
    tokenIdRef.current = tokenId;

    if (!tokenId) {
      cleanup();
      resetLocalBook();
      setLoading(false);
      cancelRaf(bookRafSlot);
      cancelRaf(tradesRafSlot);
      setBook({ bids: [], asks: [] });
      setTrades([]);
      setBidUsdTotal(0);
      setAskUsdTotal(0);
      return;
    }

    cancelRaf(bookRafSlot);
    cancelRaf(tradesRafSlot);
    setBook({ bids: [], asks: [] });
    connect();

    return () => {
      cleanup();
    };
  }, [tokenId, connect, cleanup, resetLocalBook]);

  useEffect(() => {
    bookLimitRef.current = bookLimit;
    if (!tokenId || !snapshotLoaded.current) return;
    cancelRaf(bookRafSlot);
    publishBook(bookLimit);
  }, [tokenId, bookLimit, publishBook]);

  return { bids: book.bids, asks: book.asks, trades, loading, bidUsdTotal, askUsdTotal };
}
