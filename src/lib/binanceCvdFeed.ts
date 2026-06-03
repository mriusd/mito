import { useLayoutEffect, useSyncExternalStore } from 'react';

export const CVD_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
export type CvdAsset = (typeof CVD_ASSETS)[number];

const BINANCE_SYMBOLS: Record<CvdAsset, string> = {
  BTC: 'btcusdt',
  ETH: 'ethusdt',
  SOL: 'solusdt',
  XRP: 'xrpusdt',
};

const BAR_MS = 5000;
const MAX_BARS = 360;

export type CvdBar = {
  t: number;
  buyUsd: number;
  sellUsd: number;
  deltaUsd: number;
  cumDeltaUsd: number;
  tradeCount: number;
};

export type CvdAssetSnapshot = {
  asset: string;
  spot: number;
  cumDeltaUsd: number;
  bars: CvdBar[];
  updatedAt: number;
};

export type CvdPanelSnapshot = {
  assets: Partial<Record<CvdAsset, CvdAssetSnapshot | null>>;
  updatedAt: number;
};

type AssetState = {
  spot: number;
  cumDeltaUsd: number;
  curBucket: number;
  cur: CvdBar;
  bars: CvdBar[];
};

type FeedState = {
  snap: CvdPanelSnapshot | null;
  connected: boolean;
  digest: number;
  ws: WebSocket | null;
  reconnectTimer: number | null;
  refCount: number;
  byAsset: Record<CvdAsset, AssetState>;
  bucketTimer: number | null;
};

function emptyAssetState(): AssetState {
  return {
    spot: 0,
    cumDeltaUsd: 0,
    curBucket: 0,
    cur: { t: 0, buyUsd: 0, sellUsd: 0, deltaUsd: 0, cumDeltaUsd: 0, tradeCount: 0 },
    bars: [],
  };
}

const state: FeedState = {
  snap: null,
  connected: false,
  digest: 0,
  ws: null,
  reconnectTimer: null,
  refCount: 0,
  byAsset: {
    BTC: emptyAssetState(),
    ETH: emptyAssetState(),
    SOL: emptyAssetState(),
    XRP: emptyAssetState(),
  },
  bucketTimer: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function bucketOpen(tsMs: number): number {
  return Math.floor(tsMs / BAR_MS) * BAR_MS;
}

function rollAsset(st: AssetState, nowBucket: number): void {
  if (st.curBucket === 0) {
    st.curBucket = nowBucket;
    st.cur = { t: nowBucket, buyUsd: 0, sellUsd: 0, deltaUsd: 0, cumDeltaUsd: 0, tradeCount: 0 };
    return;
  }
  if (nowBucket <= st.curBucket) return;
  st.cur.deltaUsd = st.cur.buyUsd - st.cur.sellUsd;
  st.cumDeltaUsd += st.cur.deltaUsd;
  st.cur.cumDeltaUsd = st.cumDeltaUsd;
  st.bars.push({ ...st.cur });
  if (st.bars.length > MAX_BARS) st.bars = st.bars.slice(-MAX_BARS);
  st.curBucket = nowBucket;
  st.cur = { t: nowBucket, buyUsd: 0, sellUsd: 0, deltaUsd: 0, cumDeltaUsd: 0, tradeCount: 0 };
}

function buildSnapshot(): CvdPanelSnapshot {
  const assets: CvdPanelSnapshot['assets'] = {};
  const updatedAt = Date.now();
  for (const asset of CVD_ASSETS) {
    const st = state.byAsset[asset];
    const bars = [...st.bars];
    if (st.curBucket > 0) {
      const cur = { ...st.cur };
      cur.deltaUsd = cur.buyUsd - cur.sellUsd;
      cur.cumDeltaUsd = st.cumDeltaUsd + cur.deltaUsd;
      bars.push(cur);
    }
    assets[asset] = {
      asset,
      spot: st.spot,
      cumDeltaUsd: bars.length > 0 ? bars[bars.length - 1]!.cumDeltaUsd : st.cumDeltaUsd,
      bars,
      updatedAt,
    };
  }
  return { assets, updatedAt };
}

function publish(): void {
  state.snap = buildSnapshot();
  state.digest += 1;
  emit();
}

function onAggTrade(asset: CvdAsset, price: number, qty: number, buyerIsMaker: boolean, tsMs: number): void {
  if (price <= 0 || qty <= 0) return;
  const usd = price * qty;
  if (usd <= 0) return;
  const st = state.byAsset[asset];
  const bucket = bucketOpen(tsMs);
  st.spot = price;
  rollAsset(st, bucket);
  if (buyerIsMaker) st.cur.sellUsd += usd;
  else st.cur.buyUsd += usd;
  st.cur.tradeCount += 1;
  publish();
}

function handleMessage(raw: string): void {
  let env: { stream?: string; data?: Record<string, unknown> };
  try {
    env = JSON.parse(raw);
  } catch {
    return;
  }
  const data = env.data;
  if (!data || data.e !== 'aggTrade') return;
  const sym = String(data.s ?? '').toUpperCase();
  const asset = CVD_ASSETS.find((a) => sym === `${a}USDT`);
  if (!asset) return;
  const price = Number(data.p);
  const qty = Number(data.q);
  const tsMs = Number(data.T) || Date.now();
  const buyerIsMaker = data.m === true;
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return;
  onAggTrade(asset, price, qty, buyerIsMaker, tsMs);
}

function tickBuckets(): void {
  const nowBucket = bucketOpen(Date.now());
  let changed = false;
  for (const asset of CVD_ASSETS) {
    const st = state.byAsset[asset];
    if (st.curBucket > 0 && nowBucket > st.curBucket) {
      rollAsset(st, nowBucket);
      changed = true;
    }
  }
  if (changed) publish();
}

function initBuckets(): void {
  const b = bucketOpen(Date.now());
  for (const asset of CVD_ASSETS) {
    rollAsset(state.byAsset[asset], b);
  }
}

function connect(): void {
  if (state.ws != null) return;
  const streams = CVD_ASSETS.map((a) => `${BINANCE_SYMBOLS[a]}@aggTrade`).join('/');
  const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
  state.ws = ws;

  ws.onopen = () => {
    state.connected = true;
    if (state.reconnectTimer != null) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    initBuckets();
    publish();
    emit();
  };
  ws.onmessage = (event) => handleMessage(String(event.data));
  ws.onclose = () => {
    state.ws = null;
    state.connected = false;
    emit();
    if (state.refCount <= 0 || state.reconnectTimer != null) return;
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = null;
      if (state.refCount > 0) connect();
    }, 2000);
  };
  ws.onerror = () => ws.close();
}

function disconnect(): void {
  if (state.reconnectTimer != null) {
    window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.ws != null) {
    state.ws.onclose = null;
    state.ws.close();
    state.ws = null;
  }
  state.connected = false;
  state.snap = null;
  state.digest += 1;
  emit();
}

export function useBinanceCvdConnection(enabled = true): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    state.refCount += 1;
    if (state.refCount === 1) {
      connect();
      state.bucketTimer = window.setInterval(tickBuckets, 1000);
    }
    return () => {
      state.refCount -= 1;
      if (state.refCount === 0) {
        if (state.bucketTimer != null) {
          window.clearInterval(state.bucketTimer);
          state.bucketTimer = null;
        }
        disconnect();
      }
    };
  }, [enabled]);
}

export function useBinanceCvdConnected(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.connected,
    () => false,
  );
}

export function useBinanceCvdSnapshot(): CvdPanelSnapshot | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.snap,
    () => state.snap,
  );
}

export function fmtCvdUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
