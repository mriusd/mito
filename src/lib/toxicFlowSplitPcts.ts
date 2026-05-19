import type { ToxicFlowLayoutMode } from './toxicFlowLayoutMode';

export const TOXIC_FLOW_SPLIT_PCTS_LS_KEY = 'polybot-toxic-flow-split-pcts';

export type ToxicFlowSplitLayoutKey = Extract<ToxicFlowLayoutMode, 'split' | 'triple'>;

const MIN_PANEL_PCT = 12;

export const DEFAULT_TOXIC_FLOW_SPLIT_PCTS: Record<ToxicFlowSplitLayoutKey, number[]> = {
  split: [50, 50],
  triple: [33.34, 33.33, 33.33],
};

function normalizeSplitPcts(pcts: number[], count: number): number[] | null {
  if (pcts.length !== count) return null;
  const cleaned = pcts.map((p) => (Number.isFinite(p) && p > 0 ? p : NaN));
  if (cleaned.some((p) => !Number.isFinite(p))) return null;
  const sum = cleaned.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  const scaled = cleaned.map((p) => (p / sum) * 100);
  if (scaled.some((p) => p < MIN_PANEL_PCT - 0.01)) return null;
  const rounded = scaled.map((p, i) =>
    i === scaled.length - 1 ? 0 : Math.round(p * 100) / 100,
  );
  rounded[rounded.length - 1] = Math.round((100 - rounded.slice(0, -1).reduce((a, b) => a + b, 0)) * 100) / 100;
  return rounded;
}

export function readToxicFlowSplitPcts(key: ToxicFlowSplitLayoutKey): number[] {
  const fallback = DEFAULT_TOXIC_FLOW_SPLIT_PCTS[key];
  try {
    const raw = localStorage.getItem(TOXIC_FLOW_SPLIT_PCTS_LS_KEY);
    if (!raw) return [...fallback];
    const parsed = JSON.parse(raw) as Partial<Record<ToxicFlowSplitLayoutKey, unknown>>;
    const row = parsed[key];
    if (!Array.isArray(row)) return [...fallback];
    const nums = row.map((v) => (typeof v === 'number' ? v : parseFloat(String(v))));
    return normalizeSplitPcts(nums, fallback.length) ?? [...fallback];
  } catch {
    return [...fallback];
  }
}

export function persistToxicFlowSplitPcts(key: ToxicFlowSplitLayoutKey, pcts: number[]): void {
  const normalized = normalizeSplitPcts(pcts, DEFAULT_TOXIC_FLOW_SPLIT_PCTS[key].length);
  if (!normalized) return;
  try {
    const raw = localStorage.getItem(TOXIC_FLOW_SPLIT_PCTS_LS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, number[]>) : {};
    parsed[key] = normalized;
    localStorage.setItem(TOXIC_FLOW_SPLIT_PCTS_LS_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

export function clampAdjacentSplitPcts(
  pcts: readonly number[],
  handleIndex: number,
  deltaPct: number,
): number[] {
  const n = pcts.length;
  if (handleIndex < 0 || handleIndex >= n - 1) return [...pcts];
  const next = [...pcts];
  let top = next[handleIndex] + deltaPct;
  let bottom = next[handleIndex + 1] - deltaPct;
  if (top < MIN_PANEL_PCT) {
    const fix = MIN_PANEL_PCT - top;
    top = MIN_PANEL_PCT;
    bottom -= fix;
  }
  if (bottom < MIN_PANEL_PCT) {
    const fix = MIN_PANEL_PCT - bottom;
    bottom = MIN_PANEL_PCT;
    top -= fix;
  }
  next[handleIndex] = top;
  next[handleIndex + 1] = bottom;
  const sum = next.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.05) {
    return normalizeSplitPcts(next, n) ?? [...pcts];
  }
  return next;
}
