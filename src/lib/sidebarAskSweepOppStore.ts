import { useSyncExternalStore } from 'react';

/** Full-ask redeem edge (mitobot opp$) for YES / NO books. null = empty / unknown. */
export type SidebarAskSweepOpp = {
  yesOppUsd: number | null;
  noOppUsd: number | null;
};

let snap: SidebarAskSweepOpp = { yesOppUsd: null, noOppUsd: null };
const listeners = new Set<() => void>();

function oppEq(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 1e-6;
}

export function setSidebarAskSweepOpp(next: SidebarAskSweepOpp): void {
  if (oppEq(snap.yesOppUsd, next.yesOppUsd) && oppEq(snap.noOppUsd, next.noOppUsd)) return;
  snap = next;
  for (const l of listeners) l();
}

export function resetSidebarAskSweepOpp(): void {
  setSidebarAskSweepOpp({ yesOppUsd: null, noOppUsd: null });
}

export function getSidebarAskSweepOppSnapshot(): SidebarAskSweepOpp {
  return snap;
}

export function useSidebarAskSweepOpp(): SidebarAskSweepOpp {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSidebarAskSweepOppSnapshot,
    getSidebarAskSweepOppSnapshot,
  );
}
