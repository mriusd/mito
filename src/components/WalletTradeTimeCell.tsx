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
    <span className="flex w-full min-w-0 items-center justify-between gap-2">
      <span className="shrink-0 tabular-nums">{base}</span>
      <span className={`shrink-0 tabular-nums ${elapsedCls}`}>{elapsed}</span>
    </span>
  );
}

export const MemoWalletTradeTimeCell = memo(WalletTradeTimeCell);
