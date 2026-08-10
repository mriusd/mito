import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { API_BASE, WS_BASE } from '../lib/env';
import { backendWsRetryDelayMs, fetchBackend } from '../lib/fetchBackend';
import { onBackendReconnect } from '../lib/backendReconnect';
import { upDownTimeframeKeyFromMarket } from '../utils/format';

interface PriceState {
  price: number | null;
  timestamp: number | null;
  /** Feed key that resolved (e.g. BTC_TWAP_30). */
  feed?: string | null;
}

export type ChainlinkPricesMap = Record<string, number>;

/** Normalize backend feed keys: btc_twap_30 → BTC_TWAP_30, btc_twap30 → BTC_TWAP_30. */
export function normalizeChainlinkFeedKey(raw: string): string {
  let k = String(raw || '').trim().toUpperCase();
  if (!k) return '';
  k = k.replace(/TWAP30\b/g, 'TWAP_30').replace(/TWAP60\b/g, 'TWAP_60');
  k = k.replace(/_TWAP_30$/, '_TWAP_30').replace(/_TWAP_60$/, '_TWAP_60');
  return k;
}

/**
 * Polymarket settlement alignment:
 * - 5m up/down → TWAP 30s (`BTC_TWAP_30`)
 * - 15m up/down → TWAP 60s (`BTC_TWAP_60`)
 */
export function chainlinkTwapWindowForUpDownTf(tf: string | null | undefined): 30 | 60 | null {
  if (tf === '5m') return 30;
  if (tf === '15m') return 60;
  return null;
}

export function chainlinkTwapFeedKey(asset: string, windowSec: 30 | 60): string {
  const a = String(asset || '').trim().toUpperCase();
  if (!a) return '';
  return windowSec === 30 ? `${a}_TWAP_30` : `${a}_TWAP_60`;
}

/** Preferred feed key for an Up/Down timeframe (falls back to bare asset for 1h+). */
export function chainlinkFeedKeyForUpDownTf(asset: string, tf: string | null | undefined): string {
  const a = String(asset || '').trim().toUpperCase();
  if (!a) return '';
  const w = chainlinkTwapWindowForUpDownTf(tf);
  if (w != null) return chainlinkTwapFeedKey(a, w);
  return a;
}

/**
 * Resolve price from the shared map: TWAP key for 5m/15m, then bare asset, then alternate TWAP.
 */
export function resolveChainlinkPriceFromMap(
  map: ChainlinkPricesMap,
  asset: string | null | undefined,
  tf?: string | null,
): { price: number | null; feed: string | null; timestamp: number | null } {
  const a = String(asset || '').trim().toUpperCase();
  if (!a) return { price: null, feed: null, timestamp: null };

  const tryKey = (k: string): { price: number; feed: string; timestamp: number | null } | null => {
    if (!k) return null;
    const p = map[k];
    if (typeof p === 'number' && p > 0 && Number.isFinite(p)) {
      return { price: p, feed: k, timestamp: tsMap[k] ?? null };
    }
    return null;
  };

  const preferred = chainlinkFeedKeyForUpDownTf(a, tf);
  const hit = tryKey(preferred);
  if (hit) return hit;

  // Fallbacks if preferred TWAP not connected yet
  if (tf === '5m') {
    const alt = tryKey(a) || tryKey(chainlinkTwapFeedKey(a, 60));
    if (alt) return alt;
  } else if (tf === '15m') {
    const alt = tryKey(a) || tryKey(chainlinkTwapFeedKey(a, 30));
    if (alt) return alt;
  } else {
    // Bare asset or unknown tf: prefer legacy, then 30 then 60
    const alt = tryKey(a) || tryKey(chainlinkTwapFeedKey(a, 30)) || tryKey(chainlinkTwapFeedKey(a, 60));
    if (alt) return alt;
  }
  return { price: null, feed: null, timestamp: null };
}

// Single shared /ws/prices socket for the whole app. Every consumer (grid cells,
// HUD, chart panels, sidebar strip) reads from this one connection via refCount,
// instead of opening its own socket. Backend proxies Polymarket TWAP feeds
// (crypto_prices_twap_thirty / crypto_prices_twap_sixty).
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let refCount = 0;

let pricesMap: ChainlinkPricesMap = {};
const tsMap: Record<string, number> = {};
const listeners = new Set<() => void>();
let lastWsMsgAt = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const CHAINLINK_SPOT_POLL_MS = 2000;
const CHAINLINK_WS_STALE_MS = 5000;

function emit(): void {
  for (const fn of listeners) fn();
}

function applyPriceTick(rawAsset: string, price: number, ts: number): void {
  const k = normalizeChainlinkFeedKey(rawAsset);
  if (!k || !(price > 0) || !Number.isFinite(price)) return;
  lastWsMsgAt = Date.now();
  const prevTs = tsMap[k];
  const prevPrice = pricesMap[k];
  // Always advance wall-clock freshness even when TWAP value is unchanged for a tick.
  tsMap[k] = ts > 0 ? ts : Date.now();
  if (prevPrice === price && prevTs === tsMap[k]) return;
  pricesMap = { ...pricesMap, [k]: price };
  emit();
}

function connect(): void {
  if (ws != null) return;
  const sock = new WebSocket(`${WS_BASE}/ws/prices`);
  ws = sock;

  sock.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as {
        asset?: string;
        price?: number;
        timestamp?: number;
        feed?: string;
      };
      const raw = msg.asset || msg.feed;
      if (typeof raw !== 'string' || typeof msg.price !== 'number' || msg.price <= 0) return;
      const ts = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
      applyPriceTick(raw, msg.price, ts);
    } catch {
      /* ignore */
    }
  };

  sock.onerror = () => {};

  sock.onclose = () => {
    ws = null;
    if (refCount <= 0) return;
    if (reconnectTimer != null) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (refCount > 0) connect();
    }, backendWsRetryDelayMs(3000));
  };
}

function disconnect(): void {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws != null) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

async function pollChainlinkSpot(): Promise<void> {
  if (refCount <= 0) return;
  // Always poll when WS is quiet; also periodic soft-refresh so TWAP keys stay warm
  // even if the socket is half-open without ticks.
  const quiet = lastWsMsgAt === 0 || Date.now() - lastWsMsgAt > CHAINLINK_WS_STALE_MS;
  if (!quiet && Date.now() - lastWsMsgAt < CHAINLINK_SPOT_POLL_MS) return;
  try {
    const r = await fetchBackend(`${API_BASE}/api/chainlink-spot`, undefined, 4000);
    if (!r.ok) return;
    const body = (await r.json()) as Record<string, number>;
    let changed = false;
    const next = { ...pricesMap };
    const now = Date.now();
    for (const [asset, price] of Object.entries(body)) {
      if (typeof price !== 'number' || price <= 0 || !Number.isFinite(price)) continue;
      const k = normalizeChainlinkFeedKey(asset);
      if (!k) continue;
      if (next[k] === price) {
        // Refresh timestamp so UI knows feed is alive even if TWAP value is flat.
        if (quiet) tsMap[k] = now;
        continue;
      }
      next[k] = price;
      tsMap[k] = now;
      changed = true;
    }
    if (changed) {
      pricesMap = next;
      if (quiet) lastWsMsgAt = now;
      emit();
    }
  } catch {
    /* ignore */
  }
}

function ensurePoll(): void {
  if (pollTimer != null) return;
  pollTimer = setInterval(() => {
    void pollChainlinkSpot();
  }, CHAINLINK_SPOT_POLL_MS);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  refCount += 1;
  if (refCount === 1) {
    connect();
    ensurePoll();
    void pollChainlinkSpot();
  }
  return () => {
    listeners.delete(onChange);
    refCount -= 1;
    if (refCount === 0) disconnect();
  };
}

function getSnapshot(): ChainlinkPricesMap {
  return pricesMap;
}

/**
 * Single WS to /ws/prices: latest feeds per key (BTC, BTC_TWAP_30, BTC_TWAP_60, …).
 * Shared across all consumers — one socket regardless of how many components mount.
 */
export function useChainlinkPricesMap(): ChainlinkPricesMap {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export type UsePolymarketPriceOpts = {
  /**
   * Up/Down market timeframe: `5m` → TWAP-30, `15m` → TWAP-60.
   * Omit for legacy bare asset (or auto-fallback).
   */
  timeframe?: string | null;
};

/**
 * Single-asset Chainlink/TWAP price from the shared /ws/prices socket.
 * Pass `timeframe: '5m' | '15m'` for settlement-aligned TWAP selection.
 */
export function usePolymarketPrice(
  asset: string | null,
  opts?: UsePolymarketPriceOpts,
): PriceState {
  const map = useChainlinkPricesMap();
  return useMemo(() => {
    if (!asset) return { price: null, timestamp: null, feed: null };
    const r = resolveChainlinkPriceFromMap(map, asset, opts?.timeframe);
    return { price: r.price, timestamp: r.timestamp, feed: r.feed };
  }, [map, asset, opts?.timeframe]);
}

/**
 * Convenience for Up/Down markets: picks TWAP window from market slug/question (5m→30, 15m→60).
 */
export function usePolymarketPriceForMarket(
  market: { eventSlug?: string; question?: string; groupItemTitle?: string } | null | undefined,
  asset: string | null,
): PriceState {
  const tf = market ? upDownTimeframeKeyFromMarket(market) : null;
  return usePolymarketPrice(asset, { timeframe: tf });
}

/** Shared throttled Chainlink map — one flush for all consumers (cells must not each re-render on live WS). */
let throttledChainlinkMap: ChainlinkPricesMap = {};
const throttledChainlinkListeners = new Set<() => void>();
let throttledChainlinkTimer: ReturnType<typeof setTimeout> | null = null;
let throttledChainlinkUnsub: (() => void) | null = null;
/** Shared flush interval — per-hook `ms` only lowers this (min of subscribers). */
let throttledChainlinkMs = 1000;
let throttledChainlinkSubCount = 0;

function chainlinkMapsEqual(a: ChainlinkPricesMap, b: ChainlinkPricesMap): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of bk) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function flushThrottledChainlink(): void {
  throttledChainlinkTimer = null;
  if (chainlinkMapsEqual(throttledChainlinkMap, pricesMap)) return;
  throttledChainlinkMap = pricesMap;
  for (const fn of throttledChainlinkListeners) fn();
}

function scheduleThrottledChainlinkFlush(): void {
  if (throttledChainlinkTimer != null) return;
  throttledChainlinkTimer = setTimeout(flushThrottledChainlink, throttledChainlinkMs);
}

function ensureThrottledChainlinkBridge(): void {
  if (throttledChainlinkUnsub) return;
  throttledChainlinkMap = pricesMap;
  throttledChainlinkUnsub = subscribe(() => {
    scheduleThrottledChainlinkFlush();
  });
}

function releaseThrottledChainlinkBridge(): void {
  if (throttledChainlinkSubCount > 0) return;
  if (throttledChainlinkUnsub) {
    throttledChainlinkUnsub();
    throttledChainlinkUnsub = null;
  }
  if (throttledChainlinkTimer != null) {
    clearTimeout(throttledChainlinkTimer);
    throttledChainlinkTimer = null;
  }
}

function subscribeThrottledChainlink(onChange: () => void): () => void {
  throttledChainlinkSubCount += 1;
  ensureThrottledChainlinkBridge();
  throttledChainlinkListeners.add(onChange);
  return () => {
    throttledChainlinkListeners.delete(onChange);
    throttledChainlinkSubCount = Math.max(0, throttledChainlinkSubCount - 1);
    releaseThrottledChainlinkBridge();
  };
}

function getThrottledChainlinkSnapshot(): ChainlinkPricesMap {
  return throttledChainlinkMap;
}

/**
 * Chainlink /ws/prices at most every `ms` (shared store; lowest active `ms` wins).
 * Does NOT re-render on every live tick.
 */
export function useThrottledChainlinkPricesMap(ms = 1000): ChainlinkPricesMap {
  useEffect(() => {
    if (ms > 0 && ms < throttledChainlinkMs) throttledChainlinkMs = ms;
  }, [ms]);
  return useSyncExternalStore(
    subscribeThrottledChainlink,
    getThrottledChainlinkSnapshot,
    getThrottledChainlinkSnapshot,
  );
}

onBackendReconnect(() => {
  if (refCount <= 0) return;
  if (ws != null) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    return;
  }
  connect();
});
