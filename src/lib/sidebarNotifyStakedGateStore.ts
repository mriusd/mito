import { useSyncExternalStore } from 'react';

let passes = true;
const listeners = new Set<() => void>();

export function setSidebarNotifyStakedGatePasses(next: boolean): void {
  if (next === passes) return;
  passes = next;
  for (const fn of listeners) fn();
}

export function getSidebarNotifyStakedGatePasses(): boolean {
  return passes;
}

export function subscribeSidebarNotifyStakedGatePasses(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function useSidebarNotifyStakedGatePasses(): boolean {
  return useSyncExternalStore(
    subscribeSidebarNotifyStakedGatePasses,
    getSidebarNotifyStakedGatePasses,
    getSidebarNotifyStakedGatePasses,
  );
}
