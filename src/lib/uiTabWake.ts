/**
 * Tab background → foreground recovery.
 *
 * Chrome often discards compositor layers for long-hidden tabs. If we then stampede
 * WS reconnects + REST refetches on the same tick as restore, the main thread never
 * paints and the user only sees the #050505 body (black screen) until a hard reload.
 *
 * Strategy: on wake, force a paint nudge first, keep a short "quiet" window so heavy
 * work yields, then emit `polybot:tab-wake` for charts/layout to resize.
 */

export const UI_TAB_WAKE_EVENT = 'polybot:tab-wake';

/** Pause heavy drain/reconnect work this long after becoming visible. */
const WAKE_QUIET_MS = 1500;
/** Second paint nudge — Chrome sometimes needs a beat after restore. */
const SECOND_NUDGE_MS = 80;
const THIRD_NUDGE_MS = 400;

let wakeQuietUntil = 0;
let installed = false;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let secondNudgeTimer: ReturnType<typeof setTimeout> | null = null;
let thirdNudgeTimer: ReturnType<typeof setTimeout> | null = null;

function publishQuiet(): void {
  (window as unknown as { __polybotTabWakeQuietUntil?: number }).__polybotTabWakeQuietUntil =
    wakeQuietUntil;
}

/** True briefly after the tab becomes visible — skip non-critical work. */
export function isTabWakeQuiet(): boolean {
  return Date.now() < wakeQuietUntil;
}

/** True when the document is in a background / prerender state. */
export function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Heavy pipelines (bid/ask drain, forced WS reconnect) should wait while the tab is
 * hidden or freshly woken so the first paint can land.
 */
export function shouldDeferHeavyUiWork(): boolean {
  return isDocumentHidden() || isTabWakeQuiet();
}

function nudgeCompositorPaint(): void {
  const root = document.getElementById('root');
  if (root instanceof HTMLElement) {
    const prev = root.style.transform;
    root.style.transform = 'translateZ(0)';
    void root.offsetHeight;
    root.style.transform = prev;
  }
  try {
    window.dispatchEvent(new Event('resize'));
  } catch {
    /* ignore */
  }
}

function emitTabWake(): void {
  try {
    window.dispatchEvent(new CustomEvent(UI_TAB_WAKE_EVENT));
  } catch {
    /* ignore */
  }
}

function clearWakeTimers(): void {
  if (wakeTimer != null) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  if (secondNudgeTimer != null) {
    clearTimeout(secondNudgeTimer);
    secondNudgeTimer = null;
  }
  if (thirdNudgeTimer != null) {
    clearTimeout(thirdNudgeTimer);
    thirdNudgeTimer = null;
  }
}

function onBecameVisible(): void {
  clearWakeTimers();
  wakeQuietUntil = Date.now() + WAKE_QUIET_MS;
  publishQuiet();

  // Paint before any deferred reconnect storms scheduled by other listeners.
  requestAnimationFrame(() => {
    nudgeCompositorPaint();
    requestAnimationFrame(() => {
      nudgeCompositorPaint();
      emitTabWake();
    });
  });

  secondNudgeTimer = setTimeout(() => {
    secondNudgeTimer = null;
    if (document.visibilityState !== 'visible') return;
    nudgeCompositorPaint();
    emitTabWake();
  }, SECOND_NUDGE_MS);

  thirdNudgeTimer = setTimeout(() => {
    thirdNudgeTimer = null;
    if (document.visibilityState !== 'visible') return;
    nudgeCompositorPaint();
    emitTabWake();
  }, THIRD_NUDGE_MS);

  // After quiet window, one more nudge — charts that deferred resize catch up.
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    if (document.visibilityState !== 'visible') return;
    nudgeCompositorPaint();
    emitTabWake();
  }, WAKE_QUIET_MS + 50);
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    onBecameVisible();
  } else {
    clearWakeTimers();
  }
}

function onPageShow(ev: PageTransitionEvent): void {
  // bfcache restore — treat like a fresh wake even if visibility didn't flip.
  if (ev.persisted || document.visibilityState === 'visible') {
    onBecameVisible();
  }
}

/** Subscribe to tab-wake paint/resize nudges. */
export function subscribeTabWake(listener: () => void): () => void {
  window.addEventListener(UI_TAB_WAKE_EVENT, listener);
  return () => window.removeEventListener(UI_TAB_WAKE_EVENT, listener);
}

export function installTabWakeRecovery(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  if (installed) return () => {};
  installed = true;

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', onPageShow);

  return () => {
    clearWakeTimers();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pageshow', onPageShow);
    installed = false;
  };
}
