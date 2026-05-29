import { useSyncExternalStore } from 'react';
import { WS_BASE } from './env';
import { SPOT_OB_MOVE_PCT_LEVELS } from './binanceSpotObImpact';

export const BINANCE_SPOT_OB_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
export type BinanceSpotObAsset = (typeof BINANCE_SPOT_OB_ASSETS)[number];
export type BinanceObMarket = 'spot' | 'futures';

export const DEPTH_LIMIT = 1000;

export function binanceObDepthLimit(_market: BinanceObMarket): number {
  return DEPTH_LIMIT;
}

export type BinanceObImpactCell = {
  pct: number;
  usd: number;
  capped: boolean;
};

export type BinanceObAssetPanel = {
  mid: number | null;
  up: BinanceObImpactCell[];
  down: BinanceObImpactCell[];
};

export type BinanceObPanelSnapshot = {
  market: BinanceObMarket;
  synced: boolean;
  wsLive: boolean;
  assets: Record<BinanceSpotObAsset, BinanceObAssetPanel | null>;
  updatedAt: number;
};

export type BinanceObFeedStatus = {
  hasBook: boolean;
  wsLive: boolean;
  allSynced: boolean;
  wsAgeSec: number | null;
  bookAgeSec: number | null;
};

const EMPTY_PANELS: Record<BinanceSpotObAsset, BinanceObAssetPanel | null> = {
  BTC: null,
  ETH: null,
  SOL: null,
  XRP: null,
};

type MarketState = {
  snap: BinanceObPanelSnapshot | null;
  digest: number;
  ws: WebSocket | null;
  reconnectTimer: number | null;
  refCount: number;
};

const marketState: Record<BinanceObMarket, MarketState> = {
  spot: { snap: null, digest: 0, ws: null, reconnectTimer: null, refCount: 0 },
  futures: { snap: null, digest: 0, ws: null, reconnectTimer: null, refCount: 0 },
};

const listenersByMarket: Record<BinanceObMarket, Set<() => void>> = {
  spot: new Set(),
  futures: new Set(),
};

function emit(market: BinanceObMarket): void {
  for (const fn of listenersByMarket[market]) fn();
}

function panelHasBook(panel: BinanceObAssetPanel | null): boolean {
  return panel != null && panel.mid != null && panel.up.length > 0 && panel.down.length > 0;
}

function parsePanelSnapshot(raw: unknown): BinanceObPanelSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as {
    market?: unknown;
    synced?: unknown;
    wsLive?: unknown;
    updatedAt?: unknown;
    assets?: unknown;
  };
  const market = data.market === 'futures' ? 'futures' : data.market === 'spot' ? 'spot' : null;
  if (!market) return null;
  const assetsIn = data.assets;
  if (!assetsIn || typeof assetsIn !== 'object') return null;

  const assets = { ...EMPTY_PANELS };
  for (const asset of BINANCE_SPOT_OB_ASSETS) {
    const row = (assetsIn as Record<string, unknown>)[asset];
    if (!row || typeof row !== 'object') continue;
    const r = row as { mid?: unknown; up?: unknown; down?: unknown };
    const mid = typeof r.mid === 'number' && Number.isFinite(r.mid) ? r.mid : null;
    const parseCells = (rawCells: unknown): BinanceObImpactCell[] => {
      if (!Array.isArray(rawCells)) return [];
      const out: BinanceObImpactCell[] = [];
      for (const c of rawCells) {
        if (!c || typeof c !== 'object') continue;
        const cell = c as { pct?: unknown; usd?: unknown; capped?: unknown };
        const pct = Number(cell.pct);
        const usd = Number(cell.usd);
        if (!Number.isFinite(pct) || !Number.isFinite(usd) || usd <= 0) continue;
        out.push({ pct, usd, capped: cell.capped === true });
      }
      return out;
    };
    assets[asset] = { mid, up: parseCells(r.up), down: parseCells(r.down) };
  }

  return {
    market,
    synced: data.synced === true,
    wsLive: data.wsLive === true,
    assets,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
  };
}

function applySnapshot(market: BinanceObMarket, snap: BinanceObPanelSnapshot): void {
  const st = marketState[market];
  st.snap = snap;
  st.digest += 1;
  emit(market);
}

function connectMarket(market: BinanceObMarket): void {
  const st = marketState[market];
  if (st.ws != null) return;

  const ws = new WebSocket(`${WS_BASE}/ws/binance-orderbook?market=${market}`);
  st.ws = ws;

  ws.onmessage = (event) => {
    let payload: unknown;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const msg = payload as { type?: unknown; data?: unknown };
    if (msg.type !== 'binanceOrderbook') return;
    const snap = parsePanelSnapshot(msg.data);
    if (!snap || snap.market !== market) return;
    applySnapshot(market, snap);
  };

  ws.onclose = () => {
    st.ws = null;
    if (st.refCount <= 0) return;
    if (st.reconnectTimer != null) return;
    st.reconnectTimer = window.setTimeout(() => {
      st.reconnectTimer = null;
      if (st.refCount > 0) connectMarket(market);
    }, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function disconnectMarket(market: BinanceObMarket): void {
  const st = marketState[market];
  if (st.reconnectTimer != null) {
    window.clearTimeout(st.reconnectTimer);
    st.reconnectTimer = null;
  }
  if (st.ws != null) {
    st.ws.onclose = null;
    st.ws.close();
    st.ws = null;
  }
  st.snap = null;
  st.digest += 1;
  emit(market);
}

function subscribeMarket(market: BinanceObMarket, onStoreChange: () => void): () => void {
  listenersByMarket[market].add(onStoreChange);
  const st = marketState[market];
  st.refCount += 1;
  if (st.refCount === 1) connectMarket(market);
  return () => {
    listenersByMarket[market].delete(onStoreChange);
    st.refCount -= 1;
    if (st.refCount === 0) disconnectMarket(market);
  };
}

export function getBinanceObFeedStatus(market: BinanceObMarket): BinanceObFeedStatus {
  const snap = marketState[market].snap;
  const now = Date.now();
  if (!snap) {
    return { hasBook: false, wsLive: false, allSynced: false, wsAgeSec: null, bookAgeSec: null };
  }
  let hasBook = false;
  for (const asset of BINANCE_SPOT_OB_ASSETS) {
    if (panelHasBook(snap.assets[asset])) hasBook = true;
  }
  const bookAgeSec = snap.updatedAt > 0 ? Math.max(0, Math.round((now - snap.updatedAt) / 1000)) : null;
  return {
    hasBook,
    wsLive: snap.wsLive,
    allSynced: snap.synced && hasBook,
    wsAgeSec: snap.wsLive ? 0 : bookAgeSec,
    bookAgeSec,
  };
}

export function getBinanceObPanelSnapshot(market: BinanceObMarket): BinanceObPanelSnapshot | null {
  return marketState[market].snap;
}

export function useBinanceObFeedStatus(market: BinanceObMarket): BinanceObFeedStatus {
  useSyncExternalStore(
    (cb) => subscribeMarket(market, cb),
    () => marketState[market].digest,
    () => 0,
  );
  return getBinanceObFeedStatus(market);
}

export function useBinanceObPanels(market: BinanceObMarket): Record<BinanceSpotObAsset, BinanceObAssetPanel | null> {
  useSyncExternalStore(
    (cb) => subscribeMarket(market, cb),
    () => marketState[market].digest,
    () => 0,
  );
  return marketState[market].snap?.assets ?? EMPTY_PANELS;
}

export { SPOT_OB_MOVE_PCT_LEVELS };
