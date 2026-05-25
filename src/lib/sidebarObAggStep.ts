import type { SidebarObAggStep } from './sidebarOrderbookAggregate';

export const LS_SIDEBAR_OB_AGG_STEP = 'polybot_sidebar_ob_agg_step';

export function readSavedObAggStep(): SidebarObAggStep {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_SIDEBAR_OB_AGG_STEP) : null;
    if (v === '0.1' || v === '1' || v === '5') return v;
  } catch {
    /* ignore */
  }
  return '0.1';
}
