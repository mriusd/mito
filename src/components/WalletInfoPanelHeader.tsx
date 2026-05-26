import { memo, useCallback, useEffect, useState } from 'react';
import { X, Copy, ExternalLink, Star, Bell } from 'lucide-react';
import type { WalletPosition, WalletSummary } from '../api';
import {
  readToxicFavouriteWallets,
  persistToxicFavouriteWallets,
  readToxicBellWallets,
  persistToxicBellWallets,
  TOXIC_FAVOURITE_WALLETS_LS_KEY,
  TOXIC_FAVOURITES_CHANGED_EVENT,
  TOXIC_BELL_WALLETS_LS_KEY,
  TOXIC_BELLS_CHANGED_EVENT,
} from '../lib/toxicFavouriteWallets';
import {
  readToxicXWallets,
  persistToxicXWallets,
  TOXIC_X_WALLETS_LS_KEY,
  TOXIC_X_CHANGED_EVENT,
} from '../lib/toxicXWallets';
import {
  normalizeToxicWalletTagInput,
  removeToxicWalletTag,
  setToxicWalletTag,
  useToxicWalletTag,
} from '../lib/toxicWalletTags';
import { InlineConfirmCancelInput } from './InlineConfirmCancelInput';
import { WalletAddressGlyph } from './WalletAddressGlyph';
import { isSmartGoldTrader, walletAddressColorClass } from '../lib/walletAddressColor';
import { polymarketSiteUrl } from '../lib/polymarketSiteUrl';
import {
  polymarketNicknameFromEmbed,
  polymarketNicknameTrim,
  shortenWallet,
} from './walletInfoPanelSummaryGrid';

const BELL_CLS_ON = 'text-amber-400 fill-amber-400/25';
const BELL_CLS_OFF = 'stroke-gray-400 fill-none';
const X_CLS_ON = 'text-red-500 fill-red-500/20 stroke-red-500';
const X_CLS_OFF = 'stroke-gray-400 fill-none';

const WalletInfoPanelHeaderTag = memo(function WalletInfoPanelHeaderTag({
  wallet,
  tagEditOpen,
  tagDraft,
  onTagDraftChange,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  wallet: string;
  tagEditOpen: boolean;
  tagDraft: string;
  onTagDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const walletTag = useToxicWalletTag(wallet);
  if (tagEditOpen) {
    return (
      <InlineConfirmCancelInput
        value={tagDraft}
        onChange={onTagDraftChange}
        onConfirm={onCommit}
        onCancel={onCancel}
        placeholder="tag"
        inputClassName="inline-block w-28 max-w-[12rem] bg-gray-900 border border-gray-600 rounded px-1 text-white text-xs font-sans"
      />
    );
  }
  if (!walletTag) return null;
  return (
    <button
      type="button"
      className="min-w-0 truncate text-xs font-bold text-amber-200 hover:underline"
      title={`Tag: ${walletTag} — click to edit`}
      onClick={(e) => {
        e.stopPropagation();
        onStartEdit();
      }}
    >
      {walletTag}
    </button>
  );
});

export const WalletInfoPanelHeader = memo(function WalletInfoPanelHeader({
  wallet,
  summary,
  markets,
  profileNickname,
  onClose,
}: {
  wallet: string;
  summary: WalletSummary | null | undefined;
  markets: WalletPosition[];
  profileNickname: string;
  onClose: () => void;
}) {
  const [walletIsFavourite, setWalletIsFavourite] = useState(false);
  const [walletBellActive, setWalletBellActive] = useState(false);
  const [walletXActive, setWalletXActive] = useState(false);
  const [tagEditOpen, setTagEditOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');

  useEffect(() => {
    if (!wallet.trim()) {
      setWalletIsFavourite(false);
      setWalletBellActive(false);
      setWalletXActive(false);
      setTagEditOpen(false);
      setTagDraft('');
      return;
    }
    const k = wallet.trim().toLowerCase();
    setWalletIsFavourite(readToxicFavouriteWallets().has(k));
    setWalletBellActive(readToxicBellWallets().has(k));
    setWalletXActive(readToxicXWallets().has(k));
  }, [wallet]);

  useEffect(() => {
    if (!wallet.trim()) return;
    const k = wallet.trim().toLowerCase();
    const syncFav = () => setWalletIsFavourite(readToxicFavouriteWallets().has(k));
    const syncBell = () => setWalletBellActive(readToxicBellWallets().has(k));
    const syncX = () => setWalletXActive(readToxicXWallets().has(k));
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY ||
        e.key === TOXIC_BELL_WALLETS_LS_KEY ||
        e.key === TOXIC_X_WALLETS_LS_KEY ||
        e.key === null
      ) {
        syncFav();
        syncBell();
        syncX();
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, syncFav);
    window.addEventListener(TOXIC_BELLS_CHANGED_EVENT, syncBell);
    window.addEventListener(TOXIC_X_CHANGED_EVENT, syncX);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, syncFav);
      window.removeEventListener(TOXIC_BELLS_CHANGED_EVENT, syncBell);
      window.removeEventListener(TOXIC_X_CHANGED_EVENT, syncX);
    };
  }, [wallet]);

  const toggleWalletFavourite = useCallback(() => {
    const k = wallet.trim().toLowerCase();
    if (!k) return;
    const next = readToxicFavouriteWallets();
    const adding = !next.has(k);
    if (adding) next.add(k);
    else next.delete(k);
    persistToxicFavouriteWallets(next);
    setWalletIsFavourite(next.has(k));
  }, [wallet]);

  const toggleWalletBell = useCallback(() => {
    const k = wallet.trim().toLowerCase();
    if (!k) return;
    const next = readToxicBellWallets();
    if (next.has(k)) next.delete(k);
    else next.add(k);
    persistToxicBellWallets(next);
    setWalletBellActive(next.has(k));
  }, [wallet]);

  const toggleWalletX = useCallback(() => {
    const k = wallet.trim().toLowerCase();
    if (!k) return;
    const next = readToxicXWallets();
    if (next.has(k)) next.delete(k);
    else next.add(k);
    persistToxicXWallets(next);
    setWalletXActive(next.has(k));
  }, [wallet]);

  const startTagEdit = useCallback(() => {
    setTagEditOpen(true);
  }, []);

  const commitTag = useCallback(() => {
    const n = normalizeToxicWalletTagInput(tagDraft);
    if (n) setToxicWalletTag(wallet, n);
    else removeToxicWalletTag(wallet);
    setTagEditOpen(false);
  }, [wallet, tagDraft]);

  const cancelTagEdit = useCallback(() => {
    setTagEditOpen(false);
  }, []);

  const polymarketNick = (() => {
    const fromSummary = polymarketNicknameTrim(summary?.polymarketNickname);
    if (fromSummary) return fromSummary;
    const fromProfile = polymarketNicknameTrim(profileNickname);
    if (fromProfile) return fromProfile;
    for (const row of markets) {
      const n = polymarketNicknameFromEmbed(row.walletLedgerSummary);
      if (n) return n;
    }
    return '';
  })();

  const walletAddrClass = (() => {
    const isSmart = markets.some((row) => isSmartGoldTrader(row));
    return walletAddressColorClass({ summary, isSmart });
  })();

  const polymarketProfileUrl = polymarketSiteUrl(`profile/${wallet.trim().toLowerCase()}`);
  const polygonscanUrl = `https://polygonscan.com/address/${wallet.trim().toLowerCase()}`;

  return (
    <div className="flex items-center justify-between mb-2 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-bold text-yellow-400">Wallet Info</span>
        <button
          type="button"
          className={`shrink-0 p-0.5 rounded hover:bg-gray-700/70 ${walletIsFavourite ? 'text-yellow-400' : 'text-gray-500'}`}
          title={walletIsFavourite ? 'Remove from favourites' : 'Add to favourites'}
          aria-pressed={walletIsFavourite}
          disabled={!wallet.trim()}
          onClick={(e) => {
            e.stopPropagation();
            toggleWalletFavourite();
          }}
        >
          <Star
            size={14}
            className={walletIsFavourite ? 'fill-yellow-400 stroke-yellow-500/90' : 'fill-none stroke-gray-400'}
            strokeWidth={walletIsFavourite ? 1.5 : 2}
          />
        </button>
        <button
          type="button"
          className={`shrink-0 p-0.5 rounded hover:bg-gray-700/70 ${walletBellActive ? 'text-amber-400' : 'text-gray-500'}`}
          title={
            walletBellActive
              ? 'Stop highlighting this wallet on Toxic tables'
              : 'Flash row when wallet is on this market'
          }
          aria-pressed={walletBellActive}
          disabled={!wallet.trim()}
          onClick={(e) => {
            e.stopPropagation();
            toggleWalletBell();
          }}
        >
          <Bell size={13} strokeWidth={2} className={walletBellActive ? BELL_CLS_ON : BELL_CLS_OFF} />
        </button>
        <button
          type="button"
          className={`shrink-0 p-0.5 rounded hover:bg-gray-700/70 ${walletXActive ? 'text-red-500' : 'text-gray-500'}`}
          title={walletXActive ? 'Clear X mark' : 'Mark wallet with X'}
          aria-pressed={walletXActive}
          disabled={!wallet.trim()}
          onClick={(e) => {
            e.stopPropagation();
            toggleWalletX();
          }}
        >
          <X size={13} strokeWidth={2} className={walletXActive ? X_CLS_ON : X_CLS_OFF} />
        </button>
        <button
          type="button"
          className="shrink-0 rounded px-1 py-0.5 text-[10px] font-bold text-gray-400 hover:bg-gray-700/70 hover:text-amber-200 disabled:opacity-40"
          title="Set wallet tag"
          disabled={!wallet.trim() || tagEditOpen}
          onClick={(e) => {
            e.stopPropagation();
            startTagEdit();
          }}
        >
          Tag
        </button>
        <span className="inline-flex min-w-0 max-w-full flex-nowrap items-center gap-1">
          <WalletAddressGlyph address={wallet} size={18} />
          <WalletInfoPanelHeaderTag
            wallet={wallet}
            tagEditOpen={tagEditOpen}
            tagDraft={tagDraft}
            onTagDraftChange={setTagDraft}
            onStartEdit={startTagEdit}
            onCommit={commitTag}
            onCancel={cancelTagEdit}
          />
          {!tagEditOpen ? (
            <>
              {polymarketNick ? (
                <span
                  className={`min-w-0 truncate text-xs font-medium ${walletAddrClass}`}
                  title={`Polymarket: ${polymarketNick}`}
                >
                  {shortenWallet(polymarketNick)}
                </span>
              ) : (
                <span className={`min-w-0 truncate text-xs font-medium font-mono ${walletAddrClass}`} title={wallet}>
                  {wallet}
                </span>
              )}
              {polymarketNick ? (
                <span className="min-w-0 truncate text-[10px] text-gray-500 font-mono" title={wallet}>
                  {shortenWallet(wallet)}
                </span>
              ) : null}
            </>
          ) : null}
        </span>
        <button
          type="button"
          className="text-gray-400 hover:text-white"
          title="Copy wallet address"
          aria-label="Copy wallet address"
          onClick={() => {
            void navigator.clipboard.writeText(wallet);
          }}
        >
          <Copy size={13} />
        </button>
        <a
          href={polymarketProfileUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 inline-flex items-center justify-center rounded p-0.5 hover:bg-[#2f5cff]/30 border border-[#2d57ff]/50 bg-[#2f5cff]/20"
          title="Open Polymarket profile"
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
          href={polygonscanUrl}
          target="_blank"
          rel="noreferrer"
          className="text-gray-400 hover:text-cyan-300"
          title="Open on Polygonscan"
          aria-label="Open on Polygonscan"
        >
          <ExternalLink size={13} />
        </a>
      </div>
      <button onClick={onClose} className="text-gray-500 hover:text-white">
        <X size={16} />
      </button>
    </div>
  );
});
