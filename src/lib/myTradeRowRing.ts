import { useEffect, useRef, useState } from 'react';
import {
  ensureTiltAudioUnlockListeners,
  pitchMulFromNotifyFreqSlider,
  playTradeNotifySound,
  readNotifyRingTimeS,
  readNotifyTradeSound,
  readTradeSoundFreqSlider,
} from './tiltNotifySound';
import { isNotifySoundPriceMuted } from './notifySoundPriceMute';
import { onchainFillKey, polymarketTradeKey } from './tradeKeys';

/** Must match `.my-trade-row-flash` animation duration in index.css. */
export const MY_TRADE_ROW_FLASH_MS = 1350;

export type MySidebarTradeRow = {
  asset_id?: string;
  token_id?: string;
  side?: string;
  price?: string;
  size?: string;
  timestamp?: number | string;
  txHash?: string;
  logIndex?: number;
  id?: string;
};

export function mySidebarTradeRowKey(trade: MySidebarTradeRow): string {
  const txHash = (trade.txHash || '').trim();
  const side = String(trade.side || '').toUpperCase();
  const tok = String(trade.asset_id || trade.token_id || '').trim();
  // SPLIT/MERGE YES+NO share logIndex — include token+side so both legs stay distinct.
  if (txHash && (side === 'SPLIT' || side === 'MERGE' || side === 'REDEEM')) {
    const base = onchainFillKey(txHash, trade.logIndex);
    return tok ? `${base}:${tok}:${side}` : `${base}:${side}`;
  }
  if (txHash) return onchainFillKey(txHash, trade.logIndex);
  const id = (trade.id || '').trim();
  if (id) return id;
  const ts = Number(trade.timestamp ?? 0);
  const price = String(trade.price ?? '');
  const size = String(trade.size ?? '');
  if (ts > 0 && price && size) return polymarketTradeKey(ts, price, size);
  return '';
}

export function useMyTradeRowRingSound(
  trades: MySidebarTradeRow[],
  scopeKey: string | null,
  active: boolean,
  yesTokenId?: string,
  noTokenId?: string,
): Set<string> {
  const [flashKeys, setFlashKeys] = useState<Set<string>>(() => new Set());
  const seenRef = useRef(new Set<string>());
  /** After scope change, seed rows until trades stop changing for a beat — no sounds until then. */
  const needsScopeSeedRef = useRef(true);
  const scopeSeedTimerRef = useRef<number | null>(null);
  const tradesRef = useRef(trades);
  tradesRef.current = trades;

  const clearScopeSeedTimer = () => {
    if (scopeSeedTimerRef.current != null) {
      clearTimeout(scopeSeedTimerRef.current);
      scopeSeedTimerRef.current = null;
    }
  };

  useEffect(() => {
    needsScopeSeedRef.current = true;
    seenRef.current = new Set();
    setFlashKeys(new Set());
    clearScopeSeedTimer();
    return clearScopeSeedTimer;
  }, [scopeKey]);

  useEffect(() => {
    if (!active || !scopeKey) return;
    ensureTiltAudioUnlockListeners();
    const seen = seenRef.current;

    if (needsScopeSeedRef.current) {
      for (const trade of trades) {
        const k = mySidebarTradeRowKey(trade);
        if (k) seen.add(k);
      }
      clearScopeSeedTimer();
      scopeSeedTimerRef.current = window.setTimeout(() => {
        scopeSeedTimerRef.current = null;
        for (const trade of tradesRef.current) {
          const k = mySidebarTradeRowKey(trade);
          if (k) seenRef.current.add(k);
        }
        needsScopeSeedRef.current = false;
      }, 500);
      return;
    }

    for (const trade of trades) {
      const k = mySidebarTradeRowKey(trade);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      if (!readNotifyTradeSound()) continue;
      if (isNotifySoundPriceMuted(yesTokenId, noTokenId)) continue;
      const side = (trade.side || '').toUpperCase();
      const kind = side === 'SELL' || side === 'MERGE' ? 'red' : 'green';
      const pitchMul = pitchMulFromNotifyFreqSlider(readTradeSoundFreqSlider());
      const ringTimeS = readNotifyRingTimeS();
      void playTradeNotifySound(kind, pitchMul, ringTimeS);
      setFlashKeys((prev) => new Set(prev).add(k));
      window.setTimeout(() => {
        setFlashKeys((prev) => {
          const next = new Set(prev);
          next.delete(k);
          return next;
        });
      }, MY_TRADE_ROW_FLASH_MS);
    }
  }, [trades, active, scopeKey, yesTokenId, noTokenId]);

  return flashKeys;
}
