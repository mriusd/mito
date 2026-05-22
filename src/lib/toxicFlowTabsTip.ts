export const TOXIC_FLOW_TABS_TIP_LS_KEY = 'polybot-toxic-flow-tabs-tip-dismissed';

export function readToxicFlowTabsTipDismissed(): boolean {
  try {
    return localStorage.getItem(TOXIC_FLOW_TABS_TIP_LS_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistToxicFlowTabsTipDismissed(): void {
  try {
    localStorage.setItem(TOXIC_FLOW_TABS_TIP_LS_KEY, '1');
  } catch {
    /* ignore */
  }
}
