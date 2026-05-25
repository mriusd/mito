import { useSyncExternalStore } from 'react';

let nowMs = Date.now();
let digest = 0;
const listeners = new Set<() => void>();
let intervalId: number | null = null;
let subscriberCount = 0;

function notify(): void {
  digest += 1;
  for (const l of listeners) l();
}

function ensureInterval(): void {
  if (intervalId != null) return;
  intervalId = window.setInterval(() => {
    nowMs = Date.now();
    notify();
  }, 5000);
}

function clearIntervalIfIdle(): void {
  if (subscriberCount > 0 || intervalId == null) return;
  window.clearInterval(intervalId);
  intervalId = null;
}

export function subscribeWalletTradeElapsed(onStoreChange: () => void): () => void {
  subscriberCount += 1;
  ensureInterval();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    subscriberCount = Math.max(0, subscriberCount - 1);
    clearIntervalIfIdle();
  };
}

export function getWalletTradeElapsedSnapshot(): number {
  return nowMs;
}

export function useWalletTradeElapsedMs(): number {
  return useSyncExternalStore(
    subscribeWalletTradeElapsed,
    getWalletTradeElapsedSnapshot,
    getWalletTradeElapsedSnapshot,
  );
}
