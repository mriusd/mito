/**
 * Global "user is interacting" signal — pause heavy WS→React work so text
 * selection, typing, and clicks stay responsive under bid/ask load.
 */

let quietUntil = 0;
let installed = false;

/** Pause window after scroll / pointer / key — long enough for drag-select. */
const QUIET_MS = 900;
/** Longer pause when focus is in an editable field. */
const INPUT_QUIET_MS = 1600;

function publishFlag(): void {
  (window as unknown as { __polybotScrollQuietUntil?: number }).__polybotScrollQuietUntil = quietUntil;
}

function bump(ms: number = QUIET_MS): void {
  const next = Date.now() + ms;
  if (next > quietUntil) quietUntil = next;
  publishFlag();
}

function bumpForEventTarget(target: EventTarget | null): void {
  const el = target instanceof Element ? target : null;
  const editable =
    el &&
    (el.closest('input, textarea, select, [contenteditable="true"]') ||
      el.getAttribute?.('contenteditable') === 'true');
  bump(editable ? INPUT_QUIET_MS : QUIET_MS);
}

/** Call from any user gesture (scroll, pointer, key). */
export function noteUiInteractionActivity(target?: EventTarget | null): void {
  if (target !== undefined) bumpForEventTarget(target ?? null);
  else bump();
}

/** @deprecated alias — scroll path */
export function noteUiScrollActivity(): void {
  bump();
}

/** True while the user recently interacted — skip non-critical WS/UI work. */
export function isUiInteractionQuiet(): boolean {
  return Date.now() < quietUntil;
}

/** @deprecated alias */
export function isUiScrollQuiet(): boolean {
  return isUiInteractionQuiet();
}

/**
 * Install once — capture gestures without preventDefault.
 * Covers scroll + pointer/key so input text selection is not starved by bid/ask apply.
 */
export function installUiInteractionQuietListeners(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (installed) return () => {};
  installed = true;
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  const onWheel = () => bump();
  const onTouchMove = () => bump();
  const onPointerDown = (e: Event) => bumpForEventTarget(e.target);
  /** Only while dragging (text select / drag) — idle mousemove must not freeze quotes forever. */
  const onPointerMove = (e: Event) => {
    if (!(e instanceof PointerEvent) || e.buttons === 0) return;
    bumpForEventTarget(e.target);
  };
  const onKey = (e: Event) => bumpForEventTarget(e.target);
  const onSelect = () => bump(INPUT_QUIET_MS);

  window.addEventListener('wheel', onWheel, opts);
  window.addEventListener('touchmove', onTouchMove, opts);
  window.addEventListener('pointerdown', onPointerDown, opts);
  window.addEventListener('pointermove', onPointerMove, opts);
  window.addEventListener('keydown', onKey, opts);
  window.addEventListener('keyup', onKey, opts);
  document.addEventListener('selectionchange', onSelect, opts);

  return () => {
    window.removeEventListener('wheel', onWheel, opts);
    window.removeEventListener('touchmove', onTouchMove, opts);
    window.removeEventListener('pointerdown', onPointerDown, opts);
    window.removeEventListener('pointermove', onPointerMove, opts);
    window.removeEventListener('keydown', onKey, opts);
    window.removeEventListener('keyup', onKey, opts);
    document.removeEventListener('selectionchange', onSelect, opts);
    installed = false;
  };
}

/** @deprecated — use installUiInteractionQuietListeners */
export function installUiScrollQuietListeners(): () => void {
  return installUiInteractionQuietListeners();
}
