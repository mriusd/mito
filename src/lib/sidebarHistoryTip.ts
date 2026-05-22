export const SIDEBAR_HISTORY_TIP_LS_KEY = 'polybot-sidebar-history-tip-dismissed';

export function readSidebarHistoryTipDismissed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_HISTORY_TIP_LS_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistSidebarHistoryTipDismissed(): void {
  try {
    localStorage.setItem(SIDEBAR_HISTORY_TIP_LS_KEY, '1');
  } catch {
    /* ignore */
  }
}
