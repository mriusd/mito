import { useSyncExternalStore } from 'react';
import { API_BASE } from './env';
import {
  normalizeBinanceSpotBook,
  parseBinanceObLevels,
  type BinanceObLevel,
  type BinanceSpotBook,
} from './binanceSpotObImpact';

/** Same backend as other polycandles REST calls; dev defaults to data.mito.trade when API_BASE is empty. */
const POLYCANDLES_API = API_BASE || 'https://data.mito.trade';

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

const REST_DEPTH_URL: Record<BinanceObMarket, string> = {
  spot: `${POLYCANDLES_API}/api/binance-proxy/spot/v3/depth`,
  futures: `${POLYCANDLES_API}/api/binance-proxy/futures/v1/depth`,
};

const WS_STREAM_BASE: Record<BinanceObMarket, string> = {
  spot: 'wss://stream.binance.com:9443/stream',
  futures: 'wss://fstream.binance.com/stream',
};

/** Binance REST only accepts 5/10/20/50/100/500/1000. */
const SNAPSHOT_LIMIT = 500;

const EMIT_MS = 250;
const RECONNECT_MS = 5000;
const SNAPSHOT_RETRY_MS = 300;
const RESYNC_BACKOFF_MS = 10_000;
const WS_STALE_MS = 4000;
const MAX_SNAPSHOT_ATTEMPTS = 8;

export const DEPTH_LIMIT = SNAPSHOT_LIMIT;

export function binanceObDepthLimit(_market: BinanceObMarket): number {
  return SNAPSHOT_LIMIT;
}

export type BinanceObFeedStatus = {
  hasBook: boolean;
  wsLive: boolean;
  allSynced: boolean;
  wsAgeSec: number | null;
  bookAgeSec: number | null;
};

type BooksSnap = Record<BinanceSpotObAsset, BinanceSpotBook | null>;

const EMPTY_BOOKS: BooksSnap = { BTC: null, ETH: null, SOL: null, XRP: null };

type DepthEvent = { U: number; u: number; pu: number | null; bids: BinanceObLevel[]; asks: BinanceObLevel[] };

type DepthSnapshot = { lastUpdateId: number; bids: BinanceObLevel[]; asks: BinanceObLevel[] };

type AssetBookState = {
  bids: Map<number, number>;
  asks: Map<number, number>;
  lastUpdateId: number;
  synced: boolean;
  pending: DepthEvent[];
  snapshotLoading: boolean;
  snapshotAttempts: number;
  lastResyncAt: number;
};

type MarketConn = {
  ws: WebSocket | null;
  reconnectTimer: number | null;
  emitTimer: number | null;
  wsWatchTimer: number | null;
  wsLastMessageAt: number;
  connectGen: number;
  connecting: boolean;
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
    snapshotAttempts: 0,
    lastResyncAt: 0,
  };
}

function emptyMarketConn(): MarketConn {
  return {
    ws: null,
    reconnectTimer: null,
    emitTimer: null,
    wsWatchTimer: null,
    wsLastMessageAt: 0,
    connectGen: 0,
    connecting: false,
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
let statusDigestByMarket: Record<BinanceObMarket, number> = { spot: 0, futures: 0 };
let wsLastMessageAtByMarket: Record<BinanceObMarket, number> = { spot: 0, futures: 0 };
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

function emitStatus(market: BinanceObMarket): void {
  statusDigestByMarket[market] += 1;
  for (const fn of listenersByMarket[market]) fn();
}

function markWsMessage(market: BinanceObMarket): void {
  const now = Date.now();
  wsLastMessageAtByMarket[market] = now;
  marketConns[market].wsLastMessageAt = now;
  emitStatus(market);
}

function diffHasGap(market: BinanceObMarket, state: AssetBookState, event: DepthEvent): boolean {
  if (event.u <= state.lastUpdateId) return false;
  if (market === 'futures') {
    if (event.pu != null && event.pu !== state.lastUpdateId) return true;
    return event.U > state.lastUpdateId + 1;
  }
  return event.U > state.lastUpdateId + 1;
}

function diffStreamName(asset: BinanceSpotObAsset): string {
  return `${SYMBOL_BY_ASSET[asset].toLowerCase()}@depth@100ms`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseDiffDepth(raw: unknown): (DepthEvent & { symbol: string }) | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as { s?: unknown; U?: unknown; u?: unknown; pu?: unknown; b?: unknown; a?: unknown };
  const symbol = msg.s;
  const U = Number(msg.U);
  const u = Number(msg.u);
  const puRaw = msg.pu;
  const pu = puRaw == null ? null : Number(puRaw);
  if (typeof symbol !== 'string' || !Number.isFinite(U) || !Number.isFinite(u)) return null;
  return {
    symbol,
    U,
    u,
    pu: pu != null && Number.isFinite(pu) ? pu : null,
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
  state.snapshotAttempts = 0;
}

async function fetchSnapshot(market: BinanceObMarket, asset: BinanceSpotObAsset): Promise<DepthSnapshot> {
  const symbol = SYMBOL_BY_ASSET[asset];
  const resp = await fetch(`${REST_DEPTH_URL[market]}?symbol=${symbol}&limit=${SNAPSHOT_LIMIT}`, {
    cache: 'no-store',
  });
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

function scheduleSnapshotRetry(
  market: BinanceObMarket,
  asset: BinanceSpotObAsset,
  connectGen: number,
): void {
  const state = marketConns[market].assets[asset];
  if (state.synced || state.snapshotLoading) return;
  if (state.snapshotAttempts >= MAX_SNAPSHOT_ATTEMPTS) return;
  window.setTimeout(() => {
    if (connectGen !== marketConns[market].connectGen || refCountByMarket[market] <= 0) return;
    void loadSnapshot(market, asset, connectGen);
  }, SNAPSHOT_RETRY_MS);
}

function syncAssetFromSnapshot(
  market: BinanceObMarket,
  asset: BinanceSpotObAsset,
  snap: DepthSnapshot,
  connectGen: number,
): void {
  const state = marketConns[market].assets[asset];
  const pending = state.pending.filter((e) => e.u > snap.lastUpdateId);
  if (pending.length > 0 && pending[0]!.U > snap.lastUpdateId + 1) {
    scheduleSnapshotRetry(market, asset, connectGen);
    return;
  }

  state.bids = new Map(snap.bids.map((l) => [l.price, l.qty]));
  state.asks = new Map(snap.asks.map((l) => [l.price, l.qty]));
  state.lastUpdateId = snap.lastUpdateId;

  for (const event of pending) {
    if (event.u <= state.lastUpdateId) continue;
    if (diffHasGap(market, state, event)) {
      resetAssetState(state);
      state.pending = pending.slice(pending.indexOf(event));
      scheduleSnapshotRetry(market, asset, connectGen);
      return;
    }
    applyEventToState(state, event);
  }

  state.pending = [];
  state.synced = true;
  state.snapshotAttempts = 0;
  publishAssetState(market, asset, state);
}

async function loadSnapshot(market: BinanceObMarket, asset: BinanceSpotObAsset, connectGen: number): Promise<void> {
  const state = marketConns[market].assets[asset];
  if (state.synced || state.snapshotLoading) return;
  state.snapshotLoading = true;
  state.snapshotAttempts += 1;
  try {
    const snap = await fetchSnapshot(market, asset);
    if (refCountByMarket[market] <= 0 || connectGen !== marketConns[market].connectGen) return;
    syncAssetFromSnapshot(market, asset, snap, connectGen);
  } catch (err) {
    console.error(`binance ${market} ob snapshot ${asset}:`, err);
    scheduleSnapshotRetry(market, asset, connectGen);
  } finally {
    state.snapshotLoading = false;
  }
}

async function loadAllSnapshots(market: BinanceObMarket, connectGen: number): Promise<void> {
  await Promise.all(BINANCE_SPOT_OB_ASSETS.map((asset) => loadSnapshot(market, asset, connectGen)));
}

function requestResync(market: BinanceObMarket, asset: BinanceSpotObAsset, connectGen: number): void {
  const state = marketConns[market].assets[asset];
  const now = Date.now();
  if (state.snapshotLoading || now - state.lastResyncAt < RESYNC_BACKOFF_MS) return;
  state.lastResyncAt = now;
  state.snapshotAttempts = 0;
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
  if (diffHasGap(market, state, event)) {
    resetAssetState(state);
    state.pending = [event];
    requestResync(market, asset, connectGen);
    return;
  }

  applyEventToState(state, event);
  schedulePublish(market, asset);
}

function stopWsWatch(market: BinanceObMarket): void {
  const conn = marketConns[market];
  if (conn.wsWatchTimer != null) {
    window.clearInterval(conn.wsWatchTimer);
    conn.wsWatchTimer = null;
  }
}

function forceWsReconnect(market: BinanceObMarket): void {
  const conn = marketConns[market];
  if (conn.ws == null) return;
  conn.ws.onclose = null;
  conn.ws.close();
  conn.ws = null;
  stopWsWatch(market);
  connectMarket(market);
}

function startWsWatch(market: BinanceObMarket): void {
  const conn = marketConns[market];
  stopWsWatch(market);
  conn.wsWatchTimer = window.setInterval(() => {
    if (refCountByMarket[market] <= 0 || conn.ws == null) return;
    const last = conn.wsLastMessageAt;
    if (last <= 0) return;
    if (Date.now() - last > WS_STALE_MS) {
      forceWsReconnect(market);
    }
  }, 1000);
}

function wsUrlForMarket(market: BinanceObMarket): string {
  const streams = BINANCE_SPOT_OB_ASSETS.map((asset) => diffStreamName(asset)).join('/');
  return `${WS_STREAM_BASE[market]}?streams=${streams}`;
}

function openDepthWs(market: BinanceObMarket, connectGen: number): void {
  const conn = marketConns[market];
  if (conn.ws != null || refCountByMarket[market] <= 0 || connectGen !== conn.connectGen) return;

  const ws = new WebSocket(wsUrlForMarket(market));
  conn.ws = ws;

  ws.onopen = () => {
    startWsWatch(market);
  };

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
    markWsMessage(market);
    onDiffMessage(market, asset, diff, connectGen);
  };

  ws.onerror = () => {
    ws.close();
  };

  ws.onclose = () => {
    conn.ws = null;
    stopWsWatch(market);
    wsLastMessageAtByMarket[market] = 0;
    conn.wsLastMessageAt = 0;
    emitStatus(market);
    if (refCountByMarket[market] <= 0) return;
    if (conn.reconnectTimer != null) return;
    conn.reconnectTimer = window.setTimeout(() => {
      conn.reconnectTimer = null;
      if (refCountByMarket[market] > 0) connectMarket(market);
    }, RECONNECT_MS);
  };
}

function connectMarket(market: BinanceObMarket): void {
  const conn = marketConns[market];
  if (conn.ws != null || conn.connecting) return;

  conn.connectGen += 1;
  const connectGen = conn.connectGen;
  conn.connecting = true;

  booksByMarket = { ...booksByMarket, [market]: { ...EMPTY_BOOKS } };
  emit(market);

  for (const asset of BINANCE_SPOT_OB_ASSETS) {
    resetAssetState(conn.assets[asset]);
  }

  void (async () => {
    try {
      await loadAllSnapshots(market, connectGen);
      if (refCountByMarket[market] <= 0 || connectGen !== conn.connectGen) return;
      openDepthWs(market, connectGen);
    } finally {
      if (connectGen === conn.connectGen) conn.connecting = false;
    }
  })();
}

function disconnectMarket(market: BinanceObMarket): void {
  const conn = marketConns[market];
  conn.connectGen += 1;
  conn.connecting = false;
  stopWsWatch(market);
  wsLastMessageAtByMarket[market] = 0;
  conn.wsLastMessageAt = 0;
  emitStatus(market);
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
      statusDigestByMarket[market] += 1;
    }
  };
}

export function getBinanceObOrderbooksSnapshot(market: BinanceObMarket): { digest: number; books: BooksSnap } {
  return { digest: digestByMarket[market], books: booksByMarket[market] };
}

export function getBinanceObFeedStatus(market: BinanceObMarket): BinanceObFeedStatus {
  const books = booksByMarket[market];
  const conn = marketConns[market];
  let maxBookAt = 0;
  let allSynced = true;
  let hasBook = false;
  for (const asset of BINANCE_SPOT_OB_ASSETS) {
    const book = books[asset];
    const st = conn.assets[asset];
    if (book) hasBook = true;
    if (!st.synced) allSynced = false;
    const t = book?.updatedAt ?? 0;
    if (t > maxBookAt) maxBookAt = t;
  }
  const wsAt = conn.wsLastMessageAt;
  const now = Date.now();
  const wsAgeSec = wsAt > 0 ? Math.max(0, Math.round((now - wsAt) / 1000)) : null;
  const bookAgeSec = maxBookAt > 0 ? Math.max(0, Math.round((now - maxBookAt) / 1000)) : null;
  const wsLive = wsAt > 0 && now - wsAt <= WS_STALE_MS;
  return { hasBook, wsLive, allSynced, wsAgeSec, bookAgeSec };
}

function getStatusDigest(market: BinanceObMarket): number {
  return statusDigestByMarket[market] + digestByMarket[market];
}

export function useBinanceObFeedStatus(market: BinanceObMarket): BinanceObFeedStatus {
  useSyncExternalStore(
    SUBSCRIBE_BY_MARKET[market],
    () => getStatusDigest(market),
    () => 0,
  );
  return getBinanceObFeedStatus(market);
}

export function useBinanceObOrderbooks(market: BinanceObMarket): BooksSnap {
  useSyncExternalStore(
    SUBSCRIBE_BY_MARKET[market],
    () => getStatusDigest(market),
    () => 0,
  );
  return GET_BOOKS_BY_MARKET[market]();
}
