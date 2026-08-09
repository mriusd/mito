export const MOBILE_SCREEN_NOTICE_LS_KEY = 'polybot-mobile-screen-notice-dismissed';

/**
 * Mobile UI (sidebar sheet, notice, touch help) below this width.
 * Was 767 — lowered so tablet / narrow desktop keep desktop rail longer.
 */
export const MOBILE_SCREEN_MAX_WIDTH_PX = 559;
export const DESKTOP_SCREEN_MIN_WIDTH_PX = MOBILE_SCREEN_MAX_WIDTH_PX + 1;
export const MOBILE_SCREEN_MEDIA_QUERY = `(max-width: ${MOBILE_SCREEN_MAX_WIDTH_PX}px)`;

export function readMobileScreenNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(MOBILE_SCREEN_NOTICE_LS_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistMobileScreenNoticeDismissed(): void {
  try {
    localStorage.setItem(MOBILE_SCREEN_NOTICE_LS_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function isMobileScreenViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(MOBILE_SCREEN_MEDIA_QUERY).matches;
}
