import { useSyncExternalStore } from 'react';

let bucketMs = Math.floor(Date.now() / 5000) * 5000;
let intervalId: number | null = null;
const listeners = new Set<() => void>();
let subscriberCount = 0;

function notify(): void {
  for (const l of listeners) l();
}

function ensureInterval(): void {
  if (intervalId != null) return;
  intervalId = window.setInterval(() => {
    bucketMs = Math.floor(Date.now() / 5000) * 5000;
    notify();
  }, 5000);
}

function clearIntervalIfIdle(): void {
  if (subscriberCount > 0 || intervalId == null) return;
  window.clearInterval(intervalId);
  intervalId = null;
}

export function subscribeLiveTradeElapsed(onStoreChange: () => void): () => void {
  subscriberCount += 1;
  ensureInterval();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    subscriberCount = Math.max(0, subscriberCount - 1);
    clearIntervalIfIdle();
  };
}

export function getLiveTradeElapsedSnapshot(): number {
  return bucketMs;
}

export function useLiveTradeElapsedMs(): number {
  return useSyncExternalStore(
    subscribeLiveTradeElapsed,
    getLiveTradeElapsedSnapshot,
    getLiveTradeElapsedSnapshot,
  );
}

export function resetLiveTradeElapsedBucket(): void {
  bucketMs = Math.floor(Date.now() / 5000) * 5000;
  notify();
}
