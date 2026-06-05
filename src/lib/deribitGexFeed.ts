import { useLayoutEffect, useSyncExternalStore } from 'react';
import { WS_BASE } from './env';

export const GEX_ASSETS = ['BTC', 'ETH'] as const;
export type GexAsset = (typeof GEX_ASSETS)[number];

export const GEX_FEED_SOURCES = ['deribit', 'binance', 'okx'] as const;
export type GexFeedSource = (typeof GEX_FEED_SOURCES)[number];

export const GEX_SOURCES = [...GEX_FEED_SOURCES, 'combined'] as const;
export type GexSource = (typeof GEX_SOURCES)[number];

export const GEX_SOURCE_LABELS: Record<GexSource, string> = {
  deribit: 'Deribit',
  binance: 'Binance',
  okx: 'OKX',
  combined: 'Combined',
};

const GEX_WS_PATH: Record<GexFeedSource, string> = {
  deribit: '/ws/deribit-gex',
  binance: '/ws/binance-gex',
  okx: '/ws/okx-gex',
};

const GEX_MSG_TYPE: Record<GexFeedSource, string> = {
  deribit: 'deribitGex',
  binance: 'binanceGex',
  okx: 'okxGex',
};

const GEX_TOP_STRIKES = 18;
const GEX_GRID_SPAN = 0.2;
const GEX_GRID_STEPS = 81;

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

const feeds: Record<GexFeedSource, FeedState> = {
  deribit: makeFeedState(),
  binance: makeFeedState(),
  okx: makeFeedState(),
};

const listeners = new Map<GexFeedSource, Set<() => void>>();
const combinedListeners = new Set<() => void>();

function emit(source: GexFeedSource): void {
  for (const fn of listeners.get(source) ?? []) fn();
  for (const fn of combinedListeners) fn();
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

function interpolateProfileGex(profile: GexProfilePoint[], spot: number): number {
  if (profile.length === 0) return 0;
  const sorted = [...profile].sort((a, b) => a.spot - b.spot);
  if (spot <= sorted[0].spot) return sorted[0].gex;
  if (spot >= sorted[sorted.length - 1].spot) return sorted[sorted.length - 1].gex;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (spot >= a.spot && spot <= b.spot) {
      const denom = b.spot - a.spot;
      if (denom === 0) return b.gex;
      const t = (spot - a.spot) / denom;
      return a.gex + t * (b.gex - a.gex);
    }
  }
  return 0;
}

function buildCombinedProfile(snaps: GexAssetSnapshot[], refSpot: number): GexProfilePoint[] {
  const lo = refSpot * (1 - GEX_GRID_SPAN);
  const hi = refSpot * (1 + GEX_GRID_SPAN);
  const step = (hi - lo) / (GEX_GRID_STEPS - 1);
  const out: GexProfilePoint[] = [];
  for (let i = 0; i < GEX_GRID_STEPS; i++) {
    const s = lo + step * i;
    let gex = 0;
    for (const snap of snaps) {
      gex += interpolateProfileGex(snap.profile, s);
    }
    out.push({ spot: s, gex });
  }
  return out;
}

function gammaFlipFromProfile(profile: GexProfilePoint[], refSpot: number): number | null {
  let prev: GexProfilePoint | null = null;
  let bestFlip: number | null = null;
  let bestDist = Infinity;
  for (const p of profile) {
    if (
      prev &&
      ((prev.gex < 0 && p.gex >= 0) || (prev.gex > 0 && p.gex <= 0))
    ) {
      const denom = p.gex - prev.gex;
      let flip = p.spot;
      if (denom !== 0) {
        flip = prev.spot + ((0 - prev.gex) * (p.spot - prev.spot)) / denom;
      }
      const d = Math.abs(flip - refSpot);
      if (d < bestDist) {
        bestDist = d;
        bestFlip = flip;
      }
    }
    prev = p;
  }
  return bestFlip;
}

function wallsFromStrikes(
  all: GexStrikeBucket[],
  spot: number,
): { callWall: number | null; putWall: number | null; pinStrike: number | null } {
  let callWall: number | null = null;
  let putWall: number | null = null;
  let pinStrike: number | null = null;
  let bestCallAbs = 0;
  let bestPutAbs = 0;
  let bestPin = 0;
  for (const b of all) {
    const callAbs = b.gex > 0 ? b.gex : 0;
    const putAbs = b.gex < 0 ? -b.gex : 0;
    const pinTot = Math.abs(b.gex);
    if (b.strike >= spot && callAbs > bestCallAbs) {
      bestCallAbs = callAbs;
      callWall = b.strike;
    }
    if (b.strike <= spot && putAbs > bestPutAbs) {
      bestPutAbs = putAbs;
      putWall = b.strike;
    }
    if (pinTot > bestPin) {
      bestPin = pinTot;
      pinStrike = b.strike;
    }
  }
  return { callWall, putWall, pinStrike };
}

function oiWeightedStrike(strikes: { strike: number; oi: number }[]): number | null {
  let sum = 0;
  let w = 0;
  for (const x of strikes) {
    if (x.oi <= 0) continue;
    sum += x.strike * x.oi;
    w += x.oi;
  }
  return w > 0 ? sum / w : null;
}

/** Sum Deribit + Binance + OKX GEX into one asset snapshot. */
export function combineGexAssetSnapshots(
  parts: [GexAssetSnapshot | null | undefined, GexAssetSnapshot | null | undefined, GexAssetSnapshot | null | undefined],
): GexAssetSnapshot | null {
  const snaps = parts.filter((s): s is GexAssetSnapshot => s != null);
  if (snaps.length === 0) return null;

  const asset = snaps[0].asset;
  const deribit = parts[0];
  const refSpot =
    (deribit ? gexReferenceSpot(deribit) : 0) ||
    snaps.reduce((best, s) => (gexReferenceSpot(s) > 0 ? gexReferenceSpot(s) : best), 0);
  if (refSpot <= 0) return null;

  const byStrike = new Map<number, GexStrikeBucket>();
  for (const snap of snaps) {
    for (const b of snap.strikes) {
      const prev = byStrike.get(b.strike);
      if (!prev) {
        byStrike.set(b.strike, { ...b });
      } else {
        prev.gex += b.gex;
        prev.callOi += b.callOi;
        prev.putOi += b.putOi;
      }
    }
  }
  const allStrikes = [...byStrike.values()];
  const { callWall, putWall, pinStrike } = wallsFromStrikes(allStrikes, refSpot);
  let strikes = [...allStrikes].sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex));
  if (strikes.length > GEX_TOP_STRIKES) strikes = strikes.slice(0, GEX_TOP_STRIKES);
  strikes.sort((a, b) => a.strike - b.strike);

  type ExpAcc = {
    expiryMs: number;
    label: string;
    hoursToExp: number;
    netGex: number;
    totalOi: number;
    callOi: number;
    putOi: number;
    contracts: number;
    pinWeighted: { strike: number; oi: number }[];
    pinDownWeighted: { strike: number; oi: number }[];
    pinUpWeighted: { strike: number; oi: number }[];
    gammaFlipWeighted: { strike: number; oi: number }[];
  };
  const byLabel = new Map<string, ExpAcc>();
  for (const snap of snaps) {
    for (const exp of snap.expirations) {
      let acc = byLabel.get(exp.label);
      if (!acc) {
        acc = {
          expiryMs: exp.expiryMs,
          label: exp.label,
          hoursToExp: exp.hoursToExp,
          netGex: 0,
          totalOi: 0,
          callOi: 0,
          putOi: 0,
          contracts: 0,
          pinWeighted: [],
          pinDownWeighted: [],
          pinUpWeighted: [],
          gammaFlipWeighted: [],
        };
        byLabel.set(exp.label, acc);
      }
      acc.netGex += exp.netGex;
      acc.totalOi += exp.totalOi;
      acc.callOi += exp.callOi;
      acc.putOi += exp.putOi;
      acc.contracts += exp.contracts;
      acc.expiryMs = Math.min(acc.expiryMs, exp.expiryMs);
      acc.hoursToExp = Math.min(acc.hoursToExp, exp.hoursToExp);
      const w = exp.totalOi > 0 ? exp.totalOi : 1;
      if (exp.pinStrike != null) acc.pinWeighted.push({ strike: exp.pinStrike, oi: w });
      if (exp.pinStrikeDown != null) acc.pinDownWeighted.push({ strike: exp.pinStrikeDown, oi: w });
      if (exp.pinStrikeUp != null) acc.pinUpWeighted.push({ strike: exp.pinStrikeUp, oi: w });
      if (exp.gammaFlip != null) acc.gammaFlipWeighted.push({ strike: exp.gammaFlip, oi: w });
    }
  }
  const expirations = [...byLabel.values()]
    .sort((a, b) => a.expiryMs - b.expiryMs)
    .map((acc) => ({
      expiryMs: acc.expiryMs,
      label: acc.label,
      hoursToExp: acc.hoursToExp,
      netGex: acc.netGex,
      regime: acc.netGex >= 0 ? ('positive' as const) : ('negative' as const),
      totalOi: acc.totalOi,
      callOi: acc.callOi,
      putOi: acc.putOi,
      contracts: acc.contracts,
      gammaFlip: oiWeightedStrike(acc.gammaFlipWeighted),
      pinStrike: oiWeightedStrike(acc.pinWeighted),
      pinStrikeDown: oiWeightedStrike(acc.pinDownWeighted),
      pinStrikeUp: oiWeightedStrike(acc.pinUpWeighted),
    }));

  const netGex = snaps.reduce((s, x) => s + x.netGex, 0);
  const profile = buildCombinedProfile(snaps, refSpot);
  const gammaFlip = gammaFlipFromProfile(profile, refSpot);

  return {
    asset,
    synced: snaps.every((s) => s.synced),
    spot: refSpot,
    deribitIndex: deribit ? gexReferenceSpot(deribit) : refSpot,
    netGex,
    gammaFlip,
    regime: netGex >= 0 ? 'positive' : 'negative',
    totalOi: snaps.reduce((s, x) => s + x.totalOi, 0),
    callWall,
    putWall,
    pinStrike,
    strikes,
    expirations,
    profile,
    contracts: snaps.reduce((s, x) => s + x.contracts, 0),
    updatedAt: Math.max(...snaps.map((s) => s.updatedAt)),
  };
}

function buildCombinedPanelSnapshot(): GexPanelSnapshot | null {
  const deribit = feeds.deribit.snap;
  const binance = feeds.binance.snap;
  const okx = feeds.okx.snap;
  if (!deribit && !binance && !okx) return null;

  const assets: GexPanelSnapshot['assets'] = {};
  for (const asset of GEX_ASSETS) {
    const merged = combineGexAssetSnapshots([
      deribit?.assets[asset] ?? null,
      binance?.assets[asset] ?? null,
      okx?.assets[asset] ?? null,
    ]);
    if (merged) assets[asset] = merged;
  }
  if (Object.keys(assets).length === 0) return null;

  return {
    assets,
    updatedAt: Math.max(
      deribit?.updatedAt ?? 0,
      binance?.updatedAt ?? 0,
      okx?.updatedAt ?? 0,
    ),
  };
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

function connect(source: GexFeedSource): void {
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

function disconnect(source: GexFeedSource): void {
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

function retainFeed(source: GexFeedSource): void {
  const state = feeds[source];
  state.refCount += 1;
  if (state.refCount === 1) connect(source);
}

function releaseFeed(source: GexFeedSource): void {
  const state = feeds[source];
  state.refCount -= 1;
  if (state.refCount === 0) disconnect(source);
}

export function useGexConnection(source: GexSource, enabled = true): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    if (source === 'combined') {
      for (const s of GEX_FEED_SOURCES) retainFeed(s);
      return () => {
        for (const s of GEX_FEED_SOURCES) releaseFeed(s);
      };
    }
    retainFeed(source);
    return () => releaseFeed(source);
  }, [source, enabled]);
}

export function useGexSnapshot(source: GexSource): GexPanelSnapshot | null {
  if (source === 'combined') {
    return useSyncExternalStore(
      (cb) => {
        combinedListeners.add(cb);
        return () => combinedListeners.delete(cb);
      },
      buildCombinedPanelSnapshot,
      buildCombinedPanelSnapshot,
    );
  }
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
