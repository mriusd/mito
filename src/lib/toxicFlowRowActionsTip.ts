export const TOXIC_FLOW_ROW_ACTIONS_TIP_LS_KEY = 'polybot-toxic-flow-row-actions-tip-dismissed';

export function readToxicFlowRowActionsTipDismissed(): boolean {
  try {
    return localStorage.getItem(TOXIC_FLOW_ROW_ACTIONS_TIP_LS_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistToxicFlowRowActionsTipDismissed(): void {
  try {
    localStorage.setItem(TOXIC_FLOW_ROW_ACTIONS_TIP_LS_KEY, '1');
  } catch {
    /* ignore */
  }
}
