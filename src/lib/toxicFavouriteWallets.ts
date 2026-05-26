import { downloadCsvFile } from './walletInfoCsvExport';
import { getToxicWalletTag } from './toxicWalletTags';

export const TOXIC_FAVOURITE_WALLETS_LS_KEY = 'polybot-toxic-flow-favourite-wallets';

export const TOXIC_FAVOURITE_NICKNAMES_LS_KEY = 'polybot-toxic-flow-favourite-nicknames';

export const TOXIC_FAVOURITE_ADDED_AT_LS_KEY = 'polybot-toxic-flow-favourite-added-at';

export const TOXIC_BELL_WALLETS_LS_KEY = 'polybot-toxic-flow-bell-wallets';

export const TOXIC_FAVOURITES_CHANGED_EVENT = 'polybot-toxic-favourites-changed';

export const TOXIC_BELLS_CHANGED_EVENT = 'polybot-toxic-bells-changed';

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
  const prev = readToxicFavouriteWallets();
  const addedAt = readToxicFavouriteAddedAtMap();
  const now = Date.now();
  for (const k of s) {
    if (!prev.has(k) && addedAt[k] == null) addedAt[k] = now;
  }
  for (const k of prev) {
    if (!s.has(k)) delete addedAt[k];
  }
  try {
    localStorage.setItem(TOXIC_FAVOURITE_WALLETS_LS_KEY, JSON.stringify([...s].sort()));
    localStorage.setItem(TOXIC_FAVOURITE_ADDED_AT_LS_KEY, JSON.stringify(addedAt));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(TOXIC_FAVOURITES_CHANGED_EVENT));
}

/** Toxic flow tables: wallets to highlight while they appear on this market. */
export function getToxicBellWalletsSnapshot(): string {
  try {
    return localStorage.getItem(TOXIC_BELL_WALLETS_LS_KEY) ?? '';
  } catch {
    return '';
  }
}

export function readToxicBellWallets(): Set<string> {
  try {
    const raw = getToxicBellWalletsSnapshot();
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x).toLowerCase()).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function subscribeToxicBellWallets(listener: () => void): () => void {
  const onBell = () => listener();
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOXIC_BELL_WALLETS_LS_KEY || e.key === null) onBell();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(TOXIC_BELLS_CHANGED_EVENT, onBell);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(TOXIC_BELLS_CHANGED_EVENT, onBell);
  };
}

export function persistToxicBellWallets(s: Set<string>): void {
  try {
    localStorage.setItem(TOXIC_BELL_WALLETS_LS_KEY, JSON.stringify([...s].sort()));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(TOXIC_BELLS_CHANGED_EVENT));
}

export function listToxicFavouriteWalletsSorted(): string[] {
  return listToxicFavouriteWalletsByAddedAt().map((row) => row.wallet);
}

export type ToxicFavouriteListRow = {
  wallet: string;
  addedAtMs: number | null;
};

function readToxicFavouriteAddedAtMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(TOXIC_FAVOURITE_ADDED_AT_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const key = String(k).trim().toLowerCase();
      const ms = Number(v);
      if (key && Number.isFinite(ms) && ms > 0) out[key] = ms;
    }
    return out;
  } catch {
    return {};
  }
}

export function getToxicFavouriteAddedAtMs(wallet: string): number | null {
  const k = wallet.trim().toLowerCase();
  if (!k) return null;
  const ms = readToxicFavouriteAddedAtMap()[k];
  return ms != null && Number.isFinite(ms) && ms > 0 ? ms : null;
}

export function listToxicFavouriteWalletsByAddedAt(): ToxicFavouriteListRow[] {
  const set = readToxicFavouriteWallets();
  const addedAt = readToxicFavouriteAddedAtMap();
  return [...set]
    .map((wallet) => ({ wallet, addedAtMs: addedAt[wallet] ?? null }))
    .sort((a, b) => {
      const ta = a.addedAtMs ?? 0;
      const tb = b.addedAtMs ?? 0;
      if (tb !== ta) return tb - ta;
      return a.wallet.localeCompare(b.wallet);
    });
}

/** Lowercased address → Polymarket display name captured from Toxic flow rows. */
export function readToxicFavouriteNicknames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TOXIC_FAVOURITE_NICKNAMES_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const key = String(k).trim().toLowerCase();
      const nick = String(v ?? '').trim();
      if (key && nick) out[key] = nick;
    }
    return out;
  } catch {
    return {};
  }
}

export function getToxicFavouriteNickname(wallet: string): string {
  const k = wallet.trim().toLowerCase();
  if (!k) return '';
  return readToxicFavouriteNicknames()[k] ?? '';
}

export function setToxicFavouriteNickname(wallet: string, nickname: string): void {
  const k = wallet.trim().toLowerCase();
  const nick = nickname.trim();
  if (!k || !nick) return;
  const map = readToxicFavouriteNicknames();
  if (map[k] === nick) return;
  map[k] = nick;
  try {
    localStorage.setItem(TOXIC_FAVOURITE_NICKNAMES_LS_KEY, JSON.stringify(map));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(TOXIC_FAVOURITES_CHANGED_EVENT));
}

type ToxicFavouriteNicknameRow = {
  wallet?: string;
  walletLedgerSummary?: { polymarketNickname?: string | null } | null;
};

/** When a starred wallet appears in Toxic flow, persist Polymarket nickname for the header favourites list. */
export function recordToxicFavouriteNicknamesFromRows(
  rows: ToxicFavouriteNicknameRow[],
  favouriteSet: Set<string>,
): void {
  if (favouriteSet.size === 0 || rows.length === 0) return;
  for (const row of rows) {
    const k = (row.wallet ?? '').trim().toLowerCase();
    if (!k || !favouriteSet.has(k)) continue;
    const nick = (row.walletLedgerSummary?.polymarketNickname ?? '').trim();
    if (nick) setToxicFavouriteNickname(k, nick);
  }
}

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return '';
  if (typeof v === 'number' && !Number.isFinite(v)) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportToxicFavouriteWalletsCsv(): void {
  const rows = listToxicFavouriteWalletsByAddedAt();
  const bells = readToxicBellWallets();
  const headers = ['wallet', 'tag', 'nickname', 'added_at_iso', 'bell'];
  const body = rows.map(({ wallet, addedAtMs }) => {
    const k = wallet.trim().toLowerCase();
    const tag = getToxicWalletTag(wallet) || '';
    const nickname = tag ? '' : getToxicFavouriteNickname(wallet);
    const addedIso = addedAtMs != null && addedAtMs > 0 ? new Date(addedAtMs).toISOString() : '';
    return [k, tag, nickname, addedIso, bells.has(k) ? '1' : '0'];
  });
  const csv = [headers, ...body].map((r) => r.map(csvCell).join(',')).join('\n');
  downloadCsvFile('favourite-wallets.csv', csv);
}
