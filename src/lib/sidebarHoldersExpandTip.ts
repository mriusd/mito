import { isMobileScreenViewport } from './mobileScreenNotice';

export const SIDEBAR_HOLDERS_EXPAND_TIP_LS_KEY = 'polybot-sidebar-holders-expand-tip-dismissed';

export function readSidebarHoldersExpandTipDismissed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_HOLDERS_EXPAND_TIP_LS_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistSidebarHoldersExpandTipDismissed(): void {
  try {
    localStorage.setItem(SIDEBAR_HOLDERS_EXPAND_TIP_LS_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function isDesktopScreenViewport(): boolean {
  return typeof window !== 'undefined' && !isMobileScreenViewport();
}
