import { useCallback, useSyncExternalStore } from 'react';

export const TOXIC_WALLET_TAGS_LS_KEY = 'polybot-toxic-wallet-tags';

export const TOXIC_WALLET_TAGS_CHANGED_EVENT = 'polybot-toxic-wallet-tags-changed';

const MAX_TAG_LEN = 32;

function walletKey(wallet: string): string {
  return wallet.trim().toLowerCase();
}

/** One word, trimmed; empty if invalid. */
export function normalizeToxicWalletTagInput(raw: string): string {
  const word = raw.trim().split(/\s+/)[0] ?? '';
  if (!word) return '';
  return word.slice(0, MAX_TAG_LEN);
}

export function readToxicWalletTags(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TOXIC_WALLET_TAGS_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const key = walletKey(k);
      const tag = normalizeToxicWalletTagInput(String(v ?? ''));
      if (key && tag) out[key] = tag;
    }
    return out;
  } catch {
    return {};
  }
}

function persistToxicWalletTags(map: Record<string, string>) {
  try {
    localStorage.setItem(TOXIC_WALLET_TAGS_LS_KEY, JSON.stringify(map));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(TOXIC_WALLET_TAGS_CHANGED_EVENT));
}

export function getToxicWalletTag(wallet: string): string | null {
  const k = walletKey(wallet);
  if (!k) return null;
  const tag = readToxicWalletTags()[k];
  return tag || null;
}

export function setToxicWalletTag(wallet: string, tag: string) {
  const k = walletKey(wallet);
  if (!k) return;
  const normalized = normalizeToxicWalletTagInput(tag);
  const all = readToxicWalletTags();
  if (!normalized) {
    delete all[k];
  } else {
    all[k] = normalized;
  }
  persistToxicWalletTags(all);
}

export function removeToxicWalletTag(wallet: string) {
  const k = walletKey(wallet);
  if (!k) return;
  const all = readToxicWalletTags();
  if (!(k in all)) return;
  delete all[k];
  persistToxicWalletTags(all);
}

export function subscribeToxicWalletTags(listener: () => void): () => void {
  const onLocal = () => listener();
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOXIC_WALLET_TAGS_LS_KEY || e.key === null) onLocal();
  };
  window.addEventListener(TOXIC_WALLET_TAGS_CHANGED_EVENT, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(TOXIC_WALLET_TAGS_CHANGED_EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}

export function useToxicWalletTag(wallet: string): string | null {
  const k = walletKey(wallet);
  const getSnapshot = useCallback((): string | null => {
    if (!k) return null;
    return readToxicWalletTags()[k] ?? null;
  }, [k]);
  return useSyncExternalStore(subscribeToxicWalletTags, getSnapshot, getSnapshot);
}
