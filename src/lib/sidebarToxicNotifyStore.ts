import { useSyncExternalStore } from 'react';
export type SidebarToxicNotifySnapshot = {
  topBarExtremeBgFlash: 'green' | 'red' | null;
  whalePassesPriceGate: boolean;
  insiderPassesGate: boolean;
};

const EMPTY: SidebarToxicNotifySnapshot = {
  topBarExtremeBgFlash: null,
  whalePassesPriceGate: false,
  insiderPassesGate: false,
};

let snap: SidebarToxicNotifySnapshot = EMPTY;
const listeners = new Set<() => void>();

export function setSidebarToxicNotify(next: SidebarToxicNotifySnapshot): void {
  if (
    snap.topBarExtremeBgFlash === next.topBarExtremeBgFlash &&
    snap.whalePassesPriceGate === next.whalePassesPriceGate &&
    snap.insiderPassesGate === next.insiderPassesGate
  ) {
    return;
  }
  snap = next;
  for (const fn of listeners) fn();
}

export function resetSidebarToxicNotify(): void {
  if (snap.topBarExtremeBgFlash === null && !snap.whalePassesPriceGate && !snap.insiderPassesGate) return;
  snap = EMPTY;
  for (const fn of listeners) fn();
}

export function subscribeSidebarToxicNotify(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getSidebarToxicNotify(): SidebarToxicNotifySnapshot {
  return snap;
}

export function useSidebarToxicNotify(): SidebarToxicNotifySnapshot {
  return useSyncExternalStore(
    subscribeSidebarToxicNotify,
    getSidebarToxicNotify,
    getSidebarToxicNotify,
  );
}
