export const TOXIC_FLOW_TAB_IDS = [
  'topHolders',
  'smart',
  'favourites',
  'whales',
  'favWhales',
  'winners',
  'fresh',
  'topYes',
  'topNo',
] as const;

export type ToxicFlowTabId = (typeof TOXIC_FLOW_TAB_IDS)[number];

export type ToxicFlowPaneSlot = 'pane1' | 'pane2' | 'pane3';

export const TOXIC_FLOW_PANE_TABS_LS_KEY = 'polybot-toxic-flow-pane-tabs';

const DEFAULT_PANE_TABS: Record<ToxicFlowPaneSlot, ToxicFlowTabId> = {
  pane1: 'topHolders',
  pane2: 'smart',
  pane3: 'whales',
};

function isToxicFlowTabId(v: unknown): v is ToxicFlowTabId {
  return typeof v === 'string' && (TOXIC_FLOW_TAB_IDS as readonly string[]).includes(v);
}

export function readToxicFlowPaneTab(slot: ToxicFlowPaneSlot): ToxicFlowTabId {
  try {
    const raw = localStorage.getItem(TOXIC_FLOW_PANE_TABS_LS_KEY);
    if (!raw) return DEFAULT_PANE_TABS[slot];
    const parsed = JSON.parse(raw) as Partial<Record<ToxicFlowPaneSlot, unknown>>;
    const t = parsed[slot];
    return isToxicFlowTabId(t) ? t : DEFAULT_PANE_TABS[slot];
  } catch {
    return DEFAULT_PANE_TABS[slot];
  }
}

export function persistToxicFlowPaneTab(slot: ToxicFlowPaneSlot, tab: ToxicFlowTabId): void {
  if (!isToxicFlowTabId(tab)) return;
  try {
    const raw = localStorage.getItem(TOXIC_FLOW_PANE_TABS_LS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Record<ToxicFlowPaneSlot, ToxicFlowTabId>>) : {};
    parsed[slot] = tab;
    localStorage.setItem(TOXIC_FLOW_PANE_TABS_LS_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}
