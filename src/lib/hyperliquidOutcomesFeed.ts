import { useEffect, useSyncExternalStore } from 'react';
import { API_BASE, WS_BASE } from './env';
import { fetchBackend } from './fetchBackend';
import { onBackendReconnect } from './backendReconnect';
import type { AssetName, Market } from '../types';

export type HlCryptoLeg = {
  outcomeId: number;
  label: string;
  legKind: 'between' | 'below' | 'above' | 'other';
  strikeLabel: string;
  chancePct: number;
  yesMid: number;
  clobTokenIds: string[];
};

export type HlCryptoRow = {
  id: string;
  kind: 'above' | 'range';
  asset: AssetName;
  period: string;
  title: string;
  endDate: string;
  eventSlug: string;
  targetPrice?: string;
  strikeLabel?: string;
  chancePct?: number;
  outcomeId?: number;
  clobTokenIds?: string[];
  legs?: HlCryptoLeg[];
  closed?: boolean;
};

export type HlOutcomesSnapshot = {
  updatedAt: number;
  rows: HlCryptoRow[];
};

type FeedState = {
  snap: HlOutcomesSnapshot | null;
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

function parseAsset(raw: unknown): AssetName {
  const assetRaw = String(raw || 'BTC').trim().toUpperCase();
  if ((['BTC', 'ETH', 'SOL', 'XRP'] as const).includes(assetRaw as AssetName)) {
    return assetRaw as AssetName;
  }
  return 'BTC';
}

function parseLeg(raw: unknown): HlCryptoLeg | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const outcomeId = num(r.outcomeId) ?? 0;
  if (outcomeId <= 0) return null;
  const clobTokenIds = Array.isArray(r.clobTokenIds)
    ? r.clobTokenIds.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const legKindRaw = String(r.legKind || '').trim();
  const legKind =
    legKindRaw === 'between' || legKindRaw === 'below' || legKindRaw === 'above'
      ? legKindRaw
      : 'other';
  return {
    outcomeId,
    label: String(r.label || ''),
    legKind,
    strikeLabel: String(r.strikeLabel || r.label || ''),
    chancePct: num(r.chancePct) ?? 0,
    yesMid: num(r.yesMid) ?? 0,
    clobTokenIds,
  };
}

function parseRow(raw: unknown): HlCryptoRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id || '').trim();
  if (!id) return null;
  const kindRaw = String(r.kind || '').trim();
  const kind = kindRaw === 'range' ? 'range' : kindRaw === 'above' ? 'above' : null;
  if (!kind) return null;
  const legs = Array.isArray(r.legs)
    ? r.legs.map(parseLeg).filter((x): x is HlCryptoLeg => x != null)
    : undefined;
  const clobTokenIds = Array.isArray(r.clobTokenIds)
    ? r.clobTokenIds.map((x) => String(x || '').trim()).filter(Boolean)
    : undefined;
  return {
    id,
    kind,
    asset: parseAsset(r.asset),
    period: String(r.period || ''),
    title: String(r.title || ''),
    endDate: String(r.endDate || ''),
    eventSlug: String(r.eventSlug || id),
    targetPrice: r.targetPrice != null ? String(r.targetPrice) : undefined,
    strikeLabel: r.strikeLabel != null ? String(r.strikeLabel) : undefined,
    chancePct: num(r.chancePct) ?? undefined,
    outcomeId: num(r.outcomeId) ?? undefined,
    clobTokenIds,
    legs,
    closed: !!r.closed,
  };
}

export function parseHlOutcomesSnapshot(raw: unknown): HlOutcomesSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const rows = Array.isArray(r.rows)
    ? r.rows.map(parseRow).filter((x): x is HlCryptoRow => x != null)
    : [];
  return { updatedAt: num(r.updatedAt) ?? Date.now(), rows };
}

export function hlRowToMarket(row: HlCryptoRow, leg?: HlCryptoLeg): Market {
  const outcomeId = leg?.outcomeId ?? row.outcomeId ?? 0;
  const clobTokenIds = leg?.clobTokenIds ?? row.clobTokenIds ?? [];
  const yesMid = leg?.yesMid ?? (row.chancePct != null ? row.chancePct / 100 : 0);
  return {
    id: leg ? `hl-${outcomeId}` : row.id,
    question: leg ? `${row.title} — ${leg.label}` : row.title,
    eventTitle: row.title,
    eventSlug: row.id,
    groupItemTitle: leg?.label ?? '',
    endDate: row.endDate,
    clobTokenIds,
    bestBid: yesMid > 0 ? yesMid : undefined,
    bestAsk: yesMid > 0 ? yesMid : undefined,
    closed: row.closed,
  };
}

function connect(): void {
  if (state.ws != null) return;
  const ws = new WebSocket(`${WS_BASE}/ws/hyperliquid-outcomes`);
  state.ws = ws;
  ws.onopen = () => {
    if (state.reconnectTimer != null) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    ws.send(JSON.stringify({ type: 'ping' }));
  };
  ws.onmessage = (ev) => {
    let payload: unknown;
    try {
      payload = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const msg = payload as { type?: string; data?: unknown };
    if (msg.type === 'pong') return;
    if (msg.type !== 'hyperliquidOutcomes') return;
    const snap = parseHlOutcomesSnapshot(msg.data);
    if (!snap) return;
    state.snap = snap;
    state.connected = true;
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
  state.connected = false;
  state.snap = null;
  state.digest += 1;
  emit();
}

export function useHyperliquidOutcomesConnection(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    state.refCount += 1;
    if (state.refCount === 1) connect();
    return () => {
      state.refCount -= 1;
      if (state.refCount === 0) disconnect();
    };
  }, [enabled]);
}

export function useHyperliquidOutcomesConnected(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.connected,
    () => false,
  );
}

export function useHyperliquidOutcomesSnapshot(): HlOutcomesSnapshot | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.snap,
    () => state.snap,
  );
}

function applySnapshot(snap: HlOutcomesSnapshot | null): HlOutcomesSnapshot | null {
  if (!snap) return null;
  state.snap = snap;
  state.connected = true;
  state.digest += 1;
  emit();
  return snap;
}

export async function fetchHyperliquidOutcomesSnapshot(): Promise<HlOutcomesSnapshot | null> {
  const res = await fetchBackend(`${API_BASE}/api/hyperliquid-outcomes`, undefined, 8000);
  if (!res.ok) return null;
  const json: unknown = await res.json();
  const msg = json as { type?: string; data?: unknown };
  const snap =
    msg.type === 'hyperliquidOutcomes'
      ? parseHlOutcomesSnapshot(msg.data)
      : parseHlOutcomesSnapshot(json);
  return applySnapshot(snap);
}

onBackendReconnect(() => {
  if (state.refCount <= 0) return;
  if (state.ws != null) {
    try {
      state.ws.close();
    } catch {
      /* ignore */
    }
    return;
  }
  connect();
});
