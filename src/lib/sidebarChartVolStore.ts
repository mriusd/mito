import { useSyncExternalStore } from 'react';

let annualVolPct: number | null = null;
const listeners = new Set<() => void>();

export function setSidebarChartAnnualVolPct(next: number | null): void {
  // Treat near-equal floats as equal (display is 0.1%); always accept null transitions.
  if (next == null && annualVolPct == null) return;
  if (
    next != null &&
    annualVolPct != null &&
    Number.isFinite(next) &&
    Number.isFinite(annualVolPct) &&
    Math.abs(next - annualVolPct) < 1e-6
  ) {
    return;
  }
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

export const SIDEBAR_NOTIFY_MAX_VOLATILITY_PCT_KEY = 'polybot-sidebar-notify-max-volatility-pct';

/** Annualized σ% ceiling for tilt alerts. 0 = off. Default 15. */
export function readNotifyMaxVolatilityPct(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_MAX_VOLATILITY_PCT_KEY);
    const n = parseFloat(raw ?? '15');
    if (!Number.isFinite(n) || n < 0) return 15;
    return Math.min(500, Math.round(n));
  } catch {
    return 15;
  }
}

/** True when max-vol cap is off, or chart σ is known and at/below the cap. */
export function notifyVolatilityGatePasses(
  maxVolPct = readNotifyMaxVolatilityPct(),
  vol = getSidebarChartAnnualVolPct(),
): boolean {
  if (maxVolPct <= 0) return true;
  if (vol == null || !Number.isFinite(vol)) return false;
  return vol <= maxVolPct;
}
