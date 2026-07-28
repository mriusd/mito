import { ethers } from 'ethers';

import { useAppStore } from '../stores/appStore';

const LEGACY_PK_KEY = 'polymarket-imported-pk';
const STORE_KEY = 'polymarket-imported-pks';

export type PkWallet = {
  id: string;
  label: string;
  privateKey: string;
  address: string;
};

type PkWalletStore = {
  wallets: PkWallet[];
  activeId: string | null;
};

function notifyPkChanged(): void {
  useAppStore.getState().bumpPkRevision();
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePk(input: string): string | null {
  let raw = input.trim();
  if (raw.startsWith('0x') || raw.startsWith('0X')) raw = raw.slice(2);
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return '0x' + raw.toLowerCase();
}

function addressFromPk(pk: string): string | null {
  try {
    return new ethers.Wallet(pk).address.toLowerCase();
  } catch {
    return null;
  }
}

function readStore(): PkWalletStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PkWalletStore;
      if (parsed && Array.isArray(parsed.wallets)) {
        const wallets = parsed.wallets.filter(
          (w): w is PkWallet =>
            !!w &&
            typeof w.id === 'string' &&
            typeof w.label === 'string' &&
            typeof w.privateKey === 'string' &&
            typeof w.address === 'string',
        );
        let activeId = typeof parsed.activeId === 'string' ? parsed.activeId : null;
        if (activeId && !wallets.some((w) => w.id === activeId)) activeId = wallets[0]?.id ?? null;
        if (!activeId && wallets.length) activeId = wallets[0].id;
        return { wallets, activeId };
      }
    }
  } catch {
    /* fall through to migrate */
  }

  const legacy = localStorage.getItem(LEGACY_PK_KEY);
  if (legacy) {
    const addr = addressFromPk(legacy);
    if (addr) {
      const wallet: PkWallet = {
        id: newId(),
        label: 'Wallet 1',
        privateKey: legacy.startsWith('0x') ? legacy.toLowerCase() : `0x${legacy.toLowerCase()}`,
        address: addr,
      };
      const migrated: PkWalletStore = { wallets: [wallet], activeId: wallet.id };
      writeStore(migrated, false);
      localStorage.removeItem(LEGACY_PK_KEY);
      return migrated;
    }
  }

  return { wallets: [], activeId: null };
}

function writeStore(store: PkWalletStore, bump: boolean): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  // Keep legacy key in sync so anything still reading it gets the active PK
  const active = store.wallets.find((w) => w.id === store.activeId);
  if (active) localStorage.setItem(LEGACY_PK_KEY, active.privateKey);
  else localStorage.removeItem(LEGACY_PK_KEY);
  if (bump) notifyPkChanged();
}

export function listPkWallets(): PkWallet[] {
  return readStore().wallets;
}

export function getActivePkWallet(): PkWallet | null {
  const store = readStore();
  if (!store.activeId) return null;
  return store.wallets.find((w) => w.id === store.activeId) ?? null;
}

/** Active private key hex — used by CLOB / wallet data hooks. */
export function getStoredPrivateKey(): string | null {
  return getActivePkWallet()?.privateKey ?? null;
}

export function setActivePkWallet(id: string): boolean {
  const store = readStore();
  if (!store.wallets.some((w) => w.id === id)) return false;
  if (store.activeId === id) return true;
  writeStore({ ...store, activeId: id }, true);
  return true;
}

export function addPkWallet(privateKeyInput: string, label: string): { ok: true; wallet: PkWallet } | { ok: false; error: string } {
  const pk = normalizePk(privateKeyInput);
  if (!pk) return { ok: false, error: 'Invalid private key — must be 64 hex characters' };
  const address = addressFromPk(pk);
  if (!address) return { ok: false, error: 'Could not derive address from key' };

  const store = readStore();
  if (store.wallets.some((w) => w.address === address)) {
    return { ok: false, error: 'Wallet with this address already saved' };
  }

  const trimmed = label.trim() || `Wallet ${store.wallets.length + 1}`;
  const wallet: PkWallet = { id: newId(), label: trimmed, privateKey: pk, address };
  writeStore(
    { wallets: [...store.wallets, wallet], activeId: wallet.id },
    true,
  );
  return { ok: true, wallet };
}

export function removePkWallet(id: string): void {
  const store = readStore();
  const wallets = store.wallets.filter((w) => w.id !== id);
  const wasActive = store.activeId === id;
  const activeId = wasActive ? wallets[0]?.id ?? null : store.activeId;
  writeStore({ wallets, activeId }, wasActive || wallets.length === 0);
}

export function renamePkWallet(id: string, label: string): void {
  const store = readStore();
  const next = label.trim();
  if (!next) return;
  const wallets = store.wallets.map((w) => (w.id === id ? { ...w, label: next } : w));
  if (wallets === store.wallets) return;
  writeStore({ ...store, wallets }, false);
}

/** Remove active wallet, or all if none active. Prefer removePkWallet. */
export function clearStoredPrivateKey(): void {
  const store = readStore();
  if (store.activeId) {
    removePkWallet(store.activeId);
    return;
  }
  writeStore({ wallets: [], activeId: null }, true);
}

export function clearAllPkWallets(): void {
  writeStore({ wallets: [], activeId: null }, true);
}
