import { startTransition, useCallback, useSyncExternalStore } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  getBidAskMarketRow,
  subscribeBidAskMarketLookup,
  subscribeBidAskMarketLookupGridFlush,
} from './bidAskMarketLookup';
import {
  getSidebarOnchainTradesSnapshot,
  subscribeSidebarOnchainTrades,
} from './sidebarOnchainTradesStore';
import { getPositionClobTokenId } from '../utils/format';
import type { Market, Order, Trade } from '../types';
import type { WSPosition, WSTrade } from '../hooks/useOnchainTradesWS';

export type TpoPanelDataSnap = {
  positions: ReturnType<typeof useAppStore.getState>['positions'];
  orders: Order[];
  trades: Trade[];
  onchainPositions: WSPosition[];
  onchainTrades: WSTrade[];
  quoteLookup: Record<string, Market>;
  /** All position/order token ids for chart bid/ask watch (not only those already quoted). */
  watchTokenIds: string[];
};

export type TpoDataSlice = 'positions' | 'orders' | 'trades';

const FLUSH_MS = 2000;
/** Live bid/ask → positions table. Faster than grid 2s so Bid/Ask stay current. */
const QUOTE_FLUSH_MS = 400;

let snap: TpoPanelDataSnap = {
  positions: [],
  orders: [],
  trades: [],
  onchainPositions: [],
  onchainTrades: [],
  quoteLookup: {},
  watchTokenIds: [],
};

/** Per-slice views — identity stable when that slice did not change. */
let positionsView: TpoPanelDataSnap = snap;
let ordersView: TpoPanelDataSnap = snap;
let tradesView: TpoPanelDataSnap = snap;

const positionsListeners = new Set<() => void>();
const ordersListeners = new Set<() => void>();
const tradesListeners = new Set<() => void>();

let timer: ReturnType<typeof setTimeout> | null = null;
let quoteTimer: ReturnType<typeof setTimeout> | null = null;
let bootstrapped = false;

function readQuoteLookup(ids: readonly string[]): Record<string, Market> {
  const out: Record<string, Market> = {};
  for (const id of ids) {
    const row = getBidAskMarketRow(id);
    if (row) out[id] = row;
  }
  return out;
}

function collectTokenIds(
  positions: TpoPanelDataSnap['positions'],
  orders: Order[],
  trades: Trade[],
  onchainPositions: WSPosition[],
  onchainTrades: WSTrade[],
  selectedClobIds: readonly string[] | undefined,
): string[] {
  const set = new Set<string>();
  for (const p of positions) {
    const tid = getPositionClobTokenId(p);
    if (tid) set.add(tid);
  }
  let orderN = 0;
  for (const o of orders) {
    if (orderN >= 200) break;
    const t = o.asset_id || o.token_id;
    if (t) {
      set.add(t);
      orderN += 1;
    }
  }
  let tradeN = 0;
  for (const t of trades) {
    if (tradeN >= 200) break;
    const id = t.asset_id || t.asset || t.token_id;
    if (id) {
      set.add(id);
      tradeN += 1;
    }
  }
  for (const r of onchainPositions) {
    if (r.tokenId) set.add(String(r.tokenId));
  }
  for (const t of onchainTrades.slice(0, 200)) {
    if (t.tokenId) set.add(String(t.tokenId));
  }
  for (const t of selectedClobIds || []) {
    if (t) set.add(String(t));
  }
  for (const id of [...set]) {
    const m = getBidAskMarketRow(id);
    for (const leg of m?.clobTokenIds || []) {
      if (leg) set.add(String(leg));
    }
  }
  return [...set];
}

function quoteLookupEqual(a: Record<string, Market>, b: Record<string, Market>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of keys) {
    if (a[id] !== b[id]) return false;
  }
  return true;
}

function watchTokenIdsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function notify(set: Set<() => void>): void {
  if (set.size === 0) return;
  startTransition(() => {
    for (const l of set) l();
  });
}

/** Quote-only wake — re-read pending/store bid/ask without waiting for full 2s grid flush. */
function flushQuotesOnly(): void {
  quoteTimer = null;
  if (positionsListeners.size === 0 && ordersListeners.size === 0) return;
  const ids = snap.watchTokenIds.length > 0
    ? snap.watchTokenIds
    : collectTokenIds(
        snap.positions,
        snap.orders,
        snap.trades,
        snap.onchainPositions,
        snap.onchainTrades,
        useAppStore.getState().selectedMarket?.clobTokenIds,
      );
  const quoteLookup = readQuoteLookup(ids);
  if (quoteLookupEqual(snap.quoteLookup, quoteLookup)) return;
  snap = {
    ...snap,
    quoteLookup,
  };
  if (positionsListeners.size > 0) {
    positionsView = snap;
    notify(positionsListeners);
  }
  if (ordersListeners.size > 0) {
    ordersView = snap;
    notify(ordersListeners);
  }
}

function scheduleQuoteFlush(): void {
  if (quoteTimer != null) return;
  quoteTimer = setTimeout(flushQuotesOnly, QUOTE_FLUSH_MS);
}

function flushNow(): void {
  timer = null;
  if (quoteTimer != null) {
    clearTimeout(quoteTimer);
    quoteTimer = null;
  }
  const app = useAppStore.getState();
  const onchain = getSidebarOnchainTradesSnapshot();
  const positions = app.positions;
  const orders = app.orders;
  const trades = app.trades;
  const onchainPositions = onchain.gridWalletPositions;
  const onchainTrades = onchain.walletTrades;
  const ids = collectTokenIds(
    positions,
    orders,
    trades,
    onchainPositions,
    onchainTrades,
    app.selectedMarket?.clobTokenIds,
  );
  const quoteLookup = readQuoteLookup(ids);
  const watchTokenIds = ids.slice().sort();

  const positionsChanged =
    snap.positions !== positions || snap.onchainPositions !== onchainPositions;
  const ordersChanged = snap.orders !== orders;
  const tradesChanged = snap.trades !== trades || snap.onchainTrades !== onchainTrades;
  const quotesChanged = !quoteLookupEqual(snap.quoteLookup, quoteLookup);
  const watchChanged = !watchTokenIdsEqual(snap.watchTokenIds, watchTokenIds);
  if (!positionsChanged && !ordersChanged && !tradesChanged && !quotesChanged && !watchChanged) return;

  snap = {
    positions,
    orders,
    trades,
    onchainPositions,
    onchainTrades,
    quoteLookup: quotesChanged ? quoteLookup : snap.quoteLookup,
    watchTokenIds: watchChanged ? watchTokenIds : snap.watchTokenIds,
  };

  // Positions: marks + size. Orders-only WS must NOT rebuild positions table.
  if (positionsChanged || quotesChanged || watchChanged) {
    positionsView = snap;
    notify(positionsListeners);
  } else if (ordersChanged) {
    positionsView = snap; // fresh sell map on next positions wake; no notify
  }
  // Orders table also shows live Bid/Mid/Ask — refresh quoteLookup on quote ticks.
  if (ordersChanged || quotesChanged || watchChanged) {
    ordersView = snap;
    notify(ordersListeners);
  }
  if (tradesChanged) {
    tradesView = snap;
    notify(tradesListeners);
  }
}

function scheduleFlush(): void {
  if (timer != null) return;
  timer = setTimeout(flushNow, FLUSH_MS);
}

function ensureBootstrapped(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  flushNow();
  useAppStore.subscribe((state, prev) => {
    if (
      state.positions === prev.positions &&
      state.orders === prev.orders &&
      state.trades === prev.trades &&
      state.selectedMarket?.clobTokenIds === prev.selectedMarket?.clobTokenIds
    ) {
      return;
    }
    scheduleFlush();
  });
  subscribeSidebarOnchainTrades(scheduleFlush);
  // Live WS bid/ask (pending) — keep TPO Bid/Mid/Ask current (~400ms).
  subscribeBidAskMarketLookup(() => {
    if (positionsListeners.size === 0 && ordersListeners.size === 0) return;
    scheduleQuoteFlush();
  });
  // Store flush / grid digest — full re-collect of token ids + quotes.
  subscribeBidAskMarketLookupGridFlush(() => {
    if (positionsListeners.size === 0 && ordersListeners.size === 0) return;
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    flushNow();
  });
}

function subscribeSlice(slice: TpoDataSlice, listener: () => void): () => void {
  ensureBootstrapped();
  const set =
    slice === 'positions' ? positionsListeners : slice === 'orders' ? ordersListeners : tradesListeners;
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

function getSliceSnapshot(slice: TpoDataSlice): TpoPanelDataSnap {
  ensureBootstrapped();
  if (slice === 'positions') return positionsView;
  if (slice === 'orders') return ordersView;
  return tradesView;
}

/** Shared TPO snapshot — each tab only wakes when its slice changes. */
export function useTpoPanelData(enabled: boolean, slice: TpoDataSlice): TpoPanelDataSnap {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!enabled) return () => {};
      return subscribeSlice(slice, onStoreChange);
    },
    [enabled, slice],
  );
  const getSnapshot = useCallback(() => getSliceSnapshot(slice), [slice]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
