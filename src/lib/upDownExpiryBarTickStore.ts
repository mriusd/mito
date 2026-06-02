import { useSyncExternalStore } from 'react';

/** 5s tick for up/down cell expiry bars — avoids ~40×1Hz `useExpiryNow` in lane cells. */
const UP_DOWN_EXPIRY_BAR_TICK_MS = 5000;

let nowMs = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
let subscriberCount = 0;

function notify(): void {
  for (const l of listeners) l();
}

function ensureTimer(): void {
  if (timer != null) return;
  timer = setInterval(() => {
    nowMs = Date.now();
    notify();
  }, UP_DOWN_EXPIRY_BAR_TICK_MS);
}

function clearTimerIfIdle(): void {
  if (subscriberCount > 0 || timer == null) return;
  clearInterval(timer);
  timer = null;
}

export function subscribeUpDownExpiryBarTick(onStoreChange: () => void): () => void {
  subscriberCount += 1;
  ensureTimer();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    subscriberCount = Math.max(0, subscriberCount - 1);
    clearTimerIfIdle();
  };
}

export function getUpDownExpiryBarTickSnapshot(): number {
  return nowMs;
}

export function useUpDownExpiryBarNow(): number {
  return useSyncExternalStore(
    subscribeUpDownExpiryBarTick,
    getUpDownExpiryBarTickSnapshot,
    getUpDownExpiryBarTickSnapshot,
  );
}
