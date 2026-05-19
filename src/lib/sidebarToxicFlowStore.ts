import { useSyncExternalStore } from 'react';
import type { ToxicFlowData } from '../api';
import { toxicFlowPayloadEqual } from '../lib/toxicFlowStakeCohort';

type SidebarToxicFlowSnapshot = {
  data: ToxicFlowData | null;
  digest: number;
  refreshing: boolean;
};

const EMPTY: SidebarToxicFlowSnapshot = { data: null, digest: 0, refreshing: false };

let snap = EMPTY;
let refreshImpl: (() => Promise<void>) | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const fn of listeners) fn();
}

export function resetSidebarToxicFlowStore(): void {
  snap = EMPTY;
  refreshImpl = null;
  notifyListeners();
}

export function registerSidebarToxicFlowRefresh(fn: (() => Promise<void>) | null): void {
  refreshImpl = fn;
}

export function refreshSidebarToxicFlow(): Promise<void> {
  if (!refreshImpl) return Promise.resolve();
  return refreshImpl();
}

export function setSidebarToxicFlowRefreshing(refreshing: boolean): void {
  if (snap.refreshing === refreshing) return;
  snap = { ...snap, refreshing };
  notifyListeners();
}

export function setSidebarToxicFlowData(next: ToxicFlowData | null): void {
  if (next == null) {
    if (snap.data == null) return;
    snap = { data: null, digest: snap.digest + 1, refreshing: snap.refreshing };
    notifyListeners();
    return;
  }
  if (snap.data && toxicFlowPayloadEqual(snap.data, next)) return;
  snap = { data: next, digest: snap.digest + 1, refreshing: snap.refreshing };
  notifyListeners();
}

export function subscribeSidebarToxicFlow(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getSidebarToxicFlowSnapshot(): SidebarToxicFlowSnapshot {
  return snap;
}

export function useSidebarToxicFlowData(): ToxicFlowData | null {
  const digest = useSyncExternalStore(
    subscribeSidebarToxicFlow,
    () => getSidebarToxicFlowSnapshot().digest,
    () => getSidebarToxicFlowSnapshot().digest,
  );
  void digest;
  return getSidebarToxicFlowSnapshot().data;
}

export function useSidebarToxicFlowRefreshing(): boolean {
  return useSyncExternalStore(
    subscribeSidebarToxicFlow,
    () => getSidebarToxicFlowSnapshot().refreshing,
    () => getSidebarToxicFlowSnapshot().refreshing,
  );
}
