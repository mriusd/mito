import { useLayoutEffect, useSyncExternalStore } from 'react';
import { WS_BASE } from './env';

export const GEX_ASSETS = ['BTC', 'ETH'] as const;
export type GexAsset = (typeof GEX_ASSETS)[number];

export const GEX_SOURCES = ['deribit', 'binance', 'okx'] as const;
export type GexSource = (typeof GEX_SOURCES)[number];

export const GEX_SOURCE_LABELS: Record<GexSource, string> = {
  deribit: 'Deribit',
  binance: 'Binance',
  okx: 'OKX',
};

const GEX_WS_PATH: Record<GexSource, string> = {
  deribit: '/ws/deribit-gex',
  binance: '/ws/binance-gex',
  okx: '/ws/okx-gex',
};

const GEX_MSG_TYPE: Record<GexSource, string> = {
  deribit: 'deribitGex',
  binance: 'binanceGex',
  okx: 'okxGex',
};

export type GexStrikeBucket = {
  strike: number;
  gex: number;
  callOi: number;
  putOi: number;
};

export type GexProfilePoint = {
  spot: number;
  gex: number;
};

export type GexExpiryBucket = {
  expiryMs: number;
  label: string;
  hoursToExp: number;
  netGex: number;
  regime: 'positive' | 'negative' | string;
  totalOi: number;
  callOi: number;
  putOi: number;
  contracts: number;
  gammaFlip?: number | null;
  pinStrike?: number | null;
  pinStrikeDown?: number | null;
  pinStrikeUp?: number | null;
};

export type GexAssetSnapshot = {
  asset: string;
  synced: boolean;
  /** GEX eval price (= Deribit index). */
  spot: number;
  /** Deribit composite index (btc_usd / eth_usd). */
  deribitIndex?: number;
  netGex: number;
  gammaFlip?: number | null;
  regime: 'positive' | 'negative' | string;
  totalOi: number;
  callWall?: number | null;
  putWall?: number | null;
  pinStrike?: number | null;
  strikes: GexStrikeBucket[];
  expirations: GexExpiryBucket[];
  profile: GexProfilePoint[];
  contracts: number;
  updatedAt: number;
};

export type GexPanelSnapshot = {
  assets: Partial<Record<GexAsset, GexAssetSnapshot | null>>;
  updatedAt: number;
};

export function fmtGexStrike(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

type FeedState = {
  snap: GexPanelSnapshot | null;
  digest: number;
  ws: WebSocket | null;
  reconnectTimer: number | null;
  refCount: number;
};

function makeFeedState(): FeedState {
  return { snap: null, digest: 0, ws: null, reconnectTimer: null, refCount: 0 };
}

const feeds: Record<GexSource, FeedState> = {
  deribit: makeFeedState(),
  binance: makeFeedState(),
  okx: makeFeedState(),
};

const listeners = new Map<GexSource, Set<() => void>>();

function emit(source: GexSource): void {
  for (const fn of listeners.get(source) ?? []) fn();
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function parseStrike(raw: unknown): GexStrikeBucket | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const strike = num(r.strike);
  const gex = num(r.gex);
  if (strike == null || gex == null) return null;
  return { strike, gex, callOi: num(r.callOi) ?? 0, putOi: num(r.putOi) ?? 0 };
}

function parseExpiry(raw: unknown): GexExpiryBucket | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const expiryMs = num(r.expiryMs);
  const label = String(r.label ?? '').trim();
  if (expiryMs == null || !label) return null;
  return {
    expiryMs,
    label,
    hoursToExp: num(r.hoursToExp) ?? 0,
    netGex: num(r.netGex) ?? 0,
    regime: r.regime === 'negative' ? 'negative' : 'positive',
    totalOi: num(r.totalOi) ?? 0,
    callOi: num(r.callOi) ?? 0,
    putOi: num(r.putOi) ?? 0,
    contracts: num(r.contracts) ?? 0,
    gammaFlip: num(r.gammaFlip),
    pinStrike: num(r.pinStrike),
    pinStrikeDown: num(r.pinStrikeDown),
    pinStrikeUp: num(r.pinStrikeUp),
  };
}

export function gexReferenceSpot(s: GexAssetSnapshot): number {
  return s.deribitIndex ?? s.spot;
}

function parseAsset(raw: unknown): GexAssetSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const asset = String(r.asset ?? '').trim().toUpperCase();
  const idxRaw = num(r.deribit_index) ?? num(r.deribitIndex) ?? num(r.spot);
  if (!asset || idxRaw == null) return null;
  const deribitIndex = idxRaw;
  const spot = deribitIndex;
  const strikes = Array.isArray(r.strikes)
    ? r.strikes.map(parseStrike).filter((x): x is GexStrikeBucket => x != null)
    : [];
  const profile = Array.isArray(r.profile)
    ? r.profile
        .map((p) => {
          if (!p || typeof p !== 'object') return null;
          const pr = p as Record<string, unknown>;
          const s = num(pr.spot);
          const g = num(pr.gex);
          return s != null && g != null ? { spot: s, gex: g } : null;
        })
        .filter((x): x is GexProfilePoint => x != null)
    : [];
  const expirations = Array.isArray(r.expirations)
    ? r.expirations.map(parseExpiry).filter((x): x is GexExpiryBucket => x != null)
    : [];
  return {
    asset,
    synced: r.synced === true,
    spot,
    deribitIndex,
    netGex: num(r.netGex) ?? 0,
    gammaFlip: num(r.gammaFlip),
    regime: r.regime === 'negative' ? 'negative' : 'positive',
    totalOi: num(r.totalOi) ?? 0,
    callWall: num(r.callWall),
    putWall: num(r.putWall),
    pinStrike: num(r.pinStrike),
    strikes,
    expirations,
    profile,
    contracts: num(r.contracts) ?? 0,
    updatedAt: num(r.updatedAt) ?? Date.now(),
  };
}

// parseGexAssetSnapshot parses one per-asset GEX snapshot (the shape stored on candles.gex).
// Accepts either a parsed object or a JSON string.
export function parseGexAssetSnapshot(raw: unknown): GexAssetSnapshot | undefined {
  if (raw == null || raw === '') return undefined;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return parseAsset(obj) ?? undefined;
}

function parseSnapshot(raw: unknown): GexPanelSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const assetsIn = r.assets;
  if (!assetsIn || typeof assetsIn !== 'object') return null;
  const assets: GexPanelSnapshot['assets'] = {};
  for (const asset of GEX_ASSETS) {
    const parsed = parseAsset((assetsIn as Record<string, unknown>)[asset]);
    if (parsed) assets[asset] = parsed;
  }
  return { assets, updatedAt: num(r.updatedAt) ?? Date.now() };
}

function connect(source: GexSource): void {
  const state = feeds[source];
  if (state.ws != null) return;
  const ws = new WebSocket(`${WS_BASE}${GEX_WS_PATH[source]}`);
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
    if (msg.type !== GEX_MSG_TYPE[source]) return;
    const snap = parseSnapshot(msg.data);
    if (!snap) return;
    state.snap = snap;
    state.digest += 1;
    emit(source);
  };
  ws.onclose = () => {
    state.ws = null;
    if (state.refCount <= 0 || state.reconnectTimer != null) return;
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = null;
      if (state.refCount > 0) connect(source);
    }, 2000);
  };
  ws.onerror = () => ws.close();
}

function disconnect(source: GexSource): void {
  const state = feeds[source];
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
  state.digest += 1;
  emit(source);
}

export function useGexConnection(source: GexSource, enabled = true): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    const state = feeds[source];
    state.refCount += 1;
    if (state.refCount === 1) connect(source);
    return () => {
      state.refCount -= 1;
      if (state.refCount === 0) disconnect(source);
    };
  }, [source, enabled]);
}

export function useGexSnapshot(source: GexSource): GexPanelSnapshot | null {
  return useSyncExternalStore(
    (cb) => {
      let set = listeners.get(source);
      if (!set) {
        set = new Set();
        listeners.set(source, set);
      }
      set.add(cb);
      return () => set!.delete(cb);
    },
    () => feeds[source].snap,
    () => feeds[source].snap,
  );
}

export function useDeribitGexConnection(enabled = true): void {
  useGexConnection('deribit', enabled);
}

export function useDeribitGexSnapshot(): GexPanelSnapshot | null {
  return useGexSnapshot('deribit');
}
