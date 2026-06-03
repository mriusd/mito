import { useLayoutEffect, useSyncExternalStore } from 'react';
import { WS_BASE } from './env';

export const CVD_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
export type CvdAsset = (typeof CVD_ASSETS)[number];

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

type FeedState = {
  snap: CvdPanelSnapshot | null;
  connected: boolean;
  digest: number;
  ws: WebSocket | null;
  reconnectTimer: number | null;
  refCount: number;
};

const state: FeedState = {
  snap: null,
  connected: false,
  digest: 0,
  ws: null,
  reconnectTimer: null,
  refCount: 0,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function parseBar(raw: unknown): CvdBar | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const t = num(r.t);
  if (t == null) return null;
  const buyUsd = num(r.buyUsd) ?? 0;
  const sellUsd = num(r.sellUsd) ?? 0;
  return {
    t,
    buyUsd,
    sellUsd,
    deltaUsd: num(r.deltaUsd) ?? buyUsd - sellUsd,
    cumDeltaUsd: num(r.cumDeltaUsd) ?? 0,
    tradeCount: num(r.tradeCount) ?? 0,
  };
}

function parseAsset(raw: unknown): CvdAssetSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const asset = String(r.asset ?? '').trim().toUpperCase();
  if (!asset) return null;
  const bars = Array.isArray(r.bars)
    ? r.bars.map(parseBar).filter((x): x is CvdBar => x != null)
    : [];
  return {
    asset,
    spot: num(r.spot) ?? 0,
    cumDeltaUsd: num(r.cumDeltaUsd) ?? 0,
    bars,
    updatedAt: num(r.updatedAt) ?? Date.now(),
  };
}

function parseSnapshot(raw: unknown): CvdPanelSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const assetsIn = r.assets;
  if (!assetsIn || typeof assetsIn !== 'object') return null;
  const assets: CvdPanelSnapshot['assets'] = {};
  for (const asset of CVD_ASSETS) {
    const parsed = parseAsset((assetsIn as Record<string, unknown>)[asset]);
    if (parsed) assets[asset] = parsed;
  }
  if (Object.keys(assets).length === 0) return null;
  return { assets, updatedAt: num(r.updatedAt) ?? Date.now() };
}

function connect(): void {
  if (state.ws != null) return;
  const ws = new WebSocket(`${WS_BASE}/ws/binance-cvd`);
  state.ws = ws;

  ws.onopen = () => {
    if (state.reconnectTimer != null) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  };
  ws.onmessage = (event) => {
    let payload: unknown;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const msg = payload as { type?: unknown; data?: unknown };
    if (msg.type === 'pong') return;
    if (msg.type !== 'binanceCvd') return;
    const snap = parseSnapshot(msg.data);
    if (!snap) return;
    state.snap = snap;
    state.connected = true;
    state.digest += 1;
    emit();
  };
  ws.onclose = () => {
    state.ws = null;
    state.connected = false;
    state.snap = null;
    state.digest += 1;
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
    if (state.refCount === 1) connect();
    return () => {
      state.refCount -= 1;
      if (state.refCount === 0) disconnect();
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
