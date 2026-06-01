import { useLayoutEffect, useSyncExternalStore } from 'react';
import { WS_BASE } from './env';

export const LIQ_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
export type LiqAsset = (typeof LIQ_ASSETS)[number];

export type LiqEventBin = {
  price: number;
  longUsd: number;
  shortUsd: number;
  count: number;
};

export type LiqLevel = {
  price: number;
  longLiqUsd: number;
  shortLiqUsd: number;
  intensity: number;
};

export type LiqCluster = {
  price: number;
  side: 'long' | 'short';
  usd: number;
  pctToSpot: number;
};

export type LiqAssetSnapshot = {
  asset: string;
  spot: number;
  windowHours: number;
  events: LiqEventBin[];
  levels: LiqLevel[];
  nearestCluster: LiqCluster | null;
  totalOiUsd: number;
  longShortRatio: number;
  eventLongUsd: number;
  eventShortUsd: number;
  eventCount: number;
  updatedAt: number;
};

export type LiqPanelSnapshot = {
  assets: Partial<Record<LiqAsset, LiqAssetSnapshot | null>>;
  updatedAt: number;
};

type FeedState = {
  snap: LiqPanelSnapshot | null;
  digest: number;
  connected: boolean;
  ws: WebSocket | null;
  reconnectTimer: number | null;
  refCount: number;
};

const state: FeedState = { snap: null, digest: 0, connected: false, ws: null, reconnectTimer: null, refCount: 0 };
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function parseEventBin(raw: unknown): LiqEventBin | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const price = num(r.price);
  if (price == null) return null;
  return {
    price,
    longUsd: num(r.longUsd) ?? 0,
    shortUsd: num(r.shortUsd) ?? 0,
    count: num(r.count) ?? 0,
  };
}

function parseLevel(raw: unknown): LiqLevel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const price = num(r.price);
  if (price == null) return null;
  return {
    price,
    longLiqUsd: num(r.longLiqUsd) ?? 0,
    shortLiqUsd: num(r.shortLiqUsd) ?? 0,
    intensity: num(r.intensity) ?? 0,
  };
}

function parseCluster(raw: unknown): LiqCluster | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const price = num(r.price);
  if (price == null) return null;
  return {
    price,
    side: r.side === 'long' ? 'long' : 'short',
    usd: num(r.usd) ?? 0,
    pctToSpot: num(r.pctToSpot) ?? 0,
  };
}

function parseAsset(raw: unknown): LiqAssetSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const asset = String(r.asset ?? '').trim().toUpperCase();
  const spot = num(r.spot);
  if (!asset || spot == null) return null;
  const events = Array.isArray(r.events)
    ? r.events.map(parseEventBin).filter((x): x is LiqEventBin => x != null)
    : [];
  const levels = Array.isArray(r.levels)
    ? r.levels.map(parseLevel).filter((x): x is LiqLevel => x != null)
    : [];
  return {
    asset,
    spot,
    windowHours: num(r.windowHours) ?? 0,
    events,
    levels,
    nearestCluster: parseCluster(r.nearestCluster),
    totalOiUsd: num(r.totalOiUsd) ?? 0,
    longShortRatio: num(r.longShortRatio) ?? 0,
    eventLongUsd: num(r.eventLongUsd) ?? 0,
    eventShortUsd: num(r.eventShortUsd) ?? 0,
    eventCount: num(r.eventCount) ?? 0,
    updatedAt: num(r.updatedAt) ?? Date.now(),
  };
}

function parseSnapshot(raw: unknown): LiqPanelSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const assetsIn = r.assets;
  if (!assetsIn || typeof assetsIn !== 'object') return null;
  const assets: LiqPanelSnapshot['assets'] = {};
  for (const [key, val] of Object.entries(assetsIn as Record<string, unknown>)) {
    const parsed = parseAsset(val);
    if (parsed) assets[key.toUpperCase() as LiqAsset] = parsed;
  }
  if (Object.keys(assets).length === 0) return null;
  return { assets, updatedAt: num(r.updatedAt) ?? Date.now() };
}

function connect(): void {
  if (state.ws != null) return;
  const ws = new WebSocket(`${WS_BASE}/ws/binance-liq`);
  state.ws = ws;

  ws.onopen = () => {
    state.connected = true;
    state.digest += 1;
    emit();
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
    if (msg.type !== 'binanceLiq') return;
    const snap = parseSnapshot(msg.data);
    if (!snap) return;
    state.snap = snap;
    state.digest += 1;
    emit();
  };
  ws.onclose = () => {
    state.ws = null;
    state.connected = false;
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
  state.snap = null;
  state.connected = false;
  state.digest += 1;
  emit();
}

export function useBinanceLiqConnected(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.connected,
    () => state.connected,
  );
}

export function useBinanceLiqConnection(enabled = true): void {
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

export function useBinanceLiqSnapshot(): LiqPanelSnapshot | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.snap,
    () => state.snap,
  );
}
