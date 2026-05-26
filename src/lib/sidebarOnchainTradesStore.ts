import { useSyncExternalStore } from 'react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import type { WSPosition, WSTrade } from '../hooks/useOnchainTradesWS';

type SidebarOnchainTradesSnapshot = {
  tradesDigest: number;
  trades: LiveTrade[];
  walletPositionsDigest: number;
  walletPositions: WSPosition[];
  gridWalletPositionsDigest: number;
  gridWalletPositions: WSPosition[];
  walletMarketTradesDigest: number;
  walletMarketTrades: WSTrade[];
};

const EMPTY: SidebarOnchainTradesSnapshot = {
  tradesDigest: 0,
  trades: [],
  walletPositionsDigest: 0,
  walletPositions: [],
  gridWalletPositionsDigest: 0,
  gridWalletPositions: [],
  walletMarketTradesDigest: 0,
  walletMarketTrades: [],
};

let snap: SidebarOnchainTradesSnapshot = EMPTY;
const listeners = new Set<() => void>();

let refreshWalletImpl: (() => void) | null = null;
let refreshMarketTradesImpl: ((wallet: string, marketId: string) => void) | null = null;

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
    .map((p) => `${p.tokenId}:${p.size}:${p.avgPrice}`)
    .join('|');
}

export function resetSidebarOnchainTradesStore(): void {
  snap = EMPTY;
  refreshWalletImpl = null;
  refreshMarketTradesImpl = null;
  notify();
}

export function registerSidebarOnchainRefreshFns(fns: {
  refreshWallet: (() => void) | null;
  refreshMarketTrades: ((wallet: string, marketId: string) => void) | null;
}): void {
  refreshWalletImpl = fns.refreshWallet;
  refreshMarketTradesImpl = fns.refreshMarketTrades;
}

export function refreshSidebarOnchainWallet(): void {
  refreshWalletImpl?.();
}

export function refreshSidebarOnchainMarketTrades(wallet: string, marketId: string): void {
  refreshMarketTradesImpl?.(wallet, marketId);
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
  snap = { ...snap, gridWalletPositions: next, gridWalletPositionsDigest: snap.gridWalletPositionsDigest + 1 };
  notify();
}

export function setSidebarOnchainWalletMarketTrades(next: WSTrade[]): void {
  if (walletMarketTradesHeadEqual(snap.walletMarketTrades, next)) return;
  snap = { ...snap, walletMarketTrades: next, walletMarketTradesDigest: snap.walletMarketTradesDigest + 1 };
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

export function useSidebarOnchainWalletMarketTrades(): WSTrade[] {
  const digest = useSyncExternalStore(
    subscribeSidebarOnchainTrades,
    () => getSidebarOnchainTradesSnapshot().walletMarketTradesDigest,
    () => getSidebarOnchainTradesSnapshot().walletMarketTradesDigest,
  );
  void digest;
  return getSidebarOnchainTradesSnapshot().walletMarketTrades;
}
