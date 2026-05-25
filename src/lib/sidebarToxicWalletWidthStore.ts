import { useSyncExternalStore } from 'react';

let width = '0px';
const listeners = new Set<() => void>();

export function setSidebarToxicWalletExtraWidth(next: string): void {
  if (next === width) return;
  width = next;
  for (const fn of listeners) fn();
}

export function resetSidebarToxicWalletExtraWidth(): void {
  setSidebarToxicWalletExtraWidth('0px');
}

export function getSidebarToxicWalletExtraWidth(): string {
  return width;
}

export function subscribeSidebarToxicWalletExtraWidth(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function useSidebarToxicWalletExtraWidth(): string {
  return useSyncExternalStore(
    subscribeSidebarToxicWalletExtraWidth,
    getSidebarToxicWalletExtraWidth,
    getSidebarToxicWalletExtraWidth,
  );
}
