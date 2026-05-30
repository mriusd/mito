import { useSyncExternalStore } from 'react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import type { WSPosition, WSTrade, WalletPnlDailyWS } from '../hooks/useOnchainTradesWS';
import type { WalletPosition } from '../api';

type SidebarOnchainTradesSnapshot = {
  tradesDigest: number;
  trades: LiveTrade[];
  walletPositionsDigest: number;
  walletPositions: WSPosition[];
  gridWalletPositionsDigest: number;
  gridWalletPositions: WSPosition[];
  walletTradesDigest: number;
  walletTrades: WSTrade[];
  walletHistoryDigest: number;
  walletHistory: WalletPosition[];
  walletPnlDailyDigest: number;
  walletPnlDaily: WalletPnlDailyWS | null;
  walletMarketTradesDigest: number;
  walletMarketTrades: WSTrade[];
  walletWsHydrated: boolean;
  walletHistoryHydrated: boolean;
  walletMarketTradesHydrated: boolean;
};

const EMPTY: SidebarOnchainTradesSnapshot = {
  tradesDigest: 0,
  trades: [],
  walletPositionsDigest: 0,
  walletPositions: [],
  gridWalletPositionsDigest: 0,
  gridWalletPositions: [],
  walletTradesDigest: 0,
  walletTrades: [],
  walletHistoryDigest: 0,
  walletHistory: [],
  walletPnlDailyDigest: 0,
  walletPnlDaily: null,
  walletMarketTradesDigest: 0,
  walletMarketTrades: [],
  walletWsHydrated: false,
  walletHistoryHydrated: false,
  walletMarketTradesHydrated: false,
};

let snap: SidebarOnchainTradesSnapshot = EMPTY;
let walletMarketTradesScopeKey = '';
const listeners = new Set<() => void>();

let refreshWalletImpl: (() => void) | null = null;
let refreshMarketTradesImpl: ((wallet: string, marketId: string) => void) | null = null;
let subscribeWalletPnlImpl: ((wallet: string, from: string, to: string) => void) | null = null;

function notify(): void {
  for (const fn of listeners) fn();
}

function liveTradesHeadEqual(a: LiveTrade[], b: LiveTrade[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  const n = Math.min(6, a.length);
  for (let i = 0; i < n; i++) {
    const p = a[i];
    const t = b[i];
    if (p === t) continue;
    if (
      p.id !== t.id ||
      p.timestamp !== t.timestamp ||
      p.size !== t.size ||
      p.pending !== t.pending ||
      p.txHash !== t.txHash
    ) {
      return false;
    }
  }
  return true;
}

function walletMarketTradesHeadEqual(a: WSTrade[], b: WSTrade[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  const p0 = a[0];
  const t0 = b[0];
  return p0.id === t0.id && p0.blockTime === t0.blockTime && p0.logIndex === t0.logIndex;
}

function wsPositionsSig(rows: WSPosition[]): string {
  if (rows.length === 0) return '';
  return rows
    .slice(0, 8)
    .map((p) => `${p.tokenId}:${p.size}:${p.avgPrice}:${p.feesPaid ?? ''}`)
    .join('|');
}

function walletHistorySig(rows: WalletPosition[]): string {
  if (rows.length === 0) return '';
  return rows
    .slice(0, 6)
    .map((r) => `${r.marketId}:${r.tradeCount}:${r.lastTradeTime}:${r.usdcIn}:${r.usdcOut}`)
    .join('|');
}

export function resetSidebarOnchainTradesStore(): void {
  snap = EMPTY;
  walletMarketTradesScopeKey = '';
  refreshWalletImpl = null;
  refreshMarketTradesImpl = null;
  subscribeWalletPnlImpl = null;
  notify();
}

export function clearSidebarOnchainWalletTrades(): void {
  if (snap.walletTrades.length === 0) return;
  snap = {
    ...snap,
    walletTrades: [],
    walletTradesDigest: snap.walletTradesDigest + 1,
  };
  notify();
}

export function resetSidebarOnchainWalletMarketTradesScope(scopeKey: string): void {
  if (walletMarketTradesScopeKey === scopeKey) return;
  walletMarketTradesScopeKey = scopeKey;
  snap = { ...snap, walletMarketTradesHydrated: false };
  notify();
}

export function registerSidebarOnchainRefreshFns(fns: {
  refreshWallet: (() => void) | null;
  refreshMarketTrades: ((wallet: string, marketId: string) => void) | null;
  subscribeWalletPnl: ((wallet: string, from: string, to: string) => void) | null;
}): void {
  refreshWalletImpl = fns.refreshWallet;
  refreshMarketTradesImpl = fns.refreshMarketTrades;
  subscribeWalletPnlImpl = fns.subscribeWalletPnl;
}

export function refreshSidebarOnchainWallet(): void {
  refreshWalletImpl?.();
}

export function refreshSidebarOnchainMarketTrades(wallet: string, marketId: string): void {
  refreshMarketTradesImpl?.(wallet, marketId);
}

export function refreshSidebarOnchainWalletPnl(wallet: string, from: string, to: string): void {
  subscribeWalletPnlImpl?.(wallet.trim().toLowerCase(), from.trim(), to.trim());
}

export function setSidebarOnchainLiveTrades(next: LiveTrade[]): void {
  if (liveTradesHeadEqual(snap.trades, next)) return;
  snap = { ...snap, trades: next, tradesDigest: snap.tradesDigest + 1 };
  notify();
}

export function setSidebarOnchainWalletPositions(next: WSPosition[]): void {
  const sig = wsPositionsSig(next);
  const prevSig = wsPositionsSig(snap.walletPositions);
  if (sig === prevSig && next.length === snap.walletPositions.length) return;
  snap = { ...snap, walletPositions: next, walletPositionsDigest: snap.walletPositionsDigest + 1 };
  notify();
}

export function setSidebarOnchainGridWalletPositions(next: WSPosition[]): void {
  const sig = wsPositionsSig(next);
  const prevSig = wsPositionsSig(snap.gridWalletPositions);
  if (sig === prevSig && next.length === snap.gridWalletPositions.length) return;
  snap = { ...snap, gridWalletPositions: next, gridWalletPositionsDigest: snap.gridWalletPositionsDigest + 1, walletWsHydrated: true };
  notify();
}

export function setSidebarOnchainWalletTrades(next: WSTrade[]): void {
  if (next.length === 0 && snap.walletTrades.length > 0) return;
  if (walletMarketTradesHeadEqual(snap.walletTrades, next)) {
    if (!snap.walletWsHydrated) {
      snap = { ...snap, walletWsHydrated: true };
      notify();
    }
    return;
  }
  snap = {
    ...snap,
    walletTrades: next,
    walletTradesDigest: snap.walletTradesDigest + 1,
    walletWsHydrated: true,
  };
  notify();
}

export function setSidebarOnchainWalletHistory(next: WalletPosition[]): void {
  const sig = walletHistorySig(next);
  const prevSig = walletHistorySig(snap.walletHistory);
  if (sig === prevSig && next.length === snap.walletHistory.length) {
    if (!snap.walletWsHydrated || !snap.walletHistoryHydrated) {
      snap = { ...snap, walletWsHydrated: true, walletHistoryHydrated: true };
      notify();
    }
    return;
  }
  snap = {
    ...snap,
    walletHistory: next,
    walletHistoryDigest: snap.walletHistoryDigest + 1,
    walletWsHydrated: true,
    walletHistoryHydrated: true,
  };
  notify();
}

export function setSidebarOnchainWalletPnlDaily(next: WalletPnlDailyWS | null): void {
  const sig = next ? `${next.from}|${next.to}|${Object.keys(next.tradeByDate).length}|${Object.keys(next.marketByDate).length}` : '';
  const prev = snap.walletPnlDaily;
  const prevSig = prev ? `${prev.from}|${prev.to}|${Object.keys(prev.tradeByDate).length}|${Object.keys(prev.marketByDate).length}` : '';
  if (sig === prevSig && next === prev) {
    if (next && !snap.walletWsHydrated) {
      snap = { ...snap, walletWsHydrated: true };
      notify();
    }
    return;
  }
  // shallow compare first keys for value changes when lengths match
  if (sig === prevSig && prev && next) {
    let same = true;
    for (const k of Object.keys(next.tradeByDate)) {
      const a = prev.tradeByDate[k];
      const b = next.tradeByDate[k];
      if (!a || !b || a.bought !== b.bought || a.sold !== b.sold) {
        same = false;
        break;
      }
    }
    if (same) return;
  }
  snap = {
    ...snap,
    walletPnlDaily: next,
    walletPnlDailyDigest: snap.walletPnlDailyDigest + 1,
    walletWsHydrated: next != null ? true : snap.walletWsHydrated,
  };
  notify();
}

export function setSidebarOnchainWalletMarketTrades(next: WSTrade[], scopeKey = walletMarketTradesScopeKey): void {
  if (scopeKey !== walletMarketTradesScopeKey) return;
  if (walletMarketTradesHeadEqual(snap.walletMarketTrades, next)) {
    if (!snap.walletMarketTradesHydrated) {
      snap = { ...snap, walletMarketTradesHydrated: true };
      notify();
    }
    return;
  }
  snap = {
    ...snap,
    walletMarketTrades: next,
    walletMarketTradesDigest: snap.walletMarketTradesDigest + 1,
    walletMarketTradesHydrated: true,
  };
  notify();
}

export function subscribeSidebarOnchainTrades(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getSidebarOnchainTradesSnapshot(): SidebarOnchainTradesSnapshot {
  return snap;
}

export function useSidebarOnchainLiveTrades(): LiveTrade[] {
  const digest = useSyncExternalStore(
    subscribeSidebarOnchainTrades,
    () => getSidebarOnchainTradesSnapshot().tradesDigest,
    () => getSidebarOnchainTradesSnapshot().tradesDigest,
  );
  void digest;
  return getSidebarOnchainTradesSnapshot().trades;
}

export function useSidebarOnchainWalletPositions(): WSPosition[] {
  const digest = useSyncExternalStore(
    subscribeSidebarOnchainTrades,
    () => getSidebarOnchainTradesSnapshot().walletPositionsDigest,
    () => getSidebarOnchainTradesSnapshot().walletPositionsDigest,
  );
  void digest;
  return getSidebarOnchainTradesSnapshot().walletPositions;
}

export function useSidebarOnchainGridWalletPositions(): WSPosition[] {
  const digest = useSyncExternalStore(
    subscribeSidebarOnchainTrades,
    () => getSidebarOnchainTradesSnapshot().gridWalletPositionsDigest,
    () => getSidebarOnchainTradesSnapshot().gridWalletPositionsDigest,
  );
  void digest;
  return getSidebarOnchainTradesSnapshot().gridWalletPositions;
}

export function useSidebarOnchainWalletTrades(): WSTrade[] {
  const digest = useSyncExternalStore(
    subscribeSidebarOnchainTrades,
    () => getSidebarOnchainTradesSnapshot().walletTradesDigest,
    () => getSidebarOnchainTradesSnapshot().walletTradesDigest,
  );
  void digest;
  return getSidebarOnchainTradesSnapshot().walletTrades;
}

export function useSidebarOnchainWalletWsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeSidebarOnchainTrades,
    () => getSidebarOnchainTradesSnapshot().walletWsHydrated,
    () => getSidebarOnchainTradesSnapshot().walletWsHydrated,
  );
}

export function useSidebarOnchainWalletHistoryHydrated(): boolean {
  return useSyncExternalStore(
    subscribeSidebarOnchainTrades,
    () => getSidebarOnchainTradesSnapshot().walletHistoryHydrated,
    () => getSidebarOnchainTradesSnapshot().walletHistoryHydrated,
  );
}

export function useSidebarOnchainWalletMarketTradesHydrated(): boolean {
  return useSyncExternalStore(
    subscribeSidebarOnchainTrades,
    () => getSidebarOnchainTradesSnapshot().walletMarketTradesHydrated,
    () => getSidebarOnchainTradesSnapshot().walletMarketTradesHydrated,
  );
}

export function useSidebarOnchainWalletHistory(): WalletPosition[] {
  const digest = useSyncExternalStore(
    subscribeSidebarOnchainTrades,
    () => getSidebarOnchainTradesSnapshot().walletHistoryDigest,
    () => getSidebarOnchainTradesSnapshot().walletHistoryDigest,
  );
  void digest;
  return getSidebarOnchainTradesSnapshot().walletHistory;
}

export function useSidebarOnchainWalletPnlDaily(): WalletPnlDailyWS | null {
  const digest = useSyncExternalStore(
    subscribeSidebarOnchainTrades,
    () => getSidebarOnchainTradesSnapshot().walletPnlDailyDigest,
    () => getSidebarOnchainTradesSnapshot().walletPnlDailyDigest,
  );
  void digest;
  return getSidebarOnchainTradesSnapshot().walletPnlDaily;
}

export function useSidebarOnchainWalletMarketTrades(): WSTrade[] {
  const digest = useSyncExternalStore(
    subscribeSidebarOnchainTrades,
    () => getSidebarOnchainTradesSnapshot().walletMarketTradesDigest,
    () => getSidebarOnchainTradesSnapshot().walletMarketTradesDigest,
  );
  void digest;
  return getSidebarOnchainTradesSnapshot().walletMarketTrades;
}
