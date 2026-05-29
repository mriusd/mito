import { useSyncExternalStore } from 'react';
import { API_BASE } from './env';
import {
  normalizeBinanceSpotBook,
  parseBinanceObLevels,
  type BinanceObLevel,
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

function futuresDepthUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return '/api/binance-proxy/futures/v1/depth';
    }
  }
  return `${API_BASE}/api/binance-proxy/futures/v1/depth`;
}

const REST_DEPTH_URL: Record<BinanceObMarket, string> = {
  spot: 'https://api.binance.com/api/v3/depth',
  futures: futuresDepthUrl(),
};

const WS_STREAM_BASE: Record<BinanceObMarket, string> = {
  spot: 'wss://stream.binance.com:9443/stream',
  futures: 'wss://fstream.binance.com/stream',
};

/** Binance REST only accepts 5/10/20/50/100/500/1000. */
const SNAPSHOT_LIMIT = 500;

const EMIT_MS = 250;
const RECONNECT_MS = 5000;
const SNAPSHOT_GAP_MS = 500;
const RESYNC_BACKOFF_MS = 60_000;

export const DEPTH_LIMIT = SNAPSHOT_LIMIT;

export function binanceObDepthLimit(_market: BinanceObMarket): number {
  return SNAPSHOT_LIMIT;
}

type BooksSnap = Record<BinanceSpotObAsset, BinanceSpotBook | null>;

const EMPTY_BOOKS: BooksSnap = { BTC: null, ETH: null, SOL: null, XRP: null };

type DepthEvent = { U: number; u: number; bids: BinanceObLevel[]; asks: BinanceObLevel[] };

type DepthSnapshot = { lastUpdateId: number; bids: BinanceObLevel[]; asks: BinanceObLevel[] };

type AssetBookState = {
  bids: Map<number, number>;
  asks: Map<number, number>;
  lastUpdateId: number;
  synced: boolean;
  pending: DepthEvent[];
  snapshotLoading: boolean;
  lastResyncAt: number;
};

type MarketConn = {
  ws: WebSocket | null;
  reconnectTimer: number | null;
  emitTimer: number | null;
  connectGen: number;
  dirty: Set<BinanceSpotObAsset>;
  assets: Record<BinanceSpotObAsset, AssetBookState>;
};

function emptyAssetState(): AssetBookState {
  return {
    bids: new Map(),
    asks: new Map(),
    lastUpdateId: 0,
    synced: false,
    pending: [],
    snapshotLoading: false,
    lastResyncAt: 0,
  };
}

function emptyMarketConn(): MarketConn {
  return {
    ws: null,
    reconnectTimer: null,
    emitTimer: null,
    connectGen: 0,
    dirty: new Set(),
    assets: {
      BTC: emptyAssetState(),
      ETH: emptyAssetState(),
      SOL: emptyAssetState(),
      XRP: emptyAssetState(),
    },
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

function diffStreamName(asset: BinanceSpotObAsset): string {
  return `${SYMBOL_BY_ASSET[asset].toLowerCase()}@depth@100ms`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseDiffDepth(raw: unknown): (DepthEvent & { symbol: string }) | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as { s?: unknown; U?: unknown; u?: unknown; b?: unknown; a?: unknown };
  const symbol = msg.s;
  const U = Number(msg.U);
  const u = Number(msg.u);
  if (typeof symbol !== 'string' || !Number.isFinite(U) || !Number.isFinite(u)) return null;
  return {
    symbol,
    U,
    u,
    bids: parseBinanceObLevels(msg.b),
    asks: parseBinanceObLevels(msg.a),
  };
}

function applyLevels(map: Map<number, number>, levels: BinanceObLevel[]): void {
  for (const level of levels) {
    if (level.qty === 0) map.delete(level.price);
    else map.set(level.price, level.qty);
  }
}

function applyEventToState(state: AssetBookState, event: DepthEvent): void {
  applyLevels(state.bids, event.bids);
  applyLevels(state.asks, event.asks);
  state.lastUpdateId = event.u;
}

function stateToBook(state: AssetBookState): BinanceSpotBook | null {
  const bids: BinanceObLevel[] = [...state.bids.entries()]
    .map(([price, qty]) => ({ price, qty }))
    .sort((a, b) => b.price - a.price)
    .slice(0, SNAPSHOT_LIMIT);
  const asks: BinanceObLevel[] = [...state.asks.entries()]
    .map(([price, qty]) => ({ price, qty }))
    .sort((a, b) => a.price - b.price)
    .slice(0, SNAPSHOT_LIMIT);
  return normalizeBinanceSpotBook(bids, asks);
}

function publishAssetState(market: BinanceObMarket, asset: BinanceSpotObAsset, state: AssetBookState): void {
  const next = stateToBook(state);
  if (!next) return;
  booksByMarket = { ...booksByMarket, [market]: { ...booksByMarket[market], [asset]: next } };
  emit(market);
}

function schedulePublish(market: BinanceObMarket, asset: BinanceSpotObAsset): void {
  const conn = marketConns[market];
  conn.dirty.add(asset);
  if (conn.emitTimer != null) return;
  conn.emitTimer = window.setTimeout(() => {
    conn.emitTimer = null;
    const dirty = [...conn.dirty];
    conn.dirty.clear();
    for (const a of dirty) {
      const st = conn.assets[a];
      if (!st.synced) continue;
      publishAssetState(market, a, st);
    }
  }, EMIT_MS);
}

function resetAssetState(state: AssetBookState): void {
  state.bids.clear();
  state.asks.clear();
  state.lastUpdateId = 0;
  state.synced = false;
  state.pending = [];
  state.snapshotLoading = false;
}

async function fetchSnapshot(market: BinanceObMarket, asset: BinanceSpotObAsset): Promise<DepthSnapshot> {
  const symbol = SYMBOL_BY_ASSET[asset];
  const resp = await fetch(`${REST_DEPTH_URL[market]}?symbol=${symbol}&limit=${SNAPSHOT_LIMIT}`);
  if (!resp.ok) {
    throw new Error(`Binance ${market} depth snapshot ${symbol} HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as { lastUpdateId?: unknown; bids?: unknown; asks?: unknown };
  const lastUpdateId = Number(data.lastUpdateId);
  if (!Number.isFinite(lastUpdateId)) {
    throw new Error(`Binance ${market} depth snapshot ${symbol} missing lastUpdateId`);
  }
  return {
    lastUpdateId,
    bids: parseBinanceObLevels(data.bids),
    asks: parseBinanceObLevels(data.asks),
  };
}

function syncAssetFromSnapshot(market: BinanceObMarket, asset: BinanceSpotObAsset, snap: DepthSnapshot): void {
  const state = marketConns[market].assets[asset];
  const pending = state.pending.filter((e) => e.u > snap.lastUpdateId);
  if (pending.length > 0 && pending[0]!.U > snap.lastUpdateId + 1) {
    return;
  }

  state.bids = new Map(snap.bids.map((l) => [l.price, l.qty]));
  state.asks = new Map(snap.asks.map((l) => [l.price, l.qty]));
  state.lastUpdateId = snap.lastUpdateId;

  for (const event of pending) {
    if (event.u <= state.lastUpdateId) continue;
    if (event.U > state.lastUpdateId + 1) {
      resetAssetState(state);
      state.pending = pending.slice(pending.indexOf(event));
      return;
    }
    applyEventToState(state, event);
  }

  state.pending = [];
  state.synced = true;
  publishAssetState(market, asset, state);
}

async function loadSnapshot(market: BinanceObMarket, asset: BinanceSpotObAsset, connectGen: number): Promise<void> {
  const state = marketConns[market].assets[asset];
  if (state.synced || state.snapshotLoading) return;
  state.snapshotLoading = true;
  try {
    const snap = await fetchSnapshot(market, asset);
    if (refCountByMarket[market] <= 0 || connectGen !== marketConns[market].connectGen) return;
    syncAssetFromSnapshot(market, asset, snap);
  } catch (err) {
    console.error(`binance ${market} ob snapshot ${asset}:`, err);
  } finally {
    state.snapshotLoading = false;
  }
}

async function loadAllSnapshots(market: BinanceObMarket, connectGen: number): Promise<void> {
  for (const asset of BINANCE_SPOT_OB_ASSETS) {
    if (refCountByMarket[market] <= 0 || connectGen !== marketConns[market].connectGen) return;
    await loadSnapshot(market, asset, connectGen);
    if (BINANCE_SPOT_OB_ASSETS.indexOf(asset) < BINANCE_SPOT_OB_ASSETS.length - 1) {
      await sleep(SNAPSHOT_GAP_MS);
    }
  }
}

function requestResync(market: BinanceObMarket, asset: BinanceSpotObAsset, connectGen: number): void {
  const state = marketConns[market].assets[asset];
  const now = Date.now();
  if (state.snapshotLoading || now - state.lastResyncAt < RESYNC_BACKOFF_MS) return;
  state.lastResyncAt = now;
  void loadSnapshot(market, asset, connectGen);
}

function onDiffMessage(
  market: BinanceObMarket,
  asset: BinanceSpotObAsset,
  event: DepthEvent,
  connectGen: number,
): void {
  const state = marketConns[market].assets[asset];
  if (!state.synced) {
    state.pending.push(event);
    return;
  }

  if (event.u <= state.lastUpdateId) return;
  if (event.U > state.lastUpdateId + 1) {
    resetAssetState(state);
    state.pending = [event];
    requestResync(market, asset, connectGen);
    return;
  }

  applyEventToState(state, event);
  schedulePublish(market, asset);
}

function wsUrlForMarket(market: BinanceObMarket): string {
  const streams = BINANCE_SPOT_OB_ASSETS.map((asset) => diffStreamName(asset)).join('/');
  return `${WS_STREAM_BASE[market]}?streams=${streams}`;
}

function connectMarket(market: BinanceObMarket): void {
  const conn = marketConns[market];
  if (conn.ws != null) return;

  conn.connectGen += 1;
  const connectGen = conn.connectGen;

  booksByMarket = { ...booksByMarket, [market]: { ...EMPTY_BOOKS } };
  emit(market);

  for (const asset of BINANCE_SPOT_OB_ASSETS) {
    resetAssetState(conn.assets[asset]);
  }

  const ws = new WebSocket(wsUrlForMarket(market));
  conn.ws = ws;

  ws.onmessage = (event) => {
    let payload: unknown;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const wrapped = payload as { data?: unknown };
    const raw = wrapped.data ?? payload;
    const diff = parseDiffDepth(raw);
    if (!diff) return;
    const asset = ASSET_BY_SYMBOL[diff.symbol];
    if (!asset) return;
    onDiffMessage(market, asset, diff, connectGen);
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

  void loadAllSnapshots(market, connectGen);
}

function disconnectMarket(market: BinanceObMarket): void {
  const conn = marketConns[market];
  conn.connectGen += 1;
  if (conn.reconnectTimer != null) {
    window.clearTimeout(conn.reconnectTimer);
    conn.reconnectTimer = null;
  }
  if (conn.emitTimer != null) {
    window.clearTimeout(conn.emitTimer);
    conn.emitTimer = null;
  }
  conn.dirty.clear();
  if (conn.ws != null) {
    conn.ws.onclose = null;
    conn.ws.close();
    conn.ws = null;
  }
  for (const asset of BINANCE_SPOT_OB_ASSETS) {
    resetAssetState(conn.assets[asset]);
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
