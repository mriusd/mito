import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Star, Bell, ExternalLink, Copy, Plus } from 'lucide-react';
import {
  listToxicFavouriteWalletsByAddedAt,
  readToxicFavouriteWallets,
  persistToxicFavouriteWallets,
  readToxicBellWallets,
  persistToxicBellWallets,
  getToxicFavouriteNickname,
  setToxicFavouriteNickname,
  exportToxicFavouriteWalletsCsv,
  TOXIC_FAVOURITE_WALLETS_LS_KEY,
  TOXIC_FAVOURITE_NICKNAMES_LS_KEY,
  TOXIC_FAVOURITE_ADDED_AT_LS_KEY,
  TOXIC_FAVOURITES_CHANGED_EVENT,
  TOXIC_BELL_WALLETS_LS_KEY,
  TOXIC_BELLS_CHANGED_EVENT,
  type ToxicFavouriteListRow,
} from '../lib/toxicFavouriteWallets';
import { primeTiltAudioContextFromUserGesture } from '../lib/tiltNotifySound';
import { getToxicWalletTag, TOXIC_WALLET_TAGS_CHANGED_EVENT } from '../lib/toxicWalletTags';
import { polymarketSiteUrl } from '../lib/polymarketSiteUrl';
import { WalletAddressGlyph } from './WalletAddressGlyph';

const BELL_CLS_ON = 'text-amber-400 fill-amber-400/25';
const BELL_CLS_OFF = 'stroke-gray-400 fill-none';

const ETH_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

function shortenAddr(a: string): string {
  const t = a.trim();
  if (t.length < 20) return t;
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

/** Accept 0x…40 hex, or bare 40 hex (adds 0x). */
function normalizeWalletInput(raw: string): string | null {
  let t = raw.trim();
  if (!t) return null;
  if (!t.startsWith('0x') && !t.startsWith('0X') && /^[a-fA-F0-9]{40}$/.test(t)) {
    t = `0x${t}`;
  }
  if (!ETH_ADDR_RE.test(t)) return null;
  return t.toLowerCase();
}

function formatAddedAt(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function FavouriteWalletsDialog({
  open,
  onClose,
  onOpenWalletInfo,
}: {
  open: boolean;
  onClose: () => void;
  onOpenWalletInfo: (wallet: string) => void;
}) {
  const [entries, setEntries] = useState<ToxicFavouriteListRow[]>([]);
  const [bellWallets, setBellWallets] = useState(readToxicBellWallets);
  const [tagRev, setTagRev] = useState(0);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addAddr, setAddAddr] = useState('');
  const [addNick, setAddNick] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const addAddrRef = useRef<HTMLInputElement>(null);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(({ wallet: raw }) => {
      const lower = raw.trim().toLowerCase();
      if (lower.includes(q)) return true;
      const tag = getToxicWalletTag(raw);
      if (tag && tag.toLowerCase().includes(q)) return true;
      const nickname = tag ? '' : getToxicFavouriteNickname(raw);
      if (nickname && nickname.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [entries, search, tagRev]);

  const refresh = useCallback(() => {
    setEntries(listToxicFavouriteWalletsByAddedAt());
    setBellWallets(readToxicBellWallets());
    setTagRev((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
    setSearch('');
    setAddOpen(false);
    setAddAddr('');
    setAddNick('');
    setAddError(null);
  }, [open, refresh]);

  useEffect(() => {
    if (!addOpen) return;
    const t = window.setTimeout(() => addAddrRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [addOpen]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY ||
        e.key === TOXIC_FAVOURITE_NICKNAMES_LS_KEY ||
        e.key === TOXIC_FAVOURITE_ADDED_AT_LS_KEY ||
        e.key === TOXIC_BELL_WALLETS_LS_KEY ||
        e.key === null
      ) {
        refresh();
      }
    };
    const onFav = () => refresh();
    const onBell = () => refresh();
    const onTags = () => refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, onFav);
    window.addEventListener(TOXIC_BELLS_CHANGED_EVENT, onBell);
    window.addEventListener(TOXIC_WALLET_TAGS_CHANGED_EVENT, onTags);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, onFav);
      window.removeEventListener(TOXIC_BELLS_CHANGED_EVENT, onBell);
      window.removeEventListener(TOXIC_WALLET_TAGS_CHANGED_EVENT, onTags);
    };
  }, [refresh]);

  const removeFav = (addr: string) => {
    const k = addr.trim().toLowerCase();
    if (!k) return;
    const next = readToxicFavouriteWallets();
    next.delete(k);
    persistToxicFavouriteWallets(next);
  };

  const addFav = () => {
    const k = normalizeWalletInput(addAddr);
    if (!k) {
      setAddError('Enter a valid 0x wallet address (40 hex chars).');
      return;
    }
    const next = readToxicFavouriteWallets();
    if (next.has(k)) {
      setAddError('Already in favourites.');
      return;
    }
    next.add(k);
    persistToxicFavouriteWallets(next);
    const nick = addNick.trim();
    if (nick) setToxicFavouriteNickname(k, nick);
    setAddAddr('');
    setAddNick('');
    setAddError(null);
    setAddOpen(false);
  };

  const toggleBellWallet = (addr: string) => {
    const k = addr.trim().toLowerCase();
    if (!k) return;
    primeTiltAudioContextFromUserGesture();
    setBellWallets((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      persistToxicBellWallets(next);
      return next;
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[60025] flex items-center justify-center p-3"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-gray-900 border border-gray-600 rounded-lg shadow-xl w-full max-w-md h-[min(70vh,520px)] flex flex-col min-h-0"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Star size={14} className="text-yellow-400 fill-yellow-400 shrink-0" />
            <span className="text-sm font-bold text-white truncate">Favourite wallets</span>
            {entries.length > 0 && <span className="text-[10px] text-gray-500">({entries.length})</span>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              className={`rounded p-1 border ${
                addOpen
                  ? 'border-emerald-500/60 bg-emerald-900/40 text-emerald-300'
                  : 'border-gray-600 text-gray-300 hover:text-white hover:bg-gray-700'
              }`}
              title="Add wallet"
              aria-label="Add wallet"
              aria-pressed={addOpen}
              onClick={() => {
                setAddOpen((v) => !v);
                setAddError(null);
              }}
            >
              <Plus size={14} strokeWidth={2.5} />
            </button>
            {entries.length > 0 ? (
              <button
                type="button"
                className="rounded px-2 py-0.5 text-[10px] font-semibold text-gray-300 hover:text-white hover:bg-gray-700 border border-gray-600"
                onClick={() => exportToxicFavouriteWalletsCsv()}
              >
                Export CSV
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        {addOpen ? (
          <div className="px-2 pt-2 shrink-0 space-y-1.5 border-b border-gray-800 pb-2">
            <div className="flex gap-1.5">
              <input
                ref={addAddrRef}
                type="text"
                value={addAddr}
                onChange={(e) => {
                  setAddAddr(e.target.value);
                  if (addError) setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addFav();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setAddOpen(false);
                    setAddError(null);
                  }
                }}
                placeholder="0x… wallet address"
                className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-950 px-2 py-1 font-mono text-[11px] text-white placeholder:text-gray-500 focus:outline-none focus:border-emerald-500/60"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="shrink-0 rounded border border-emerald-600/70 bg-emerald-800/50 px-2 py-1 text-[10px] font-semibold text-emerald-100 hover:bg-emerald-700/60"
                onClick={addFav}
              >
                Add
              </button>
            </div>
            <input
              type="text"
              value={addNick}
              onChange={(e) => setAddNick(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addFav();
                }
              }}
              placeholder="Nickname (optional)"
              className="w-full rounded border border-gray-600 bg-gray-950 px-2 py-1 text-[11px] text-white placeholder:text-gray-500 focus:outline-none focus:border-gray-500"
              autoComplete="off"
              spellCheck={false}
            />
            {addError ? <p className="text-[10px] text-red-400 px-0.5">{addError}</p> : null}
          </div>
        ) : null}
        {entries.length > 0 ? (
          <div className="px-2 pt-2 shrink-0">
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search address, nickname, tag…"
                className="w-full rounded border border-gray-600 bg-gray-950 pl-2 pr-7 py-1 text-[11px] text-white placeholder:text-gray-500 focus:outline-none focus:border-gray-500"
                autoComplete="off"
                spellCheck={false}
              />
              {search.trim() ? (
                <button
                  type="button"
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:text-white hover:bg-gray-700/80"
                  title="Clear search"
                  aria-label="Clear search"
                  onClick={() => setSearch('')}
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="overflow-y-auto flex-1 p-2">
          {entries.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6 px-2">
              No favourites yet. Use <span className="text-gray-300">+</span> to add an address, or star a wallet in Toxic flow → Holders.
            </p>
          ) : filteredEntries.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6 px-2">No matches for &ldquo;{search.trim()}&rdquo;</p>
          ) : (
            <ul className="space-y-1">
              {filteredEntries.map(({ wallet: raw, addedAtMs }) => {
                const lower = raw.toLowerCase();
                void tagRev;
                const tag = getToxicWalletTag(raw);
                const nickname = tag ? '' : getToxicFavouriteNickname(raw);
                const bellActive = bellWallets.has(lower);
                const poly = polymarketSiteUrl(`profile/${lower}`);
                const scan = `https://polygonscan.com/address/${lower}`;
                const infoTitle = tag
                  ? `${tag} · ${raw} — Wallet info`
                  : nickname
                    ? `${nickname} · ${raw} — Wallet info`
                    : `${raw} — Wallet info`;
                return (
                  <li
                    key={lower}
                    className="flex items-center gap-1 rounded border border-gray-800 bg-gray-800/40 px-1.5 py-1 text-[11px]"
                  >
                    <button
                      type="button"
                      className="rounded p-0 leading-none hover:bg-gray-600/40 text-yellow-400 shrink-0"
                      title="Remove from favourites"
                      aria-label="Remove from favourites"
                      onClick={() => removeFav(raw)}
                    >
                      <Star size={12} className="fill-yellow-400 stroke-yellow-500/90" strokeWidth={1.5} />
                    </button>
                    <button
                      type="button"
                      className="rounded p-0 leading-none hover:bg-gray-600/40 text-gray-500 hover:text-amber-200/90 shrink-0"
                      title={
                        bellActive
                          ? 'Stop highlighting this wallet on Toxic tables'
                          : 'Flash row when wallet is on this market'
                      }
                      aria-pressed={bellActive}
                      onClick={() => toggleBellWallet(raw)}
                    >
                      <Bell size={11} strokeWidth={2} className={bellActive ? BELL_CLS_ON : BELL_CLS_OFF} />
                    </button>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1 text-left hover:underline"
                      title={infoTitle}
                      onClick={() => {
                        const w = raw.trim().toLowerCase();
                        if (!w) return;
                        onOpenWalletInfo(w);
                      }}
                    >
                      <WalletAddressGlyph address={raw} size={14} />
                      <span className="flex min-w-0 flex-col leading-tight">
                        {tag ? (
                          <span className="truncate font-bold text-amber-200">{tag}</span>
                        ) : nickname ? (
                          <span className="truncate font-bold text-emerald-300">{nickname}</span>
                        ) : null}
                        <span className="truncate font-mono text-[10px] text-blue-400">{shortenAddr(raw)}</span>
                      </span>
                    </button>
                    <span
                      className="shrink-0 text-[9px] text-gray-500 tabular-nums whitespace-nowrap"
                      title={
                        addedAtMs != null && addedAtMs > 0
                          ? new Date(addedAtMs).toLocaleString()
                          : 'Added before time tracking'
                      }
                    >
                      {formatAddedAt(addedAtMs)}
                    </span>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-gray-600/50 text-gray-400 hover:text-white shrink-0"
                      title="Copy address"
                      aria-label="Copy address"
                      onClick={() => void navigator.clipboard.writeText(raw)}
                    >
                      <Copy size={13} />
                    </button>
                    <a
                      href={poly}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center justify-center rounded p-1 hover:bg-[#2f5cff]/30 border border-[#2d57ff]/50 bg-[#2f5cff]/20"
                      title="Polymarket profile"
                      aria-label="Open Polymarket profile"
                    >
                      <img
                        src="/polymarket-favicon.ico"
                        alt=""
                        className="h-3.5 w-3.5 rounded-[2px] pointer-events-none"
                        style={{ filter: 'brightness(0) invert(1)' }}
                      />
                    </a>
                    <a
                      href={scan}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded hover:bg-gray-600/50 text-gray-400 hover:text-cyan-300 shrink-0"
                      title="Polygonscan"
                      aria-label="Open on Polygonscan"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
