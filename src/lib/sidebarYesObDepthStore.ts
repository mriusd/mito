import { useSyncExternalStore } from 'react';

type YesObDepth = { yesBidUsd: number; yesAskUsd: number };

let depth: YesObDepth = { yesBidUsd: 0, yesAskUsd: 0 };
const listeners = new Set<() => void>();

export function setSidebarYesObDepth(next: YesObDepth): void {
  if (depth.yesBidUsd === next.yesBidUsd && depth.yesAskUsd === next.yesAskUsd) return;
  depth = next;
  for (const l of listeners) l();
}

export function resetSidebarYesObDepth(): void {
  setSidebarYesObDepth({ yesBidUsd: 0, yesAskUsd: 0 });
}

export function getSidebarYesObDepthSnapshot(): YesObDepth {
  return depth;
}

export function useSidebarYesObDepth(): YesObDepth {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getSidebarYesObDepthSnapshot,
    getSidebarYesObDepthSnapshot,
  );
}
