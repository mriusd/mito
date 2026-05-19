export const TOXIC_FLOW_LAYOUT_MODE_LS_KEY = 'polybot-toxic-flow-layout-mode';

export type ToxicFlowLayoutMode = 'single' | 'split' | 'triple';

export const DEFAULT_TOXIC_FLOW_LAYOUT_MODE: ToxicFlowLayoutMode = 'single';

export function readToxicFlowLayoutMode(): ToxicFlowLayoutMode {
  try {
    const raw = localStorage.getItem(TOXIC_FLOW_LAYOUT_MODE_LS_KEY);
    if (raw === 'single' || raw === 'split' || raw === 'triple') return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_TOXIC_FLOW_LAYOUT_MODE;
}

export function persistToxicFlowLayoutMode(mode: ToxicFlowLayoutMode): void {
  try {
    localStorage.setItem(TOXIC_FLOW_LAYOUT_MODE_LS_KEY, mode);
  } catch {
    /* ignore */
  }
}
