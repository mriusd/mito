import { useSyncExternalStore } from 'react';
import type { LiveTrade } from '../hooks/usePolymarketOB';

let tape: LiveTrade[] = [];
const listeners = new Set<() => void>();

function tapeHeadEqual(a: LiveTrade[], b: LiveTrade[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  const p0 = a[0];
  const t0 = b[0];
  return p0.id === t0.id && p0.timestamp === t0.timestamp && p0.size === t0.size;
}

export function setSidebarPolymarketTape(next: LiveTrade[]): void {
  if (tapeHeadEqual(tape, next)) return;
  tape = next;
  for (const fn of listeners) fn();
}

export function resetSidebarPolymarketTape(): void {
  if (tape.length === 0) return;
  tape = [];
  for (const fn of listeners) fn();
}

export function subscribeSidebarPolymarketTape(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getSidebarPolymarketTape(): LiveTrade[] {
  return tape;
}

export function useSidebarPolymarketTape(): LiveTrade[] {
  return useSyncExternalStore(
    subscribeSidebarPolymarketTape,
    getSidebarPolymarketTape,
    getSidebarPolymarketTape,
  );
}
