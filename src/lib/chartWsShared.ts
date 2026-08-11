import { WS_BASE } from './env';
import { onBackendReconnect } from './backendReconnect';
import { backendWsRetryDelayMs, markBackendDownFromWs, markBackendWsUp } from './fetchBackend';

// Single shared /ws/chart socket for the whole app. Every consumer (live trade
// chart, chainlink/volatility charts, binance chart panel, bid/ask lookup)
// multiplexes over this one connection instead of opening its own socket.
//
// Protocol over /ws/chart:
//   - server pushes `bidAskBatch` / `bidAskUpDown` to all clients (no subscribe)
//   - client sends `subscribeKlineStream` / `unsubscribeKlineStream` { symbol, interval }
//   - server replies with `klineStreamSnapshot` / `klineStreamUpdate` / `klineStreamDelete`,
//     each tagged with `data.stream` = `${lower(symbol)}_${interval}` for routing.

export interface ChartWsMsg {
  type?: string;
  data?: {
    stream?: string;
    symbol?: string;
    interval?: string;
    klines?: unknown[];
    data?: { k?: Record<string, unknown>; s?: string; i?: string; t?: number };
  };
}

export interface ChartKlineHandlers {
  onMessage: (msg: ChartWsMsg) => void;
  /** Fired after the shared socket reconnects and this stream is re-subscribed. */
  onReconnect?: () => void;
}

interface KlineEntry {
  symbol: string;
  interval: string;
  handlers: Set<ChartKlineHandlers>;
}

const streamKey = (symbol: string, interval: string) =>
  `${symbol.trim().toLowerCase()}_${interval.trim()}`;

let ws: WebSocket | null = null;
let pingIv: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let onReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogIv: ReturnType<typeof setInterval> | null = null;
let attempt = 0;

/** Last JSON message / bidAskBatch timestamps — detect zombie sockets & silent drops. */
let lastAnyMsgAt = 0;
let lastBidAskMsgAt = 0;
let lastForcedReconnectAt = 0;

/**
 * No bidAskBatch while tab is visible for this long → force reconnect.
 * Polymarket top-of-book is rarely quiet that long across the whole feed.
 */
const BIDASK_STALE_MS = 75_000;
/** No JSON traffic at all (incl. pong) → half-open / dead socket. */
const WS_SILENT_MS = 90_000;
const WATCHDOG_TICK_MS = 12_000;
const FORCE_RECONNECT_MIN_GAP_MS = 20_000;

const klineSubs = new Map<string, KlineEntry>();
const bidAskSubs = new Set<(msg: ChartWsMsg) => void>();
/** Extra CLOB tokens for live bid/ask — union of named sources (TPO, temp-odds, …). */
const bidAskExtraSources = new Map<string, string[]>();
let bidAskExtraTokenIds: string[] = [];

function totalSubs(): number {
  let n = bidAskSubs.size;
  for (const e of klineSubs.values()) n += e.handlers.size;
  if (bidAskExtraTokenIds.length > 0) n += 1;
  return n;
}

function rawSend(obj: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function noteChartWsMessage(type: string | undefined): void {
  const now = Date.now();
  lastAnyMsgAt = now;
  if (type === 'bidAskBatch' || type === 'bidAskUpDown') {
    lastBidAskMsgAt = now;
  }
}

/**
 * Tear down the shared chart socket and reconnect from the client.
 * Frontend-only: backend can still be fine while this tab's socket is half-open
 * (readyState OPEN, no messages) — refresh fixes it by creating a new socket.
 * Do not rely on sock.onclose (it may not fire for zombies).
 */
function forceChartWsReconnect(reason: string): void {
  if (totalSubs() === 0) return;
  const now = Date.now();
  if (now - lastForcedReconnectAt < FORCE_RECONNECT_MIN_GAP_MS) return;
  lastForcedReconnectAt = now;
  console.warn(`[chartWs] force reconnect: ${reason}`);

  const sock = ws;
  ws = null;
  if (pingIv != null) {
    clearInterval(pingIv);
    pingIv = null;
  }
  if (sock != null) {
    try {
      sock.onclose = null;
      sock.onerror = null;
      sock.onmessage = null;
      sock.close();
    } catch {
      /* ignore */
    }
  }
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // Immediate reconnect — do not wait for onclose (zombie sockets often never fire it).
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 100);
}

function ensureWatchdog(): void {
  if (watchdogIv != null) return;
  watchdogIv = setInterval(() => {
    if (totalSubs() === 0) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const now = Date.now();
    // Wait until socket has been open long enough (lastAnyMsgAt set on open).
    if (lastAnyMsgAt <= 0) return;

    if (bidAskSubs.size > 0) {
      // If we never got a bidAskBatch after open, still treat as stale vs open time.
      const bidAskAnchor = lastBidAskMsgAt > 0 ? lastBidAskMsgAt : lastAnyMsgAt;
      if (now - bidAskAnchor > BIDASK_STALE_MS) {
        forceChartWsReconnect(`bidAsk silent ${Math.round((now - bidAskAnchor) / 1000)}s`);
        return;
      }
    }
    if (now - lastAnyMsgAt > WS_SILENT_MS) {
      forceChartWsReconnect(`ws silent ${Math.round((now - lastAnyMsgAt) / 1000)}s`);
    }
  }, WATCHDOG_TICK_MS);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityForChartWs);
  }
}

function stopWatchdogIfIdle(): void {
  if (totalSubs() > 0) return;
  if (watchdogIv != null) {
    clearInterval(watchdogIv);
    watchdogIv = null;
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityForChartWs);
  }
}

function onVisibilityForChartWs(): void {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
  if (totalSubs() === 0) return;
  const now = Date.now();
  if (lastBidAskMsgAt > 0 && now - lastBidAskMsgAt > BIDASK_STALE_MS / 2) {
    forceChartWsReconnect('tab visible + bidAsk stale');
  } else if (lastAnyMsgAt > 0 && now - lastAnyMsgAt > WS_SILENT_MS / 2) {
    forceChartWsReconnect('tab visible + ws silent');
  } else if (ws == null && reconnectTimer == null) {
    connect();
  }
}

function rebuildBidAskExtraUnion(): string[] {
  const set = new Set<string>();
  for (const ids of bidAskExtraSources.values()) {
    for (const id of ids) set.add(id);
  }
  return [...set].sort();
}

function sendBidAskExtraTokens(): void {
  rawSend({ type: 'subscribeBidAskTokens', data: { tokenIds: bidAskExtraTokenIds } });
}

function fireOnReconnectDebounced(): void {
  if (onReconnectTimer != null) clearTimeout(onReconnectTimer);
  // Coalesce kline HTTP refetches — many panels subscribe; don't stampede REST on open.
  onReconnectTimer = setTimeout(() => {
    onReconnectTimer = null;
    for (const e of klineSubs.values()) {
      for (const h of e.handlers) h.onReconnect?.();
    }
  }, 750);
}

function connect(): void {
  if (ws != null) return;
  const sock = new WebSocket(`${WS_BASE}/ws/chart`);
  ws = sock;
  // Reset activity clocks so we don't immediately force-reconnect with stale timestamps.
  lastAnyMsgAt = 0;
  lastBidAskMsgAt = 0;
  ensureWatchdog();

  sock.onopen = () => {
    if (ws !== sock) return;
    markBackendWsUp();
    const wasReconnect = attempt > 0;
    attempt = 0;
    const now = Date.now();
    lastAnyMsgAt = now;
    // Don't seed lastBidAskMsgAt — require a real bidAskBatch after open.
    for (const e of klineSubs.values()) {
      sock.send(JSON.stringify({ type: 'subscribeKlineStream', data: { symbol: e.symbol, interval: e.interval } }));
    }
    // Always re-send extra tokens on open (even empty clears server filter after reconnect).
    sock.send(JSON.stringify({ type: 'subscribeBidAskTokens', data: { tokenIds: bidAskExtraTokenIds } }));
    if (pingIv != null) clearInterval(pingIv);
    pingIv = setInterval(() => {
      if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: 'ping' }));
    }, 25_000);
    if (wasReconnect) fireOnReconnectDebounced();
  };

  sock.onmessage = (event) => {
    let msg: ChartWsMsg;
    try {
      msg = JSON.parse(event.data as string) as ChartWsMsg;
    } catch {
      return;
    }
    const t = msg?.type;
    noteChartWsMessage(t);
    if (t === 'pong') return;
    if (t === 'bidAskBatch' || t === 'bidAskUpDown') {
      for (const fn of bidAskSubs) fn(msg);
      return;
    }
    if (t === 'klineStreamSnapshot' || t === 'klineStreamUpdate' || t === 'klineStreamDelete') {
      const key = typeof msg.data?.stream === 'string' ? msg.data.stream : null;
      if (!key) return;
      const entry = klineSubs.get(key);
      if (!entry) return;
      for (const h of entry.handlers) h.onMessage(msg);
    }
  };

  sock.onerror = () => {
    try {
      sock.close();
    } catch {
      /* ignore */
    }
  };

  sock.onclose = () => {
    if (ws === sock) ws = null;
    if (pingIv != null) {
      clearInterval(pingIv);
      pingIv = null;
    }
    if (totalSubs() === 0) {
      stopWatchdogIfIdle();
      return;
    }
    if (reconnectTimer != null) return;
    markBackendDownFromWs();
    const delay = backendWsRetryDelayMs(Math.min(30_000, 800 * 2 ** Math.min(attempt, 8)));
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };
}

function teardown(): void {
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (onReconnectTimer != null) {
    clearTimeout(onReconnectTimer);
    onReconnectTimer = null;
  }
  if (pingIv != null) {
    clearInterval(pingIv);
    pingIv = null;
  }
  if (watchdogIv != null) {
    clearInterval(watchdogIv);
    watchdogIv = null;
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityForChartWs);
  }
  attempt = 0;
  lastAnyMsgAt = 0;
  lastBidAskMsgAt = 0;
  if (ws != null) {
    const sock = ws;
    ws = null;
    sock.onclose = null;
    try {
      sock.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Subscribe to a kline stream (symbol + interval) over the shared chart socket.
 * `onMessage` receives raw klineStreamSnapshot/Update/Delete messages already
 * filtered to this stream. Returns an unsubscribe function.
 */
export function subscribeChartKline(symbol: string, interval: string, handlers: ChartKlineHandlers): () => void {
  const sym = symbol.trim();
  const iv = interval.trim();
  if (!sym || !iv) return () => {};
  const key = streamKey(sym, iv);

  let entry = klineSubs.get(key);
  if (!entry) {
    entry = { symbol: sym, interval: iv, handlers: new Set() };
    klineSubs.set(key, entry);
  }
  entry.handlers.add(handlers);

  if (ws == null) {
    connect();
  } else {
    // Re-send subscribe so the server re-snapshots for this subscriber too.
    rawSend({ type: 'subscribeKlineStream', data: { symbol: sym, interval: iv } });
  }

  return () => {
    const e = klineSubs.get(key);
    if (!e) return;
    e.handlers.delete(handlers);
    if (e.handlers.size === 0) {
      klineSubs.delete(key);
      rawSend({ type: 'unsubscribeKlineStream', data: { symbol: sym, interval: iv } });
    }
    if (totalSubs() === 0) teardown();
  };
}

/**
 * Subscribe to bidAsk batches over the shared chart socket. Returns an
 * unsubscribe function.
 */
export function subscribeChartBidAsk(onMessage: (msg: ChartWsMsg) => void): () => void {
  bidAskSubs.add(onMessage);
  if (ws == null) connect();
  else ensureWatchdog();
  return () => {
    bidAskSubs.delete(onMessage);
    if (totalSubs() === 0) teardown();
  };
}

/** Ask polycandles collector to watch these CLOB tokens for live bid/ask. Named sources are unioned. */
export function setChartBidAskExtraTokens(source: string, tokenIds: readonly string[]): void {
  const key = String(source || '').trim() || 'default';
  const next = [...new Set(tokenIds.map((t) => String(t || '').trim()).filter(Boolean))].sort();
  const prevSrc = bidAskExtraSources.get(key);
  if (
    next.length === 0
      ? !prevSrc?.length
      : prevSrc &&
        prevSrc.length === next.length &&
        prevSrc.every((v, i) => v === next[i])
  ) {
    if (next.length === 0) bidAskExtraSources.delete(key);
    return;
  }
  if (next.length === 0) bidAskExtraSources.delete(key);
  else bidAskExtraSources.set(key, next);

  const union = rebuildBidAskExtraUnion();
  const prev = bidAskExtraTokenIds;
  if (prev.length === union.length && prev.every((v, i) => v === union[i])) return;
  bidAskExtraTokenIds = union;
  if (ws == null) {
    if (union.length > 0 || bidAskSubs.size > 0 || klineSubs.size > 0) connect();
    return;
  }
  sendBidAskExtraTokens();
  if (totalSubs() === 0) teardown();
}

onBackendReconnect(() => {
  if (totalSubs() === 0) return;
  if (ws != null) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    return;
  }
  connect();
});
