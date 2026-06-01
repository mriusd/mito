/** Tilt dialog + Toxic Flow Whales tab: wallets with USD Staked Net magnitude ≥ this are whales. */

export const TILT_WHALE_AMOUNT_USD_LS_KEY = 'polybot-sidebar-notify-whale-amount-usd';
export const TILT_WHALE_MAX_PRICE_CENTS_LS_KEY = 'polybot-sidebar-notify-whale-max-price-cents';

export const TILT_WHALE_AMOUNT_USD_CHANGED_EVENT = 'polybot-tilt-whale-amount-usd-changed';

export const DEFAULT_TILT_WHALE_AMOUNT_USD = 5000;
export const DEFAULT_TILT_WHALE_MAX_PRICE_CENTS = 75;

export function readTiltWhaleAmountUsd(): number {
  try {
    const raw = localStorage.getItem(TILT_WHALE_AMOUNT_USD_LS_KEY);
    if (raw == null || raw === '') return DEFAULT_TILT_WHALE_AMOUNT_USD;
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_TILT_WHALE_AMOUNT_USD;
    return Math.min(1e12, n);
  } catch {
    return DEFAULT_TILT_WHALE_AMOUNT_USD;
  }
}

export function readTiltWhaleMaxPriceCents(): number {
  try {
    const raw = localStorage.getItem(TILT_WHALE_MAX_PRICE_CENTS_LS_KEY);
    const n = parseFloat(raw ?? String(DEFAULT_TILT_WHALE_MAX_PRICE_CENTS));
    if (!Number.isFinite(n)) return DEFAULT_TILT_WHALE_MAX_PRICE_CENTS;
    return Math.min(99, Math.max(1, Math.round(n)));
  } catch {
    return DEFAULT_TILT_WHALE_MAX_PRICE_CENTS;
  }
}

export function persistTiltWhaleMaxPriceCents(n: number): number {
  const v = Number.isFinite(n) ? Math.min(99, Math.max(1, Math.round(n))) : DEFAULT_TILT_WHALE_MAX_PRICE_CENTS;
  try {
    localStorage.setItem(TILT_WHALE_MAX_PRICE_CENTS_LS_KEY, String(v));
  } catch {
    return v;
  }
  window.dispatchEvent(new Event(TILT_WHALE_AMOUNT_USD_CHANGED_EVENT));
  return v;
}

export function persistTiltWhaleAmountUsd(n: number): void {
  const v =
    Number.isFinite(n) && n >= 0 ? Math.min(1e12, n) : DEFAULT_TILT_WHALE_AMOUNT_USD;
  try {
    localStorage.setItem(TILT_WHALE_AMOUNT_USD_LS_KEY, String(v));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(TILT_WHALE_AMOUNT_USD_CHANGED_EVENT));
}
