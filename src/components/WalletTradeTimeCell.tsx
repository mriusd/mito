import { memo } from 'react';
import {
  blockTimeToEpochMs,
  formatElapsedSinceMs,
  formatWalletTradeTimeBase,
  tradeElapsedAgeSec,
  tradeElapsedColorClass,
} from '../utils/format';

export function WalletTradeTimeCell({
  blockTime,
  nowMs,
}: {
  blockTime: number;
  nowMs: number;
}) {
  if (!blockTime) return <>—</>;
  const base = formatWalletTradeTimeBase(blockTime);
  const ms = blockTimeToEpochMs(blockTime);
  const elapsed = formatElapsedSinceMs(ms, nowMs);
  if (!elapsed) return <>{base}</>;
  const elapsedCls = tradeElapsedColorClass(tradeElapsedAgeSec(blockTime, nowMs));
  return (
    <>
      {base} <span className={elapsedCls}>({elapsed})</span>
    </>
  );
}

export const MemoWalletTradeTimeCell = memo(WalletTradeTimeCell);
