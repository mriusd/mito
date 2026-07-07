import { useSyncExternalStore } from 'react';

export const SIDEBAR_CUSTOM_BUTTONS_KEY = 'polymarket-sidebar-custom-buttons';

export type CustomSidebarOrderOutcome = 'YES' | 'NO' | 'AUTO';

export type CustomSidebarPriceMode = 'FIXED' | 'BS_MINUS_C' | 'BS_PLUS_C' | 'BS_MINUS_PCT' | 'BS_PLUS_PCT';

export type CustomSidebarOrderSpec = {
  side: 'BUY' | 'SELL';
  priceMode: CustomSidebarPriceMode;
  /** Fixed ¢, or BS offset (¢ or percentage points). */
  priceValue: number;
  maxSell: boolean;
  /** AUTO = use sidebar Place Order YES/NO toggle. */
  outcome: CustomSidebarOrderOutcome;
};

export type CustomSidebarButton = {
  id: string;
  label: string;
  color: string;
  orders: CustomSidebarOrderSpec[];
};

function normalizeCustomSidebarPriceMode(raw: unknown): CustomSidebarPriceMode {
  const s = String(raw || 'FIXED').toUpperCase();
  if (s === 'BS_MINUS_C') return 'BS_MINUS_C';
  if (s === 'BS_PLUS_C') return 'BS_PLUS_C';
  if (s === 'BS_MINUS_PCT') return 'BS_MINUS_PCT';
  if (s === 'BS_PLUS_PCT') return 'BS_PLUS_PCT';
  return 'FIXED';
}

export function customOrderPriceLabel(spec: CustomSidebarOrderSpec): string {
  switch (spec.priceMode) {
    case 'BS_MINUS_C':
      return `BS-${spec.priceValue}¢`;
    case 'BS_PLUS_C':
      return `BS+${spec.priceValue}¢`;
    case 'BS_MINUS_PCT':
      return `BS-${spec.priceValue}%`;
    case 'BS_PLUS_PCT':
      return `BS+${spec.priceValue}%`;
    default:
      return `${spec.priceValue}¢`;
  }
}

function normalizeCustomSidebarOrderSpec(raw: unknown): CustomSidebarOrderSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const side = o.side === 'SELL' ? 'SELL' : o.side === 'BUY' ? 'BUY' : null;
  if (!side) return null;
  const priceMode = normalizeCustomSidebarPriceMode(o.priceMode);
  const priceValue =
    Number.isFinite(Number(o.priceValue)) ? Number(o.priceValue) : Number(o.priceCents);
  if (!Number.isFinite(priceValue)) return null;
  if (priceMode === 'FIXED' && (priceValue <= 0 || priceValue >= 100)) return null;
  if (priceMode !== 'FIXED' && priceValue < 0) return null;
  const outcomeRaw = String(o.outcome || 'AUTO').toUpperCase();
  const outcome: CustomSidebarOrderOutcome =
    outcomeRaw === 'YES' ? 'YES' : outcomeRaw === 'NO' ? 'NO' : 'AUTO';
  return {
    side,
    priceMode,
    priceValue,
    maxSell: side === 'SELL' ? !!o.maxSell : false,
    outcome,
  };
}

export function customButtonTitle(btn: CustomSidebarButton, orderAmount: string): string {
  return btn.orders
    .map((o) => {
      const outLabel = o.outcome === 'AUTO' ? '↔' : o.outcome;
      return `${o.side} ${o.maxSell ? 'MAX' : orderAmount || '?'} ${outLabel} @ ${customOrderPriceLabel(o)}`;
    })
    .join(' + ');
}

export function readCustomSidebarButtons(): CustomSidebarButton[] {
  try {
    const raw = localStorage.getItem(SIDEBAR_CUSTOM_BUTTONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((b) => {
        if (!b || typeof b !== 'object') return null;
        const label = String(b.label || '?').slice(0, 3);
        if (!label) return null;
        const base = {
          id: String(b.id || `${Date.now()}-${Math.random()}`),
          label,
          color: String(b.color || '#2563eb'),
        };
        if (Array.isArray(b.orders) && b.orders.length > 0) {
          const orders = (b.orders as unknown[])
            .map(normalizeCustomSidebarOrderSpec)
            .filter((o): o is CustomSidebarOrderSpec => o != null);
          if (orders.length === 0) return null;
          return { ...base, orders };
        }
        if (b.side !== 'BUY' && b.side !== 'SELL') return null;
        const priceCents = Number(b.priceCents);
        if (!Number.isFinite(priceCents) || priceCents <= 0 || priceCents >= 100) return null;
        return {
          ...base,
          orders: [
            {
              side: b.side as 'BUY' | 'SELL',
              priceMode: 'FIXED' as const,
              priceValue: priceCents,
              maxSell: !!b.maxSell,
              outcome: 'AUTO' as const,
            },
          ],
        };
      })
      .filter((b): b is CustomSidebarButton => b != null);
  } catch {
    return [];
  }
}

let customButtonsDigest = 0;
const customButtonListeners = new Set<() => void>();

function notifyCustomButtonListeners(): void {
  customButtonsDigest += 1;
  for (const fn of customButtonListeners) fn();
}

export function subscribeCustomSidebarButtons(listener: () => void): () => void {
  customButtonListeners.add(listener);
  return () => customButtonListeners.delete(listener);
}

export function getCustomSidebarButtonsDigest(): number {
  return customButtonsDigest;
}

export function getCustomSidebarButtonsSnapshot(): CustomSidebarButton[] {
  return readCustomSidebarButtons();
}

/** Call after persisting custom buttons so other panels refresh. */
export function bumpCustomSidebarButtonsStore(): void {
  notifyCustomButtonListeners();
}

export function useCustomSidebarButtons(): CustomSidebarButton[] {
  const digest = useSyncExternalStore(
    subscribeCustomSidebarButtons,
    getCustomSidebarButtonsDigest,
    getCustomSidebarButtonsDigest,
  );
  void digest;
  return getCustomSidebarButtonsSnapshot();
}
