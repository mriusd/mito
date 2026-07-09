const listeners = new Set<() => void>();

/** Min gap between reconnect storms — a storm tears down every WS + refetches all panels. */
const MIN_NOTIFY_GAP_MS = 15_000;
/** Stagger feed reconnects so chart/onchain/GEX don't all hammer main thread at once. */
const LISTENER_STAGGER_MS = 400;
let lastNotifyAt = 0;

export function notifyBackendReconnect(): void {
  const now = Date.now();
  if (now - lastNotifyAt < MIN_NOTIFY_GAP_MS) return;
  lastNotifyAt = now;
  let i = 0;
  for (const fn of listeners) {
    const delay = i * LISTENER_STAGGER_MS;
    i += 1;
    if (delay === 0) queueMicrotask(fn);
    else window.setTimeout(fn, delay);
  }
}

export function onBackendReconnect(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
