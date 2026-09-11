import { useEffect, useRef, useState, useCallback } from 'react';
import { API_BASE } from '../lib/env';
import { fetchBackend } from '../lib/fetchBackend';
import { obAskSweepRedeemProfit, obBookSideUsdTotal } from '../lib/orderbookBookImbalance';
import { polymarketTradeKey } from '../lib/tradeKeys';
import { isUiScrollQuiet } from '../lib/uiScrollQuiet';

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

/** Coalesce CLOB price_change spam — rAF (~60Hz) was thrashing the sidebar DOM. */
const BOOK_UI_THROTTLE_MS = 1500;
const BOOK_UI_THROTTLE_WHILE_SCROLL_MS = 2500;
const TRADES_UI_THROTTLE_MS = 1000;

type TimerSlot = { current: ReturnType<typeof setTimeout> | null };

function scheduleThrottle(cb: () => void, slot: TimerSlot, ms: number): void {
  if (slot.current != null) return;
  slot.current = setTimeout(() => {
    slot.current = null;
    cb();
  }, ms);
}

function cancelThrottle(slot: TimerSlot): void {
  if (slot.current != null) {
    clearTimeout(slot.current);
    slot.current = null;
  }
}

const MAX_BOOK_LEVELS = 500;
const MAX_TRADES = 30;

/**
 * CLOB tokens that returned 404/400 from GET /book (resolved / delisted / never listed).
 * Session-scoped — avoid hammering Polymarket and opening WS reconnect loops.
 */
const deadClobTokenIds = new Set<string>();

function markClobTokenDead(tokenId: string): void {
  deadClobTokenIds.add(tokenId);
}

function isClobTokenDead(tokenId: string): boolean {
  return deadClobTokenIds.has(tokenId);
}

/** Stable signature for display book — skip React setState when top-of-book + sizes unchanged. */
function bookPublishSig(
  bids: OBLevel[],
  asks: OBLevel[],
  bidUsd: number,
  askUsd: number,
  askSweep: number | null,
): string {
  // Round sizes — sub-share CLOB noise must not force a full book re-render.
  let s = `${bids.length}|${asks.length}|${Math.round(bidUsd)}|${Math.round(askUsd)}|${askSweep == null ? '' : Math.round(askSweep)}`;
  for (let i = 0; i < bids.length; i++) {
    const b = bids[i]!;
    s += `|b${b.price}:${Math.round(parseFloat(b.size) || 0)}`;
  }
  for (let i = 0; i < asks.length; i++) {
    const a = asks[i]!;
    s += `|a${a.price}:${Math.round(parseFloat(a.size) || 0)}`;
  }
  return s;
}

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
    askSweepProfit: obAskSweepRedeemProfit(allAsks),
  };
}

export function usePolymarketOB(tokenId: string | null, bookLimit = 15) {
  const [book, setBook] = useState<BookState>({ bids: [], asks: [] });
  const [bidUsdTotal, setBidUsdTotal] = useState(0);
  const [askUsdTotal, setAskUsdTotal] = useState(0);
  const [askSweepProfit, setAskSweepProfit] = useState<number | null>(null);
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
  const abortRef = useRef<AbortController | null>(null);
  const snapshotLoaded = useRef(false);
  const bookThrottleSlot = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tradesThrottleSlot = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPublishSigRef = useRef('');

  bookLimitRef.current = bookLimit;

  const resetLocalBook = useCallback(() => {
    localBidsRef.current = new Map();
    localAsksRef.current = new Map();
    localTradesRef.current = [];
    snapshotLoaded.current = false;
    lastPublishSigRef.current = '';
    setBidUsdTotal(0);
    setAskUsdTotal(0);
    setAskSweepProfit(null);
  }, []);

  const publishBook = useCallback((limit: number) => {
    // While the user is scrolling, keep maps fresh but don't thrash React/DOM.
    if (isUiScrollQuiet()) {
      scheduleThrottle(
        () => publishBook(bookLimitRef.current),
        bookThrottleSlot,
        BOOK_UI_THROTTLE_WHILE_SCROLL_MS,
      );
      return;
    }
    const next = sortedBook(localBidsRef.current, localAsksRef.current, limit);
    const totals = fullBookUsdTotals(localBidsRef.current, localAsksRef.current);
    const sig = bookPublishSig(
      next.bids,
      next.asks,
      totals.bidUsdTotal,
      totals.askUsdTotal,
      totals.askSweepProfit,
    );
    if (sig === lastPublishSigRef.current) {
      if (next.bids.length > 0 || next.asks.length > 0) {
        setLoading(false);
      }
      return;
    }
    lastPublishSigRef.current = sig;
    // Batch into one render — multiple setStates were cascading with dual YES/NO books.
    setBook({ bids: next.bids, asks: next.asks });
    setBidUsdTotal(Math.round(totals.bidUsdTotal));
    setAskUsdTotal(Math.round(totals.askUsdTotal));
    setAskSweepProfit(
      totals.askSweepProfit == null ? null : Math.round(totals.askSweepProfit * 10) / 10,
    );
    if (next.bids.length > 0 || next.asks.length > 0) {
      setLoading(false);
    }
  }, []);

  const cleanup = useCallback(() => {
    cancelThrottle(bookThrottleSlot);
    cancelThrottle(tradesThrottleSlot);
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
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

    // Known-dead (prior 404) — never open REST/WS/reconnect for this token again.
    if (isClobTokenDead(tid)) {
      setLoading(false);
      return;
    }

    cleanup();
    resetLocalBook();
    setLoading(true);
    setTrades([]);

    const ac = new AbortController();
    abortRef.current = ac;
    let stoppedForDead = false;

    const stopDeadToken = () => {
      if (stoppedForDead) return;
      stoppedForDead = true;
      markClobTokenDead(tid);
      if (tokenIdRef.current === tid) {
        cleanup();
        setLoading(false);
      }
    };

    const stillCurrent = () =>
      tokenIdRef.current === tid && !ac.signal.aborted && !stoppedForDead && !isClobTokenDead(tid);

    const openMarketWs = () => {
      if (!stillCurrent()) return;

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!stillCurrent()) {
          ws.close();
          return;
        }
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
              scheduleThrottle(
                () => publishBook(bookLimitRef.current),
                bookThrottleSlot,
                BOOK_UI_THROTTLE_MS,
              );
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
                scheduleThrottle(
                  () => publishBook(bookLimitRef.current),
                  bookThrottleSlot,
                  BOOK_UI_THROTTLE_MS,
                );
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
              scheduleThrottle(
                () => {
                  setTrades([...localTradesRef.current]);
                },
                tradesThrottleSlot,
                TRADES_UI_THROTTLE_MS,
              );
              break;
            }
          }
        }
      };

      ws.onerror = () => {};

      ws.onclose = () => {
        if (!stillCurrent()) return;
        reconnectTimer.current = setTimeout(connect, 2000);
      };
    };

    const loadHistoricalTrades = () => {
      if (!stillCurrent()) return;
      fetchBackend(`${API_BASE}/api/trades/${tid}?limit=100`, { signal: ac.signal })
        .then((r) => r.json())
        .then((tradesData: { price: number; size: number; side: string; timestamp: number }[] | null) => {
          if (!stillCurrent() || !tradesData || !Array.isArray(tradesData)) return;
          const fetched: LiveTrade[] = tradesData.map((t) => {
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
    };

    // Resolve /book first. Opening WS in parallel for dead tokens caused 404 spam +
    // onclose→reconnect loops that stalled the main thread on market select.
    fetch(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(tid)}`, {
      signal: ac.signal,
    })
      .then(async (r) => {
        if (!stillCurrent()) return 'aborted' as const;
        if (r.status === 404 || r.status === 400) {
          stopDeadToken();
          return 'dead' as const;
        }
        if (!r.ok) {
          // Transient HTTP error — still try WS; don't mark dead.
          return 'soft' as const;
        }
        const data = (await r.json()) as {
          bids?: { price: string; size: string }[];
          asks?: { price: string; size: string }[];
        };
        if (!stillCurrent()) return 'aborted' as const;
        const nextBids = new Map<string, string>();
        const nextAsks = new Map<string, string>();
        for (const b of data.bids || []) {
          if (b?.price != null) nextBids.set(String(b.price), String(b.size ?? '0'));
        }
        for (const a of data.asks || []) {
          if (a?.price != null) nextAsks.set(String(a.price), String(a.size ?? '0'));
        }
        if (nextBids.size > 0 || nextAsks.size > 0) {
          localBidsRef.current = nextBids;
          localAsksRef.current = nextAsks;
          snapshotLoaded.current = true;
          setLoading(false);
          cancelThrottle(bookThrottleSlot);
          publishBook(bookLimitRef.current);
        }
        return 'ok' as const;
      })
      .then((status) => {
        if (status === 'dead' || status === 'aborted') return;
        if (!stillCurrent()) return;
        loadHistoricalTrades();
        openMarketWs();
      })
      .catch(() => {
        if (ac.signal.aborted || stoppedForDead) return;
        // Network failure on /book — still attempt WS so live markets aren't blocked.
        if (!stillCurrent()) return;
        loadHistoricalTrades();
        openMarketWs();
      });
  }, [cleanup, resetLocalBook, publishBook]);

  useEffect(() => {
    // Tear down previous book immediately so rapid market hops don't stack WS/fetches.
    cleanup();
    cancelThrottle(bookThrottleSlot);
    cancelThrottle(tradesThrottleSlot);
    resetLocalBook();
    setBook({ bids: [], asks: [] });
    setTrades([]);
    setBidUsdTotal(0);
    setAskUsdTotal(0);

    if (!tokenId) {
      tokenIdRef.current = null;
      setLoading(false);
      return;
    }

    // Instant no-op for tokens we already know are dead (no 120ms wait, no fetch).
    if (isClobTokenDead(tokenId)) {
      tokenIdRef.current = tokenId;
      setLoading(false);
      return;
    }

    setLoading(true);
    // Debounce connect: free-firing token switches only open one WS for the last token.
    const tid = tokenId;
    const connectTimer = window.setTimeout(() => {
      tokenIdRef.current = tid;
      connect();
    }, 120);

    return () => {
      window.clearTimeout(connectTimer);
      cleanup();
    };
  }, [tokenId, connect, cleanup, resetLocalBook]);

  useEffect(() => {
    bookLimitRef.current = bookLimit;
    if (!tokenId || !snapshotLoaded.current) return;
    cancelThrottle(bookThrottleSlot);
    publishBook(bookLimit);
  }, [tokenId, bookLimit, publishBook]);

  return {
    bids: book.bids,
    asks: book.asks,
    trades,
    loading,
    bidUsdTotal,
    askUsdTotal,
    askSweepProfit,
  };
}
