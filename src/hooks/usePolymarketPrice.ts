import { useEffect, useState, useSyncExternalStore } from 'react';
import { WS_BASE } from '../lib/env';

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
      if (typeof msg.timestamp === 'number') tsMap[k] = msg.timestamp;
      if (pricesMap[k] === msg.price) return;
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

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  refCount += 1;
  if (refCount === 1) connect();
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
