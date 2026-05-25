import { useSyncExternalStore } from 'react';
import type { Market } from '../types';

export type SidebarUpDownEndPickerData = {
  endPickerList: Market[];
  visibleEndLabel: string;
  endIso: string;
};

type SidebarUpDownTargetSnapshot = {
  targetPrice: number | null;
  liveSameTfMarket: Market | null;
  endPicker: SidebarUpDownEndPickerData | null;
  digest: number;
};

const EMPTY: SidebarUpDownTargetSnapshot = {
  targetPrice: null,
  liveSameTfMarket: null,
  endPicker: null,
  digest: 0,
};

function endPickerSig(data: SidebarUpDownEndPickerData | null): string {
  if (!data) return '';
  return `${data.endIso}|${data.visibleEndLabel}|${data.endPickerList.map((m) => m.id).join(',')}`;
}

let snap = EMPTY;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const fn of listeners) fn();
}

export function resetSidebarUpDownTargetStore(): void {
  snap = EMPTY;
  notifyListeners();
}

export function setSidebarUpDownTargetPrice(next: number | null): void {
  const prev = snap.targetPrice;
  if (next == null && prev == null) return;
  if (next != null && prev != null && Math.abs(next - prev) < 1e-9) return;
  snap = { ...snap, targetPrice: next, digest: snap.digest + 1 };
  notifyListeners();
}

export function setSidebarUpDownLiveSameTfMarket(next: Market | null): void {
  const prevId = snap.liveSameTfMarket?.id ?? '';
  const nextId = next?.id ?? '';
  if (prevId === nextId) return;
  snap = { ...snap, liveSameTfMarket: next, digest: snap.digest + 1 };
  notifyListeners();
}

export function setSidebarUpDownEndPicker(next: SidebarUpDownEndPickerData | null): void {
  if (endPickerSig(snap.endPicker) === endPickerSig(next)) return;
  snap = { ...snap, endPicker: next, digest: snap.digest + 1 };
  notifyListeners();
}

export function useSidebarUpDownEndPicker(): SidebarUpDownEndPickerData | null {
  const digest = useSyncExternalStore(
    subscribeSidebarUpDownTarget,
    () => getSidebarUpDownTargetSnapshot().digest,
    () => getSidebarUpDownTargetSnapshot().digest,
  );
  void digest;
  return getSidebarUpDownTargetSnapshot().endPicker;
}

export function subscribeSidebarUpDownTarget(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getSidebarUpDownTargetSnapshot(): SidebarUpDownTargetSnapshot {
  return snap;
}

export function useSidebarUpDownTargetPrice(): number | null {
  const digest = useSyncExternalStore(
    subscribeSidebarUpDownTarget,
    () => getSidebarUpDownTargetSnapshot().digest,
    () => getSidebarUpDownTargetSnapshot().digest,
  );
  void digest;
  return getSidebarUpDownTargetSnapshot().targetPrice;
}

export function useSidebarUpDownLiveSameTfMarket(): Market | null {
  const digest = useSyncExternalStore(
    subscribeSidebarUpDownTarget,
    () => getSidebarUpDownTargetSnapshot().digest,
    () => getSidebarUpDownTargetSnapshot().digest,
  );
  void digest;
  return getSidebarUpDownTargetSnapshot().liveSameTfMarket;
}
