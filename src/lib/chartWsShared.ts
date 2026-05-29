import { WS_BASE } from './env';

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
let attempt = 0;

const klineSubs = new Map<string, KlineEntry>();
const bidAskSubs = new Set<(msg: ChartWsMsg) => void>();

function totalSubs(): number {
  let n = bidAskSubs.size;
  for (const e of klineSubs.values()) n += e.handlers.size;
  return n;
}

function rawSend(obj: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connect(): void {
  if (ws != null) return;
  const sock = new WebSocket(`${WS_BASE}/ws/chart`);
  ws = sock;

  sock.onopen = () => {
    if (ws !== sock) return;
    const wasReconnect = attempt > 0;
    attempt = 0;
    for (const e of klineSubs.values()) {
      sock.send(JSON.stringify({ type: 'subscribeKlineStream', data: { symbol: e.symbol, interval: e.interval } }));
    }
    if (pingIv != null) clearInterval(pingIv);
    pingIv = setInterval(() => {
      if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: 'ping' }));
    }, 30_000);
    if (wasReconnect) {
      for (const e of klineSubs.values()) {
        for (const h of e.handlers) h.onReconnect?.();
      }
    }
  };

  sock.onmessage = (event) => {
    let msg: ChartWsMsg;
    try {
      msg = JSON.parse(event.data as string) as ChartWsMsg;
    } catch {
      return;
    }
    const t = msg?.type;
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
    if (totalSubs() === 0) return;
    if (reconnectTimer != null) return;
    const delay = Math.min(30_000, 800 * 2 ** Math.min(attempt, 8));
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
  if (pingIv != null) {
    clearInterval(pingIv);
    pingIv = null;
  }
  attempt = 0;
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
  return () => {
    bidAskSubs.delete(onMessage);
    if (totalSubs() === 0) teardown();
  };
}
