export const SIDEBAR_NOTIFY_GEAR_TIP_LS_KEY = 'polybot-sidebar-notify-gear-tip-dismissed';

export function readSidebarNotifyGearTipDismissed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_NOTIFY_GEAR_TIP_LS_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistSidebarNotifyGearTipDismissed(): void {
  try {
    localStorage.setItem(SIDEBAR_NOTIFY_GEAR_TIP_LS_KEY, '1');
  } catch {
    /* ignore */
  }
}
