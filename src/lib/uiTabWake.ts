/**
 * Tab background → foreground recovery.
 *
 * After a long hide, Chrome often drops compositor layers for this heavy dashboard.
 * The DOM is still there (Cmd+R briefly reveals it) but nothing paints — solid #050505.
 *
 * Strategy:
 * 1. Hard layer reset on wake (visibility toggle on #root).
 * 2. Quiet window so WS/bidAsk stampedes don't block the first paint.
 * 3. Heartbeat from the main thread; if it never advances after wake, auto-reload.
 * 4. Vanilla Recover control outside React (index.html) as a last resort.
 */

export const UI_TAB_WAKE_EVENT = 'polybot:tab-wake';

/** Pause heavy drain/reconnect work this long after becoming visible. */
const WAKE_QUIET_MS = 2000;
/** Background at least this long → treat as high risk of compositor blank. */
const LONG_HIDE_MS = 30_000;
/** If heartbeat is still stale this long after a long hide, reload. */
const STALE_HEARTBEAT_RELOAD_MS = 3500;

let wakeQuietUntil = 0;
let installed = false;
let hiddenAt = 0;
let wakeAt = 0;
// Use `number` (DOM) — not `ReturnType<typeof setInterval>` which becomes NodeJS.Timeout under @types/node.
let wakeTimer: number | null = null;
let heartbeatTimer: number | null = null;
let staleReloadTimer: number | null = null;

declare global {
  interface Window {
    __polybotUiHeartbeat?: number;
    __polybotTabWakeQuietUntil?: number;
    __polybotHardNudgePaint?: () => void;
    __polybotShowTabRecover?: (reason: string) => void;
    __polybotHideTabRecover?: () => void;
  }
}

function publishQuiet(): void {
  window.__polybotTabWakeQuietUntil = wakeQuietUntil;
}

function beat(): void {
  window.__polybotUiHeartbeat = Date.now();
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

/** Force Chrome to recreate the root layer — fixes many permanent blank tabs. */
export function hardNudgePaint(): void {
  if (typeof window.__polybotHardNudgePaint === 'function') {
    window.__polybotHardNudgePaint();
    return;
  }
  const root = document.getElementById('root');
  if (!(root instanceof HTMLElement)) return;
  const prevVis = root.style.visibility;
  root.style.visibility = 'hidden';
  void root.offsetHeight;
  root.style.visibility = prevVis;
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
  if (staleReloadTimer != null) {
    clearTimeout(staleReloadTimer);
    staleReloadTimer = null;
  }
}

function onBecameVisible(): void {
  clearWakeTimers();
  const awayMs = hiddenAt > 0 ? Date.now() - hiddenAt : 0;
  wakeAt = Date.now();
  wakeQuietUntil = wakeAt + WAKE_QUIET_MS;
  publishQuiet();
  beat();

  // Immediate hard reset — do not wait for rAF (rAF is throttled/starved on bad wakes).
  hardNudgePaint();

  requestAnimationFrame(() => {
    beat();
    hardNudgePaint();
    requestAnimationFrame(() => {
      beat();
      hardNudgePaint();
      emitTabWake();
    });
  });

  wakeTimer = window.setTimeout(() => {
    wakeTimer = null;
    if (document.visibilityState !== 'visible') return;
    beat();
    hardNudgePaint();
    emitTabWake();
    window.__polybotHideTabRecover?.();
  }, WAKE_QUIET_MS + 50);

  // Long hide: if React timers never advance heartbeat, the tab is dead — reload.
  if (awayMs >= LONG_HIDE_MS) {
    staleReloadTimer = window.setTimeout(() => {
      staleReloadTimer = null;
      if (document.visibilityState !== 'visible') return;
      const hb = window.__polybotUiHeartbeat ?? 0;
      // Heartbeat must have moved since wake (main thread processing timers).
      if (hb >= wakeAt) {
        hardNudgePaint();
        window.__polybotHideTabRecover?.();
        return;
      }
      window.__polybotShowTabRecover?.('stale-heartbeat');
      console.warn(
        `[polybot] UI heartbeat stale after ${Math.round(awayMs / 1000)}s background — reloading`,
      );
      try {
        sessionStorage.setItem('polybot-tab-wake-reload', String(Date.now()));
      } catch {
        /* ignore */
      }
      // Brief beat so the Recover overlay can paint, then reload.
      window.setTimeout(() => {
        if (document.visibilityState === 'visible') window.location.reload();
      }, 600);
    }, STALE_HEARTBEAT_RELOAD_MS);
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    clearWakeTimers();
    return;
  }
  onBecameVisible();
}

function onPageShow(ev: PageTransitionEvent): void {
  if (ev.persisted || document.visibilityState === 'visible') {
    onBecameVisible();
  }
}

function onFocus(): void {
  // Some Chrome builds blank the tab on OS focus restore without a visibility flip.
  if (document.visibilityState !== 'visible') return;
  const awayMs = hiddenAt > 0 ? Date.now() - hiddenAt : 0;
  if (awayMs < 5_000 && wakeAt > 0 && Date.now() - wakeAt < 5_000) return;
  beat();
  hardNudgePaint();
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

  beat();
  heartbeatTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') beat();
  }, 1000);

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('focus', onFocus);

  return () => {
    clearWakeTimers();
    if (heartbeatTimer != null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('focus', onFocus);
    installed = false;
  };
}
