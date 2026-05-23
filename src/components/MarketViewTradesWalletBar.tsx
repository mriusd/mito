import { memo, useCallback, useEffect, useState } from 'react';
import { Star, Bell, X } from 'lucide-react';
import type { WalletPosition } from '../api';
import { isSmartGoldTrader, ledgerGoldFromEmbed, walletAddressColorClass } from '../lib/walletAddressColor';
import {
  readToxicFavouriteWallets,
  persistToxicFavouriteWallets,
  readToxicBellWallets,
  persistToxicBellWallets,
  TOXIC_FAVOURITE_WALLETS_LS_KEY,
  TOXIC_FAVOURITES_CHANGED_EVENT,
  TOXIC_BELL_WALLETS_LS_KEY,
  TOXIC_BELLS_CHANGED_EVENT,
  setToxicFavouriteNickname,
} from '../lib/toxicFavouriteWallets';
import {
  readToxicXWallets,
  persistToxicXWallets,
  TOXIC_X_WALLETS_LS_KEY,
  TOXIC_X_CHANGED_EVENT,
} from '../lib/toxicXWallets';
import { primeTiltAudioContextFromUserGesture } from '../lib/tiltNotifySound';
import { toxicWalletDisplayLabel, toxicWalletSecondaryAddress } from '../lib/toxicWalletDisplayLabel';
import { useToxicWalletTag } from '../lib/toxicWalletTags';
import { WalletAddressGlyph } from './WalletAddressGlyph';

const STAR_CLS_ON = 'text-yellow-400 fill-yellow-400';
const STAR_CLS_OFF = 'fill-none stroke-gray-400';
const BELL_CLS_ON = 'text-amber-400 fill-amber-400/25';
const BELL_CLS_OFF = 'stroke-gray-400 fill-none';
const X_CLS_ON = 'text-red-500 fill-red-500/20 stroke-red-500';
const X_CLS_OFF = 'stroke-gray-400 fill-none';

function walletAddressColorClassFromTrader(trader: WalletPosition | null): string {
  const embed = trader?.walletLedgerSummary;
  return walletAddressColorClass({
    ledgerEmbed: embed,
    isSmart: isSmartGoldTrader(trader),
    ledgerGold: ledgerGoldFromEmbed(embed),
  });
}

function fmtInt(n: number): string {
  return Math.trunc(n).toLocaleString('en-US');
}

export const MarketViewTradesWalletBar = memo(function MarketViewTradesWalletBar({
  wallet,
  trader,
}: {
  wallet: string;
  trader: WalletPosition | null;
}) {
  const wk = wallet.trim().toLowerCase();
  const tag = useToxicWalletTag(wallet);
  const embed = trader?.walletLedgerSummary;
  const primary = toxicWalletDisplayLabel(wallet, { tag, ledgerEmbed: embed });
  const secondary = toxicWalletSecondaryAddress(wallet, { tag, ledgerEmbed: embed });
  const addrClass = walletAddressColorClassFromTrader(trader);

  const [fav, setFav] = useState(() => readToxicFavouriteWallets().has(wk));
  const [bell, setBell] = useState(() => readToxicBellWallets().has(wk));
  const [xMark, setXMark] = useState(() => readToxicXWallets().has(wk));

  useEffect(() => {
    const sync = () => {
      setFav(readToxicFavouriteWallets().has(wk));
      setBell(readToxicBellWallets().has(wk));
      setXMark(readToxicXWallets().has(wk));
    };
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY ||
        e.key === TOXIC_BELL_WALLETS_LS_KEY ||
        e.key === TOXIC_X_WALLETS_LS_KEY ||
        e.key === null
      ) {
        sync();
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, sync);
    window.addEventListener(TOXIC_BELLS_CHANGED_EVENT, sync);
    window.addEventListener(TOXIC_X_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, sync);
      window.removeEventListener(TOXIC_BELLS_CHANGED_EVENT, sync);
      window.removeEventListener(TOXIC_X_CHANGED_EVENT, sync);
    };
  }, [wk]);

  const toggleFav = useCallback(() => {
    const next = readToxicFavouriteWallets();
    if (next.has(wk)) next.delete(wk);
    else {
      next.add(wk);
      const nick = (embed?.polymarketNickname ?? '').trim();
      if (nick) setToxicFavouriteNickname(wk, nick);
    }
    persistToxicFavouriteWallets(next);
    setFav(next.has(wk));
  }, [wk, embed?.polymarketNickname]);

  const toggleBell = useCallback(() => {
    primeTiltAudioContextFromUserGesture();
    const next = readToxicBellWallets();
    if (next.has(wk)) next.delete(wk);
    else next.add(wk);
    persistToxicBellWallets(next);
    setBell(next.has(wk));
  }, [wk]);

  const toggleX = useCallback(() => {
    const next = readToxicXWallets();
    if (next.has(wk)) next.delete(wk);
    else next.add(wk);
    persistToxicXWallets(next);
    setXMark(next.has(wk));
  }, [wk]);

  const tt = embed?.totalTrades ?? trader?.tradeCount ?? 0;
  const vol = (embed?.usdcIn ?? 0) + (embed?.usdcOut ?? 0);
  const wn = embed?.wins ?? 0;
  const ls = embed?.losses ?? 0;
  const fl = embed?.flat ?? 0;
  const pnl = embed?.pnl;

  return (
    <div className="shrink-0 mb-1 pb-1 border-b border-gray-800/80 space-y-0.5">
      <div className="flex flex-wrap items-center gap-1 min-w-0">
        <button type="button" className="rounded p-0.5 hover:bg-gray-700/50" onClick={toggleFav} aria-pressed={fav}>
          <Star size={12} className={fav ? STAR_CLS_ON : STAR_CLS_OFF} />
        </button>
        <button type="button" className="rounded p-0.5 hover:bg-gray-700/50" onClick={toggleBell} aria-pressed={bell}>
          <Bell size={11} strokeWidth={2} className={bell ? BELL_CLS_ON : BELL_CLS_OFF} />
        </button>
        <button type="button" className="rounded p-0.5 hover:bg-gray-700/50" onClick={toggleX} aria-pressed={xMark}>
          <X size={11} strokeWidth={2} className={xMark ? X_CLS_ON : X_CLS_OFF} />
        </button>
        <WalletAddressGlyph address={wallet} size={14} />
        <span className={`min-w-0 truncate text-[11px] font-medium ${addrClass}`} title={wallet}>
          {primary}
        </span>
        {secondary ? (
          <span className="min-w-0 truncate text-[9px] text-gray-500 font-mono" title={wallet}>
            {secondary}
          </span>
        ) : null}
      </div>
      {embed ? (
        <div className="text-[9px] text-gray-400 tabular-nums pl-0.5">
          Trades {fmtInt(Number(tt))} · Vol ${vol.toLocaleString('en-US', { maximumFractionDigits: 0 })} · {fmtInt(wn)}\
          {fmtInt(ls)}\{fmtInt(fl)}
          {typeof pnl === 'number' && Number.isFinite(pnl) ? (
            <>
              {' '}
              · PnL{' '}
              <span className={pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                {pnl >= 0 ? '+' : '−'}${Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
