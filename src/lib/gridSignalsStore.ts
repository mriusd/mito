import { useSyncExternalStore } from 'react';
import { useAppStore } from '../stores/appStore';
import type { Signal } from '../types';

const EMPTY_SIGNALS: Signal[] = [];
const GRID_SIGNALS_MS = 2000;

let throttled: Signal[] = EMPTY_SIGNALS;
let digest = 0;
const listeners = new Set<() => void>();
let appUnsub: (() => void) | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let subscriberCount = 0;
let signalsOnGrid = false;

function notify(): void {
  digest += 1;
  for (const l of listeners) l();
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    throttled = signalsOnGrid ? useAppStore.getState().signals : EMPTY_SIGNALS;
    notify();
  }, GRID_SIGNALS_MS);
}

function ensureAppSub(): void {
  if (appUnsub) return;
  signalsOnGrid = useAppStore.getState().signalsOnGrid;
  throttled = signalsOnGrid ? useAppStore.getState().signals : EMPTY_SIGNALS;
  appUnsub = useAppStore.subscribe((state) => {
    const on = state.signalsOnGrid;
    if (on !== signalsOnGrid) {
      signalsOnGrid = on;
      throttled = on ? state.signals : EMPTY_SIGNALS;
      notify();
      return;
    }
    if (!on) return;
    scheduleFlush();
  });
}

function clearAppSubIfIdle(): void {
  if (subscriberCount > 0 || !appUnsub) return;
  appUnsub();
  appUnsub = null;
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

export function subscribeGridSignals(onStoreChange: () => void): () => void {
  subscriberCount += 1;
  ensureAppSub();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    subscriberCount = Math.max(0, subscriberCount - 1);
    clearAppSubIfIdle();
  };
}

export function getGridSignalsSnapshot(): Signal[] {
  digest;
  return throttled;
}

export function useGridSignals(): Signal[] {
  return useSyncExternalStore(subscribeGridSignals, getGridSignalsSnapshot, getGridSignalsSnapshot);
}
