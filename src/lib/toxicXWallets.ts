export const TOXIC_X_WALLETS_LS_KEY = 'polybot-toxic-flow-x-wallets';

export const TOXIC_X_CHANGED_EVENT = 'polybot-toxic-x-wallets-changed';

export function getToxicXWalletsSnapshot(): string {
  try {
    return localStorage.getItem(TOXIC_X_WALLETS_LS_KEY) ?? '';
  } catch {
    return '';
  }
}

export function readToxicXWallets(): Set<string> {
  try {
    const raw = getToxicXWalletsSnapshot();
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x).toLowerCase()).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function persistToxicXWallets(s: Set<string>): void {
  try {
    localStorage.setItem(TOXIC_X_WALLETS_LS_KEY, JSON.stringify([...s].sort()));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(TOXIC_X_CHANGED_EVENT));
}

export function subscribeToxicXWallets(listener: () => void): () => void {
  const onChange = () => listener();
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOXIC_X_WALLETS_LS_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(TOXIC_X_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(TOXIC_X_CHANGED_EVENT, onChange);
  };
}
