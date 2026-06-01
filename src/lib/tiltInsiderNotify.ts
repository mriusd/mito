export const TILT_INSIDER_WIN_RATE_PCT_LS_KEY = 'polybot-sidebar-notify-insider-win-rate-pct';
export const TILT_INSIDER_MIN_STAKE_USD_LS_KEY = 'polybot-sidebar-notify-insider-min-stake-usd';
export const TILT_INSIDER_NOTIFY_CHANGED_EVENT = 'polybot-tilt-insider-notify-changed';

export const DEFAULT_TILT_INSIDER_WIN_RATE_PCT = 75;
export const DEFAULT_TILT_INSIDER_MIN_STAKE_USD = 1000;

export function readTiltInsiderWinRatePct(): number {
  try {
    const raw = localStorage.getItem(TILT_INSIDER_WIN_RATE_PCT_LS_KEY);
    const n = parseFloat(raw ?? String(DEFAULT_TILT_INSIDER_WIN_RATE_PCT));
    if (!Number.isFinite(n)) return DEFAULT_TILT_INSIDER_WIN_RATE_PCT;
    return Math.min(100, Math.max(0, Math.round(n)));
  } catch {
    return DEFAULT_TILT_INSIDER_WIN_RATE_PCT;
  }
}

export function readTiltInsiderMinStakeUsd(): number {
  try {
    const raw = localStorage.getItem(TILT_INSIDER_MIN_STAKE_USD_LS_KEY);
    const n = parseFloat(raw ?? String(DEFAULT_TILT_INSIDER_MIN_STAKE_USD));
    if (!Number.isFinite(n)) return DEFAULT_TILT_INSIDER_MIN_STAKE_USD;
    return Math.max(0, n);
  } catch {
    return DEFAULT_TILT_INSIDER_MIN_STAKE_USD;
  }
}

export function notifyTiltInsiderSettingsChanged(): void {
  window.dispatchEvent(new Event(TILT_INSIDER_NOTIFY_CHANGED_EVENT));
}

export function subscribeTiltInsiderNotify(listener: () => void): () => void {
  const onCustom = () => listener();
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === TILT_INSIDER_WIN_RATE_PCT_LS_KEY ||
      e.key === TILT_INSIDER_MIN_STAKE_USD_LS_KEY ||
      e.key === null
    ) {
      listener();
    }
  };
  window.addEventListener(TILT_INSIDER_NOTIFY_CHANGED_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(TILT_INSIDER_NOTIFY_CHANGED_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}
