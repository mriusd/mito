/** Cohort tilt flash + whale price gate — ref store so Sidebar body skips toxic WS ticks. */
export type SidebarToxicNotifySnapshot = {
  topBarExtremeBgFlash: 'green' | 'red' | null;
  whalePassesPriceGate: boolean;
};

const EMPTY: SidebarToxicNotifySnapshot = {
  topBarExtremeBgFlash: null,
  whalePassesPriceGate: false,
};

let snap: SidebarToxicNotifySnapshot = EMPTY;
const listeners = new Set<() => void>();

export function setSidebarToxicNotify(next: SidebarToxicNotifySnapshot): void {
  if (
    snap.topBarExtremeBgFlash === next.topBarExtremeBgFlash &&
    snap.whalePassesPriceGate === next.whalePassesPriceGate
  ) {
    return;
  }
  snap = next;
  for (const fn of listeners) fn();
}

export function resetSidebarToxicNotify(): void {
  if (snap.topBarExtremeBgFlash === null && !snap.whalePassesPriceGate) return;
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
