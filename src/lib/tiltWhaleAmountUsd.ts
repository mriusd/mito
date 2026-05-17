/** Tilt dialog + Toxic Flow Whales tab: wallets with USD Staked Net magnitude ≥ this are whales. */

export const TILT_WHALE_AMOUNT_USD_LS_KEY = 'polybot-sidebar-notify-whale-amount-usd';

export const TILT_WHALE_AMOUNT_USD_CHANGED_EVENT = 'polybot-tilt-whale-amount-usd-changed';

export const DEFAULT_TILT_WHALE_AMOUNT_USD = 5000;

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
