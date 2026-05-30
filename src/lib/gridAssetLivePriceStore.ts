import { useSyncExternalStore } from 'react';
import { useAppStore } from '../stores/appStore';
import { SYMBOLS, type AssetSymbol } from '../types';
import { GRID_BID_ASK_THROTTLE_MS } from './bidAskMarketLookup';

const prices = Object.fromEntries(SYMBOLS.map((s) => [s, 0])) as Record<AssetSymbol, number>;
const latest = { ...prices };
const listeners = new Set<() => void>();
let appUnsub: (() => void) | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let subscriberCount = 0;

function readPricesFromApp(): void {
  const pd = useAppStore.getState().priceData;
  for (const sym of SYMBOLS) {
    latest[sym] = pd[sym]?.price || 0;
  }
}

function notifyIfChanged(): void {
  let changed = false;
  for (const sym of SYMBOLS) {
    if (prices[sym] !== latest[sym]) {
      prices[sym] = latest[sym];
      changed = true;
    }
  }
  if (!changed) return;
  for (const l of listeners) l();
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    notifyIfChanged();
  }, GRID_BID_ASK_THROTTLE_MS);
}

function ensureAppSub(): void {
  if (appUnsub) return;
  readPricesFromApp();
  for (const sym of SYMBOLS) prices[sym] = latest[sym];
  appUnsub = useAppStore.subscribe((state) => {
    let dirty = false;
    for (const sym of SYMBOLS) {
      const p = state.priceData[sym]?.price || 0;
      if (p !== latest[sym]) {
        latest[sym] = p;
        dirty = true;
      }
    }
    if (dirty) scheduleFlush();
  });
}

function clearAppSubIfIdle(): void {
  if (subscriberCount > 0 || !appUnsub) return;
  appUnsub();
  appUnsub = null;
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export function subscribeGridAssetLivePrice(onStoreChange: () => void): () => void {
  subscriberCount += 1;
  ensureAppSub();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    subscriberCount = Math.max(0, subscriberCount - 1);
    clearAppSubIfIdle();
  };
}

export function getGridAssetLivePriceSnapshot(symbol: AssetSymbol): number {
  return prices[symbol] ?? 0;
}

/** One throttled spot price feed per asset for grid cells/cols — not per-cell hooks. */
export function useGridAssetLivePrice(symbol: AssetSymbol): number {
  return useSyncExternalStore(
    subscribeGridAssetLivePrice,
    () => getGridAssetLivePriceSnapshot(symbol),
    () => getGridAssetLivePriceSnapshot(symbol),
  );
}
