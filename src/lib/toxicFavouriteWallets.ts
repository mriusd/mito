export const TOXIC_FAVOURITE_WALLETS_LS_KEY = 'polybot-toxic-flow-favourite-wallets';

export const TOXIC_FAVOURITES_CHANGED_EVENT = 'polybot-toxic-favourites-changed';

/** Sorted JSON address array stored lowercased. */
export function readToxicFavouriteWallets(): Set<string> {
  try {
    const raw = localStorage.getItem(TOXIC_FAVOURITE_WALLETS_LS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x).toLowerCase()).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function persistToxicFavouriteWallets(s: Set<string>): void {
  try {
    localStorage.setItem(TOXIC_FAVOURITE_WALLETS_LS_KEY, JSON.stringify([...s].sort()));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(TOXIC_FAVOURITES_CHANGED_EVENT));
}

export function listToxicFavouriteWalletsSorted(): string[] {
  return [...readToxicFavouriteWallets()].sort();
}
