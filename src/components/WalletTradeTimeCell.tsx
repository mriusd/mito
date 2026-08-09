import { memo } from 'react';
import {
  blockTimeToEpochMs,
  formatElapsedSinceMs,
  formatWalletTradeTimeBase,
  tradeElapsedAgeSec,
  tradeElapsedColorClass,
} from '../utils/format';
import { useWalletTradeElapsedMs } from '../lib/walletTradeElapsedStore';

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

/** Subscribes shared 5s elapsed tick — parent table stays idle. */
export const LiveWalletTradeTimeCell = memo(function LiveWalletTradeTimeCell({
  blockTime,
}: {
  blockTime: number;
}) {
  const nowMs = useWalletTradeElapsedMs();
  return <WalletTradeTimeCell blockTime={blockTime} nowMs={nowMs} />;
});

function tpoElapsedColor(timeMs: number, nowMs: number): string {
  const ageMs = timeMs > 0 ? nowMs - timeMs : Infinity;
  if (ageMs < 60_000) return 'text-purple-400';
  if (ageMs < 15 * 60_000) return 'text-green-400';
  if (ageMs < 60 * 60_000) return 'text-yellow-400';
  return 'text-gray-400';
}

/** TPO / sidebar Time column — 5s tick, parent stays idle. */
export const LiveElapsedAgeCell = memo(function LiveElapsedAgeCell({ timeMs }: { timeMs: number }) {
  const nowMs = useWalletTradeElapsedMs();
  if (timeMs <= 0) return null;
  return (
    <span className={tpoElapsedColor(timeMs, nowMs)}>
      {formatElapsedSinceMs(timeMs, nowMs)}
    </span>
  );
});

/** Same unit ladder as Time column (`5s` / `12m` / `3h` / `2d`), for remaining time. */
function formatRemainingUntilMs(endMs: number, nowMs: number): string {
  if (!Number.isFinite(endMs) || endMs <= 0) return '';
  const diff = endMs - nowMs;
  if (diff <= 0) return 'Expired';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function tpoExpiryCountdownColor(endMs: number, nowMs: number): string {
  const rem = endMs - nowMs;
  if (rem <= 0) return 'text-red-400';
  if (rem < 60_000) return 'text-purple-400';
  if (rem < 15 * 60_000) return 'text-green-400';
  if (rem < 60 * 60_000) return 'text-yellow-400';
  return 'text-gray-400';
}

/** TPO positions Date (crypto) — live expiry countdown, same format as Time column. */
export const LiveExpiryCountdownCell = memo(function LiveExpiryCountdownCell({
  endMs,
}: {
  endMs: number;
}) {
  const nowMs = useWalletTradeElapsedMs();
  if (!Number.isFinite(endMs) || endMs <= 0) {
    return <span className="text-gray-400">-</span>;
  }
  return (
    <span className={`tabular-nums ${tpoExpiryCountdownColor(endMs, nowMs)}`}>
      {formatRemainingUntilMs(endMs, nowMs)}
    </span>
  );
});
