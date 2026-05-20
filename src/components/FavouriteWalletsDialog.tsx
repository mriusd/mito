import { useCallback, useEffect, useState } from 'react';
import { X, Star, Bell, ExternalLink, Copy } from 'lucide-react';
import {
  listToxicFavouriteWalletsSorted,
  readToxicFavouriteWallets,
  persistToxicFavouriteWallets,
  readToxicBellWallets,
  persistToxicBellWallets,
  getToxicFavouriteNickname,
  TOXIC_FAVOURITE_WALLETS_LS_KEY,
  TOXIC_FAVOURITE_NICKNAMES_LS_KEY,
  TOXIC_FAVOURITES_CHANGED_EVENT,
  TOXIC_BELL_WALLETS_LS_KEY,
  TOXIC_BELLS_CHANGED_EVENT,
} from '../lib/toxicFavouriteWallets';
import { primeTiltAudioContextFromUserGesture } from '../lib/tiltNotifySound';
import { getToxicWalletTag, TOXIC_WALLET_TAGS_CHANGED_EVENT } from '../lib/toxicWalletTags';
import { polymarketSiteUrl } from '../lib/polymarketSiteUrl';
import { WalletAddressGlyph } from './WalletAddressGlyph';

const BELL_CLS_ON = 'text-amber-400 fill-amber-400/25';
const BELL_CLS_OFF = 'stroke-gray-400 fill-none';

function shortenAddr(a: string): string {
  const t = a.trim();
  if (t.length < 20) return t;
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
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
  const [addrs, setAddrs] = useState<string[]>([]);
  const [bellWallets, setBellWallets] = useState(readToxicBellWallets);
  const [tagRev, setTagRev] = useState(0);

  const refresh = useCallback(() => {
    setAddrs(listToxicFavouriteWalletsSorted());
    setBellWallets(readToxicBellWallets());
    setTagRev((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, refresh]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY ||
        e.key === TOXIC_FAVOURITE_NICKNAMES_LS_KEY ||
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
        className="bg-gray-900 border border-gray-600 rounded-lg shadow-xl w-full max-w-md max-h-[min(70vh,520px)] flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <Star size={14} className="text-yellow-400 fill-yellow-400 shrink-0" />
            <span className="text-sm font-bold text-white truncate">Favourite wallets</span>
            {addrs.length > 0 && <span className="text-[10px] text-gray-500">({addrs.length})</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {addrs.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6 px-2">No favourites yet. Star a wallet in Toxic flow → Holders.</p>
          ) : (
            <ul className="space-y-1">
              {addrs.map((raw) => {
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
