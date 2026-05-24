/** Single 1 Hz clock for countdown UI — avoids hundreds of setInterval + full Sidebar re-renders. */
let nowMs = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function ensureTimer() {
  if (timer != null) return;
  timer = setInterval(() => {
    nowMs = Date.now();
    for (const listener of listeners) listener();
  }, 1000);
}

export function subscribeExpiryTick(listener: () => void): () => void {
  listeners.add(listener);
  ensureTimer();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function getExpiryTickNow(): number {
  return nowMs;
}
