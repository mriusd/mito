import { useEffect, useRef, useState } from 'react';
import {
  ensureTiltAudioUnlockListeners,
  pitchMulFromNotifyFreqSlider,
  playTradeNotifySound,
  readNotifyRingTimeS,
  readTradeSoundFreqSlider,
} from './tiltNotifySound';
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
): Set<string> {
  const [flashKeys, setFlashKeys] = useState<Set<string>>(() => new Set());
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    seenRef.current = new Set();
  }, [scopeKey]);

  useEffect(() => {
    if (!active) return;
    ensureTiltAudioUnlockListeners();
    const seen = seenRef.current;
    for (const trade of trades) {
      const k = mySidebarTradeRowKey(trade);
      if (!k || seen.has(k)) continue;
      const isNew = seen.size > 0;
      seen.add(k);
      if (!isNew) continue;
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
  }, [trades, active]);

  return flashKeys;
}
