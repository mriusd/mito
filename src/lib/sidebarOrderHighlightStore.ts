import { useSyncExternalStore } from 'react';

type SidebarOrderHighlightSnapshot = {
  digest: number;
  bidPrices: Set<string>;
  askPrices: Set<string>;
};

const EMPTY_SET = new Set<string>();
const EMPTY: SidebarOrderHighlightSnapshot = {
  digest: 0,
  bidPrices: EMPTY_SET,
  askPrices: EMPTY_SET,
};

let snap = EMPTY;
const listeners = new Set<() => void>();

function setSignature(s: Set<string>): string {
  if (s.size === 0) return '';
  return [...s].sort().join('|');
}

function notifyListeners(): void {
  for (const fn of listeners) fn();
}

export function resetSidebarOrderHighlightStore(): void {
  snap = EMPTY;
  notifyListeners();
}

export function setSidebarOrderHighlightSets(bidPrices: Set<string>, askPrices: Set<string>): void {
  if (
    setSignature(snap.bidPrices) === setSignature(bidPrices) &&
    setSignature(snap.askPrices) === setSignature(askPrices)
  ) {
    return;
  }
  snap = { bidPrices, askPrices, digest: snap.digest + 1 };
  notifyListeners();
}

export function subscribeSidebarOrderHighlight(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getSidebarOrderHighlightSnapshot(): SidebarOrderHighlightSnapshot {
  return snap;
}

export function useSidebarOrderHighlightSets(): { bidPrices: Set<string>; askPrices: Set<string> } {
  const digest = useSyncExternalStore(
    subscribeSidebarOrderHighlight,
    () => getSidebarOrderHighlightSnapshot().digest,
    () => getSidebarOrderHighlightSnapshot().digest,
  );
  void digest;
  const s = getSidebarOrderHighlightSnapshot();
  return { bidPrices: s.bidPrices, askPrices: s.askPrices };
}
