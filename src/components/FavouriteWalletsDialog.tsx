import { useCallback, useEffect, useState } from 'react';
import { X, Star, ExternalLink, Copy } from 'lucide-react';
import {
  listToxicFavouriteWalletsSorted,
  readToxicFavouriteWallets,
  persistToxicFavouriteWallets,
  TOXIC_FAVOURITE_WALLETS_LS_KEY,
  TOXIC_FAVOURITES_CHANGED_EVENT,
} from '../lib/toxicFavouriteWallets';

function shortenAddr(a: string): string {
  const t = a.trim();
  if (t.length < 20) return t;
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

export function FavouriteWalletsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [addrs, setAddrs] = useState<string[]>([]);

  const refresh = useCallback(() => {
    setAddrs(listToxicFavouriteWalletsSorted());
  }, []);

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, refresh]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY || e.key === null) refresh();
    };
    const onLocal = () => refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, onLocal);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, onLocal);
    };
  }, [refresh]);

  const removeFav = (addr: string) => {
    const k = addr.trim().toLowerCase();
    if (!k) return;
    const next = readToxicFavouriteWallets();
    next.delete(k);
    persistToxicFavouriteWallets(next);
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
                const poly = `https://polymarket.com/profile/${lower}`;
                const scan = `https://polygonscan.com/address/${lower}`;
                return (
                  <li
                    key={lower}
                    className="flex items-center gap-1 rounded border border-gray-800 bg-gray-800/40 px-1.5 py-1 text-[11px]"
                  >
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-gray-600/50 text-yellow-400 shrink-0"
                      title="Remove from favourites"
                      aria-label="Remove from favourites"
                      onClick={() => removeFav(raw)}
                    >
                      <Star size={13} className="fill-yellow-400" />
                    </button>
                    <a
                      href={poly}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-blue-400 hover:underline truncate min-w-0 flex-1"
                      title={raw}
                    >
                      {shortenAddr(raw)}
                    </a>
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
