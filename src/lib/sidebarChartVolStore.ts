import { useSyncExternalStore } from 'react';

let annualVolPct: number | null = null;
const listeners = new Set<() => void>();

export function setSidebarChartAnnualVolPct(next: number | null): void {
  if (next === annualVolPct) return;
  annualVolPct = next;
  for (const fn of listeners) fn();
}

export function getSidebarChartAnnualVolPct(): number | null {
  return annualVolPct;
}

export function subscribeSidebarChartAnnualVolPct(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function useSidebarChartAnnualVolPct(): number | null {
  return useSyncExternalStore(
    subscribeSidebarChartAnnualVolPct,
    getSidebarChartAnnualVolPct,
    getSidebarChartAnnualVolPct,
  );
}

export function sidebarVolBelowMaxCap(vol: number | null, maxVolPct: number): boolean {
  return maxVolPct > 0 && vol != null && Number.isFinite(vol) && vol < maxVolPct;
}
