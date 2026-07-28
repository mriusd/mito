import { startTransition, useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAppStore } from '../stores/appStore';
import { getBidAskMarketRow, subscribeBidAskMarketLookupGridFlush } from './bidAskMarketLookup';
import {
  getSidebarOnchainTradesSnapshot,
  subscribeSidebarOnchainTrades,
} from './sidebarOnchainTradesStore';
import { getPositionClobTokenId } from '../utils/format';
import type { Market, Order, Trade } from '../types';
import type { WSPosition, WSTrade } from '../hooks/useOnchainTradesWS';

/** Only one TPO panel stays live — duplicates freeze (3× full table kills rAF). */
const visibleTpoPanelIds: string[] = [];
let hotTpoPanelId: string | null = null;
const hotListeners = new Set<() => void>();

function recomputeHotTpoPanel(): void {
  const next = visibleTpoPanelIds[0] ?? null;
  if (next === hotTpoPanelId) return;
  hotTpoPanelId = next;
  startTransition(() => {
    for (const l of hotListeners) l();
  });
}

export function promoteTpoPanelHot(panelId: string): void {
  const id = String(panelId || '').trim();
  if (!id) return;
  const idx = visibleTpoPanelIds.indexOf(id);
  if (idx > 0) {
    visibleTpoPanelIds.splice(idx, 1);
    visibleTpoPanelIds.unshift(id);
  } else if (idx < 0) {
    visibleTpoPanelIds.unshift(id);
  }
  recomputeHotTpoPanel();
}

function setTpoPanelVisible(panelId: string, visible: boolean): void {
  const id = String(panelId || '').trim();
  if (!id) return;
  const idx = visibleTpoPanelIds.indexOf(id);
  if (visible) {
    if (idx < 0) visibleTpoPanelIds.push(id);
  } else if (idx >= 0) {
    visibleTpoPanelIds.splice(idx, 1);
  }
  recomputeHotTpoPanel();
}

function subscribeTpoHot(listener: () => void): () => void {
  hotListeners.add(listener);
  return () => {
    hotListeners.delete(listener);
  };
}

/** True only for the single hot visible TPO panel. */
export function useTpoPanelHot(panelId: string, visible: boolean): boolean {
  useEffect(() => {
    setTpoPanelVisible(panelId, visible);
    return () => setTpoPanelVisible(panelId, false);
  }, [panelId, visible]);

  return useSyncExternalStore(
    subscribeTpoHot,
    () => hotTpoPanelId === panelId,
    () => true,
  );
}

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
  // Pair legs for imply.
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
  // Quotes already grid-throttled (~2s) — flush now, don't wait another FLUSH_MS.
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
