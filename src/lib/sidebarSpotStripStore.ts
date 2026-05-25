import { useSyncExternalStore } from 'react';

export type SidebarSpotStripBsSnapshot = {
  yesMathCents: number | null;
  mathCents: number | null;
  pastExpiry: boolean;
} | null;

let bsSnapshot: SidebarSpotStripBsSnapshot = null;
let bsDigest = 0;
const bsListeners = new Set<() => void>();

function bsSig(s: SidebarSpotStripBsSnapshot): string {
  if (!s) return 'null';
  return `${s.pastExpiry ? 1 : 0}|${s.yesMathCents ?? 'n'}|${s.mathCents ?? 'n'}`;
}

export function setSidebarSpotStripBsSnapshot(next: SidebarSpotStripBsSnapshot): void {
  if (bsSig(next) === bsSig(bsSnapshot)) return;
  bsSnapshot = next;
  bsDigest += 1;
  for (const l of bsListeners) l();
}

export function getSidebarSpotStripBsSnapshot(): SidebarSpotStripBsSnapshot {
  return bsSnapshot;
}

export function subscribeSidebarSpotStripBs(onStoreChange: () => void): () => void {
  bsListeners.add(onStoreChange);
  return () => bsListeners.delete(onStoreChange);
}

export function useSidebarSpotStripBs(): SidebarSpotStripBsSnapshot {
  return useSyncExternalStore(
    subscribeSidebarSpotStripBs,
    () => getSidebarSpotStripBsSnapshot(),
    () => getSidebarSpotStripBsSnapshot(),
  );
}

export function roundSidebarBsMathCents(cents: number | null | undefined): number | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  const r = Math.round(cents);
  if (r < 1 || r > 99) return null;
  return r;
}

export function sidebarBsMathCentsForOutcome(
  yesMathCents: number | null | undefined,
  outcome: string | null | undefined,
): number | null {
  if (yesMathCents == null || !Number.isFinite(yesMathCents)) return null;
  if (outcome === 'YES') return roundSidebarBsMathCents(yesMathCents);
  if (outcome === 'NO') return roundSidebarBsMathCents(100 - yesMathCents);
  return null;
}

export function sidebarBsMathButtonLabel(cents: number | null): string {
  return cents == null ? '—' : `${cents}c`;
}
