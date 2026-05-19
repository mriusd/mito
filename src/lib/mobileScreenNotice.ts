export const MOBILE_SCREEN_NOTICE_LS_KEY = 'polybot-mobile-screen-notice-dismissed';

/** Same breakpoint as App sidebar mobile behavior. */
export const MOBILE_SCREEN_MEDIA_QUERY = '(max-width: 767px)';

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
