import { useSyncExternalStore } from 'react';
import type { Market } from '../types';

type SidebarUpDownTargetSnapshot = {
  targetPrice: number | null;
  liveSameTfMarket: Market | null;
  digest: number;
};

const EMPTY: SidebarUpDownTargetSnapshot = {
  targetPrice: null,
  liveSameTfMarket: null,
  digest: 0,
};

let snap = EMPTY;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const fn of listeners) fn();
}

export function resetSidebarUpDownTargetStore(): void {
  snap = EMPTY;
  notifyListeners();
}

export function setSidebarUpDownTargetPrice(next: number | null): void {
  const prev = snap.targetPrice;
  if (next == null && prev == null) return;
  if (next != null && prev != null && Math.abs(next - prev) < 1e-9) return;
  snap = { ...snap, targetPrice: next, digest: snap.digest + 1 };
  notifyListeners();
}

export function setSidebarUpDownLiveSameTfMarket(next: Market | null): void {
  const prevId = snap.liveSameTfMarket?.id ?? '';
  const nextId = next?.id ?? '';
  if (prevId === nextId) return;
  snap = { ...snap, liveSameTfMarket: next, digest: snap.digest + 1 };
  notifyListeners();
}

export function subscribeSidebarUpDownTarget(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getSidebarUpDownTargetSnapshot(): SidebarUpDownTargetSnapshot {
  return snap;
}

export function useSidebarUpDownTargetPrice(): number | null {
  const digest = useSyncExternalStore(
    subscribeSidebarUpDownTarget,
    () => getSidebarUpDownTargetSnapshot().digest,
    () => getSidebarUpDownTargetSnapshot().digest,
  );
  void digest;
  return getSidebarUpDownTargetSnapshot().targetPrice;
}

export function useSidebarUpDownLiveSameTfMarket(): Market | null {
  const digest = useSyncExternalStore(
    subscribeSidebarUpDownTarget,
    () => getSidebarUpDownTargetSnapshot().digest,
    () => getSidebarUpDownTargetSnapshot().digest,
  );
  void digest;
  return getSidebarUpDownTargetSnapshot().liveSameTfMarket;
}
