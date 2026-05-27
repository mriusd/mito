import { useSyncExternalStore } from 'react';

type ObImbalanceDepth = { yesBidUsd: number; noBidUsd: number };

let depth: ObImbalanceDepth = { yesBidUsd: 0, noBidUsd: 0 };
const listeners = new Set<() => void>();

export function setSidebarYesObDepth(next: ObImbalanceDepth): void {
  if (depth.yesBidUsd === next.yesBidUsd && depth.noBidUsd === next.noBidUsd) return;
  depth = next;
  for (const l of listeners) l();
}

export function resetSidebarYesObDepth(): void {
  setSidebarYesObDepth({ yesBidUsd: 0, noBidUsd: 0 });
}

export function getSidebarYesObDepthSnapshot(): ObImbalanceDepth {
  return depth;
}

export function useSidebarYesObDepth(): ObImbalanceDepth {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSidebarYesObDepthSnapshot,
    getSidebarYesObDepthSnapshot,
  );
}
