import { useEffect, useState, useSyncExternalStore } from 'react';
import { API_BASE, WS_BASE } from '../lib/env';
import { fetchBackend } from '../lib/fetchBackend';
import { onBackendReconnect } from '../lib/backendReconnect';

interface PriceState {
  price: number | null;
  timestamp: number | null;
}

export type ChainlinkPricesMap = Record<string, number>;

// Single shared /ws/prices socket for the whole app. Every consumer (grid cells,
// HUD, chart panels, sidebar strip) reads from this one connection via refCount,
// instead of opening its own socket. Backend proxies Polymarket's Chainlink feed
// with correct Origin for the undelayed stream.
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

function connect(): void {
  if (ws != null) return;
  const sock = new WebSocket(`${WS_BASE}/ws/prices`);
  ws = sock;

  sock.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as { asset?: string; price?: number; timestamp?: number };
      if (typeof msg.asset !== 'string' || typeof msg.price !== 'number' || msg.price <= 0) return;
      const k = msg.asset.toUpperCase();
      lastWsMsgAt = Date.now();
      const ts = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
      const prevTs = tsMap[k];
      const prevPrice = pricesMap[k];
      tsMap[k] = ts;
      if (prevPrice === msg.price && prevTs === ts) return;
      pricesMap = { ...pricesMap, [k]: msg.price };
      emit();
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
    }, 3000);
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
  const stale = lastWsMsgAt > 0 && Date.now() - lastWsMsgAt > CHAINLINK_WS_STALE_MS;
  if (!stale && lastWsMsgAt > 0) return;
  try {
    const r = await fetchBackend(`${API_BASE}/api/chainlink-spot`, undefined, 4000);
    if (!r.ok) return;
    const body = (await r.json()) as Record<string, number>;
    let changed = false;
    const next = { ...pricesMap };
    for (const [asset, price] of Object.entries(body)) {
      if (typeof price !== 'number' || price <= 0 || !Number.isFinite(price)) continue;
      const k = asset.toUpperCase();
      if (next[k] === price) continue;
      next[k] = price;
      tsMap[k] = Date.now();
      changed = true;
    }
    if (changed) {
      pricesMap = next;
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
 * Single WS to /ws/prices: keeps latest Chainlink spot per asset (keys uppercased, e.g. BTC).
 * Shared across all consumers — one socket regardless of how many components mount.
 */
export function useChainlinkPricesMap(): ChainlinkPricesMap {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Single-asset Chainlink price from the shared /ws/prices socket.
 * Returns current price and timestamp.
 */
export function usePolymarketPrice(asset: string | null): PriceState {
  const map = useChainlinkPricesMap();
  if (!asset) return { price: null, timestamp: null };
  const k = asset.toUpperCase();
  const price = map[k] ?? null;
  return { price, timestamp: price != null ? tsMap[k] ?? null : null };
}

/** Chainlink /ws/prices at most every `ms` — UpDownMarketsPanel was full tick × all cells. */
export function useThrottledChainlinkPricesMap(ms = 1000): ChainlinkPricesMap {
  const live = useChainlinkPricesMap();
  const [prices, setPrices] = useState(live);

  useEffect(() => {
    let latest = live;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      setPrices((prev) => {
        if (prev === latest) return prev;
        const pk = Object.keys(prev).sort().join(',');
        const lk = Object.keys(latest).sort().join(',');
        if (pk !== lk) return latest;
        for (const k of Object.keys(latest)) {
          if (prev[k] !== latest[k]) return latest;
        }
        return prev;
      });
    };

    const schedule = () => {
      if (timer != null) return;
      timer = setTimeout(flush, ms);
    };

    latest = live;
    schedule();

    return () => {
      if (timer != null) clearTimeout(timer);
    };
  }, [live, ms]);

  return prices;
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
