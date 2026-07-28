import { startTransition, useCallback, useSyncExternalStore } from 'react';
import { useAppStore } from '../stores/appStore';
import { getBidAskMarketRow, subscribeBidAskMarketLookupGridFlush } from './bidAskMarketLookup';
import {
  getSidebarOnchainTradesSnapshot,
  subscribeSidebarOnchainTrades,
} from './sidebarOnchainTradesStore';
import { getPositionClobTokenId } from '../utils/format';
import type { Market, Order, Trade } from '../types';
import type { WSPosition, WSTrade } from '../hooks/useOnchainTradesWS';

export type TpoPanelDataSnap = {
  digest: number;
  positions: ReturnType<typeof useAppStore.getState>['positions'];
  orders: Order[];
  trades: Trade[];
  onchainPositions: WSPosition[];
  onchainTrades: WSTrade[];
  quoteLookup: Record<string, Market>;
};

const FLUSH_MS = 2000;

let snap: TpoPanelDataSnap = {
  digest: 0,
  positions: [],
  orders: [],
  trades: [],
  onchainPositions: [],
  onchainTrades: [],
  quoteLookup: {},
};

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
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

function flushNow(): void {
  timer = null;
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

  const sameWallet =
    snap.positions === positions &&
    snap.orders === orders &&
    snap.trades === trades &&
    snap.onchainPositions === onchainPositions &&
    snap.onchainTrades === onchainTrades &&
    quoteLookupEqual(snap.quoteLookup, quoteLookup);
  if (sameWallet) return;

  snap = {
    digest: snap.digest + 1,
    positions,
    orders,
    trades,
    onchainPositions,
    onchainTrades,
    quoteLookup,
  };

  startTransition(() => {
    for (const l of listeners) l();
  });
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
  subscribeBidAskMarketLookupGridFlush(() => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    flushNow();
  });
}

export function subscribeTpoPanelData(listener: () => void): () => void {
  ensureBootstrapped();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTpoPanelDataSnapshot(): TpoPanelDataSnap {
  ensureBootstrapped();
  return snap;
}

/** Shared 2s TPO snapshot. Pass enabled=false when panel off-screen — no re-renders. */
export function useTpoPanelData(enabled: boolean): TpoPanelDataSnap {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!enabled) return () => {};
      return subscribeTpoPanelData(onStoreChange);
    },
    [enabled],
  );
  return useSyncExternalStore(subscribe, getTpoPanelDataSnapshot, getTpoPanelDataSnapshot);
}
