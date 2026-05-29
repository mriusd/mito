import { useSyncExternalStore } from 'react';
import {
  normalizeBinanceSpotBook,
  parseBinanceObLevels,
  type BinanceSpotBook,
} from './binanceSpotObImpact';

export const BINANCE_SPOT_OB_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
export type BinanceSpotObAsset = (typeof BINANCE_SPOT_OB_ASSETS)[number];
export type BinanceObMarket = 'spot' | 'futures';

const SYMBOL_BY_ASSET: Record<BinanceSpotObAsset, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
};

const ASSET_BY_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_BY_ASSET).map(([asset, symbol]) => [symbol, asset as BinanceSpotObAsset]),
) as Record<string, BinanceSpotObAsset>;

const WS_STREAM_BASE: Record<BinanceObMarket, string> = {
  spot: 'wss://stream.binance.com:9443/stream',
  futures: 'wss://fstream.binance.com/stream',
};

/** Top-of-book levels from Binance partial depth WS (`@depth20@100ms`). */
const DEPTH_LIMIT = 20;
const EMIT_MS = 250;
const RECONNECT_MS = 5000;

export { DEPTH_LIMIT };

type BooksSnap = Record<BinanceSpotObAsset, BinanceSpotBook | null>;

const EMPTY_BOOKS: BooksSnap = { BTC: null, ETH: null, SOL: null, XRP: null };

type MarketConn = {
  ws: WebSocket | null;
  reconnectTimer: number | null;
  emitTimer: number | null;
  dirty: Set<BinanceSpotObAsset>;
  pending: Partial<Record<BinanceSpotObAsset, BinanceSpotBook>>;
};

function emptyMarketConn(): MarketConn {
  return {
    ws: null,
    reconnectTimer: null,
    emitTimer: null,
    dirty: new Set(),
    pending: {},
  };
}

let booksByMarket: Record<BinanceObMarket, BooksSnap> = {
  spot: { ...EMPTY_BOOKS },
  futures: { ...EMPTY_BOOKS },
};
let digestByMarket: Record<BinanceObMarket, number> = { spot: 0, futures: 0 };
let refCountByMarket: Record<BinanceObMarket, number> = { spot: 0, futures: 0 };
const listenersByMarket: Record<BinanceObMarket, Set<() => void>> = {
  spot: new Set(),
  futures: new Set(),
};

const marketConns: Record<BinanceObMarket, MarketConn> = {
  spot: emptyMarketConn(),
  futures: emptyMarketConn(),
};

function emit(market: BinanceObMarket): void {
  digestByMarket[market] += 1;
  for (const fn of listenersByMarket[market]) fn();
}

function depthStreamName(asset: BinanceSpotObAsset): string {
  return `${SYMBOL_BY_ASSET[asset].toLowerCase()}@depth${DEPTH_LIMIT}@100ms`;
}

function assetFromStream(stream: string): BinanceSpotObAsset | null {
  const symbol = stream.split('@')[0]?.toUpperCase();
  if (!symbol) return null;
  return ASSET_BY_SYMBOL[symbol] ?? null;
}

function parsePartialDepth(raw: unknown): BinanceSpotBook | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as { bids?: unknown; asks?: unknown; b?: unknown; a?: unknown };
  return normalizeBinanceSpotBook(
    parseBinanceObLevels(msg.bids ?? msg.b),
    parseBinanceObLevels(msg.asks ?? msg.a),
  );
}

function flushPending(market: BinanceObMarket): void {
  const conn = marketConns[market];
  conn.emitTimer = null;
  const dirty = [...conn.dirty];
  conn.dirty.clear();
  if (dirty.length === 0) return;

  let nextBooks = booksByMarket[market];
  for (const asset of dirty) {
    const book = conn.pending[asset];
    if (!book) continue;
    nextBooks = { ...nextBooks, [asset]: book };
  }
  booksByMarket = { ...booksByMarket, [market]: nextBooks };
  emit(market);
}

function schedulePublish(market: BinanceObMarket, asset: BinanceSpotObAsset, book: BinanceSpotBook): void {
  const conn = marketConns[market];
  conn.pending[asset] = book;
  conn.dirty.add(asset);
  if (conn.emitTimer != null) return;
  conn.emitTimer = window.setTimeout(() => flushPending(market), EMIT_MS);
}

function wsUrlForMarket(market: BinanceObMarket): string {
  const streams = BINANCE_SPOT_OB_ASSETS.map((asset) => depthStreamName(asset)).join('/');
  return `${WS_STREAM_BASE[market]}?streams=${streams}`;
}

function connectMarket(market: BinanceObMarket): void {
  const conn = marketConns[market];
  if (conn.ws != null) return;

  booksByMarket = { ...booksByMarket, [market]: { ...EMPTY_BOOKS } };
  conn.pending = {};
  conn.dirty.clear();
  emit(market);

  const ws = new WebSocket(wsUrlForMarket(market));
  conn.ws = ws;

  ws.onmessage = (event) => {
    let payload: unknown;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const wrapped = payload as { stream?: unknown; data?: unknown };
    const raw = wrapped.data ?? payload;

    let asset: BinanceSpotObAsset | null = null;
    if (typeof wrapped.stream === 'string') {
      asset = assetFromStream(wrapped.stream);
    }
    if (!asset) {
      const symbol = (raw as { s?: unknown }).s;
      if (typeof symbol === 'string') asset = ASSET_BY_SYMBOL[symbol] ?? null;
    }
    if (!asset) return;

    const book = parsePartialDepth(raw);
    if (!book) return;
    schedulePublish(market, asset, book);
  };

  ws.onerror = () => {
    ws.close();
  };

  ws.onclose = () => {
    conn.ws = null;
    if (refCountByMarket[market] <= 0) return;
    if (conn.reconnectTimer != null) return;
    conn.reconnectTimer = window.setTimeout(() => {
      conn.reconnectTimer = null;
      if (refCountByMarket[market] > 0) connectMarket(market);
    }, RECONNECT_MS);
  };
}

function disconnectMarket(market: BinanceObMarket): void {
  const conn = marketConns[market];
  if (conn.reconnectTimer != null) {
    window.clearTimeout(conn.reconnectTimer);
    conn.reconnectTimer = null;
  }
  if (conn.emitTimer != null) {
    window.clearTimeout(conn.emitTimer);
    conn.emitTimer = null;
  }
  conn.dirty.clear();
  conn.pending = {};
  if (conn.ws != null) {
    conn.ws.onclose = null;
    conn.ws.close();
    conn.ws = null;
  }
}

function subscribeSpot(onStoreChange: () => void): () => void {
  return subscribeBinanceObOrderbooks('spot', onStoreChange);
}

function subscribeFutures(onStoreChange: () => void): () => void {
  return subscribeBinanceObOrderbooks('futures', onStoreChange);
}

function getSpotBooks(): BooksSnap {
  return booksByMarket.spot;
}

function getFuturesBooks(): BooksSnap {
  return booksByMarket.futures;
}

const SUBSCRIBE_BY_MARKET: Record<BinanceObMarket, (onStoreChange: () => void) => () => void> = {
  spot: subscribeSpot,
  futures: subscribeFutures,
};

const GET_BOOKS_BY_MARKET: Record<BinanceObMarket, () => BooksSnap> = {
  spot: getSpotBooks,
  futures: getFuturesBooks,
};

export function subscribeBinanceObOrderbooks(market: BinanceObMarket, onStoreChange: () => void): () => void {
  listenersByMarket[market].add(onStoreChange);
  const prev = refCountByMarket[market];
  refCountByMarket[market] += 1;
  if (prev === 0) connectMarket(market);
  return () => {
    listenersByMarket[market].delete(onStoreChange);
    refCountByMarket[market] -= 1;
    if (refCountByMarket[market] === 0) {
      disconnectMarket(market);
      booksByMarket = { ...booksByMarket, [market]: { ...EMPTY_BOOKS } };
      digestByMarket[market] += 1;
    }
  };
}

export function getBinanceObOrderbooksSnapshot(market: BinanceObMarket): { digest: number; books: BooksSnap } {
  return { digest: digestByMarket[market], books: booksByMarket[market] };
}

export function useBinanceObOrderbooks(market: BinanceObMarket): BooksSnap {
  return useSyncExternalStore(SUBSCRIBE_BY_MARKET[market], GET_BOOKS_BY_MARKET[market], () => EMPTY_BOOKS);
}
