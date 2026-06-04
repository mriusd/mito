import { Fragment, memo, useMemo, useRef } from 'react';
import type { Market } from '../../types';
import { UpDownAssetLaneCells } from './UpDownAssetLaneCells';
import { useExpiryNow } from '../../hooks/useExpiryNow';
import { useUpDownExpiryBarNow } from '../../lib/upDownExpiryBarTickStore';

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;
const LAST_TIMEFRAME = TIMEFRAMES[TIMEFRAMES.length - 1];

const TF_DURATIONS_MS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

const EXPIRY_BAR_BG = 'rgba(6, 182, 212, 0.6)';

function formatCountdown(endMs: number, nowMs: number): string {
  const rem = endMs - nowMs;
  if (rem <= 0) return '0s';
  const sec = Math.floor(rem / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function expiryProgress(nowMs: number, endMs: number, durationMs: number): number {
  if (endMs <= 0 || durationMs <= 0) return 0;
  const startMs = endMs - durationMs;
  return Math.max(0, Math.min(1, (nowMs - startMs) / durationMs));
}

/** 1 Hz tf label countdown only — not whole up/down row body. */
const UpDownTfRowCountdown = memo(function UpDownTfRowCountdown({ endMs }: { endMs: number }) {
  const now = useExpiryNow();
  if (endMs <= 0) return null;
  const rem = endMs - now;
  const color =
    rem < 60_000 ? 'text-red-400' : rem < 300_000 ? 'text-yellow-400' : 'text-green-400';
  return (
    <span className={`text-[8px] font-normal ${color}`}>{formatCountdown(endMs, now)}</span>
  );
});

type UpDownLane = { current: Market | null; futures: (Market | null)[] };

function buildLane(
  markets: Market[],
  now: number,
  nextMarketsCount: number,
): UpDownLane {
  const currentIdx = markets.findIndex((m) => m.endDate && new Date(m.endDate).getTime() > now);
  if (currentIdx === -1) {
    return { current: null, futures: Array.from({ length: nextMarketsCount }, () => null) };
  }
  const futures: (Market | null)[] = [];
  for (let i = 0; i < nextMarketsCount; i++) {
    futures.push(markets[currentIdx + 1 + i] ?? null);
  }
  return { current: markets[currentIdx], futures };
}

export const UpDownTimeframeRow = memo(function UpDownTimeframeRow({
  tf,
  laneNowMs,
  visibleAssets,
  sortedOpenByAssetTf,
  nextMarketsCount,
  showTarget,
  showTargetProb,
  tfDupExpiry,
  colsPerAsset,
  volBySym,
  volMultiplier,
  bsTimeOffsetHours,
  positionTokenIds,
  orderLookup,
  selectedMarketId,
  onCellClick,
  liveTradesSource,
}: {
  tf: (typeof TIMEFRAMES)[number];
  laneNowMs: number;
  visibleAssets: (typeof ASSETS)[number][];
  sortedOpenByAssetTf: Partial<
    Record<(typeof ASSETS)[number], Partial<Record<(typeof TIMEFRAMES)[number], Market[]>>>
  >;
  nextMarketsCount: number;
  showTarget: boolean;
  showTargetProb: boolean;
  tfDupExpiry: boolean;
  colsPerAsset: number;
  volBySym: Record<string, number>;
  volMultiplier: number;
  bsTimeOffsetHours: number;
  positionTokenIds: Set<string>;
  orderLookup: Record<string, import('../../types').Order[]>;
  selectedMarketId?: string;
  onCellClick: (market: Market, outcome?: 'YES' | 'NO') => void;
  liveTradesSource: string;
}) {
  const now = laneNowMs;
  const laneCacheRef = useRef(new Map<string, UpDownLane>());

  const laneByAsset = useMemo(() => {
    const out: Partial<Record<(typeof ASSETS)[number], UpDownLane>> = {};
    const cache = laneCacheRef.current;
    for (const asset of visibleAssets) {
      const markets = sortedOpenByAssetTf[asset]?.[tf] ?? [];
      const raw = buildLane(markets, now, nextMarketsCount);
      const key = `${asset}\0${tf}`;
      const prev = cache.get(key);
      if (
        prev &&
        prev.current === raw.current &&
        prev.futures.length === raw.futures.length &&
        prev.futures.every((m, i) => m === raw.futures[i])
      ) {
        out[asset] = prev;
      } else {
        cache.set(key, raw);
        out[asset] = raw;
      }
    }
    return out;
  }, [visibleAssets, sortedOpenByAssetTf, tf, now, nextMarketsCount]);

  const duration = TF_DURATIONS_MS[tf] || 0;
  const firstMarket = visibleAssets.map((a) => laneByAsset[a]?.current ?? null).find((m) => m !== null);
  const endMs = firstMarket?.endDate ? new Date(firstMarket.endDate).getTime() : 0;
  const tfProgressPct = (expiryProgress(now, endMs, duration) * 100).toFixed(1);
  const isLastTfRow = tf === LAST_TIMEFRAME;

  return (
    <tr className="hover:bg-gray-800/50">
      <td
        className={`px-1 py-1 font-bold text-white border-b border-r border-gray-700 whitespace-nowrap relative align-middle ${
          tfDupExpiry ? 'bg-red-950/70' : 'bg-gray-900'
        }`}
        title={tfDupExpiry ? 'This timeframe shares the same expiry instant as another row' : undefined}
      >
        <div className="flex items-center justify-between gap-1">
          <span>{tf}</span>
          <UpDownTfRowCountdown endMs={endMs} />
        </div>
        {endMs > 0 && duration > 0 && (
          <div
            className="absolute bottom-0 left-0 z-0 h-[2px] pointer-events-none"
            style={{ width: `${tfProgressPct}%`, backgroundColor: EXPIRY_BAR_BG }}
          />
        )}
      </td>
      {visibleAssets.map((asset) => {
        const lane = laneByAsset[asset];
        const market = lane?.current ?? null;
        const futuresSlots = lane?.futures ?? Array.from({ length: nextMarketsCount }, () => null);
        if (!market) {
          return (
            <td
              key={asset}
              colSpan={colsPerAsset}
              className={`px-1 py-1 text-center border-l border-r border-solid border-gray-700 text-gray-600 align-middle ${isLastTfRow ? 'border-b' : 'border-b border-gray-700/50'}`}
            >
              -
            </td>
          );
        }

        const sym = (asset + 'USDT') as import('../../types').AssetSymbol;
        return (
          <UpDownAssetLaneCells
            key={asset}
            asset={asset}
            tf={tf}
            market={market}
            futuresSlots={futuresSlots}
            showTarget={showTarget}
            showTargetProb={showTargetProb}
            isLastTfRow={isLastTfRow}
            nextMarketsCount={nextMarketsCount}
            vol={volBySym[sym]}
            volMultiplier={volMultiplier}
            bsTimeOffsetHours={bsTimeOffsetHours}
            positionTokenIds={positionTokenIds}
            orderLookup={orderLookup}
            selectedMarketId={selectedMarketId}
            onCellClick={onCellClick}
            liveTradesSource={liveTradesSource}
          />
        );
      })}
    </tr>
  );
});

export const UpDownTimeframeRowsBody = memo(function UpDownTimeframeRowsBody({
  visibleAssets,
  sortedOpenByAssetTf,
  nextMarketsCount,
  showTarget,
  showTargetProb,
  colsPerAsset,
  volBySym,
  volMultiplier,
  bsTimeOffsetHours,
  positionTokenIds,
  orderLookup,
  selectedMarketId,
  onCellClick,
  liveTradesSource,
}: {
  visibleAssets: (typeof ASSETS)[number][];
  sortedOpenByAssetTf: Partial<
    Record<(typeof ASSETS)[number], Partial<Record<(typeof TIMEFRAMES)[number], Market[]>>>
  >;
  nextMarketsCount: number;
  showTarget: boolean;
  showTargetProb: boolean;
  colsPerAsset: number;
  volBySym: Record<string, number>;
  volMultiplier: number;
  bsTimeOffsetHours: number;
  positionTokenIds: Set<string>;
  orderLookup: Record<string, import('../../types').Order[]>;
  selectedMarketId?: string;
  onCellClick: (market: Market, outcome?: 'YES' | 'NO') => void;
  liveTradesSource: string;
}) {
  const laneNowMs = useUpDownExpiryBarNow();

  const timeframesWithSharedExpiry = useMemo(() => {
    const endMsByTf: Partial<Record<(typeof TIMEFRAMES)[number], number>> = {};
    for (const tf of TIMEFRAMES) {
      let endMs = 0;
      for (const a of visibleAssets) {
        const markets = sortedOpenByAssetTf[a]?.[tf] ?? [];
        const currentIdx = markets.findIndex((m) => m.endDate && new Date(m.endDate).getTime() > laneNowMs);
        const m = currentIdx === -1 ? null : markets[currentIdx];
        if (m?.endDate) {
          endMs = new Date(m.endDate).getTime();
          break;
        }
      }
      endMsByTf[tf] = endMs;
    }
    const byEnd = new Map<number, (typeof TIMEFRAMES)[number][]>();
    for (const tf of TIMEFRAMES) {
      const e = endMsByTf[tf];
      if (!e || e <= 0) continue;
      if (!byEnd.has(e)) byEnd.set(e, []);
      byEnd.get(e)!.push(tf);
    }
    const dup = new Set<string>();
    for (const list of byEnd.values()) {
      if (list.length >= 2) list.forEach((t) => dup.add(t));
    }
    return dup;
  }, [visibleAssets, sortedOpenByAssetTf, laneNowMs]);

  return (
    <>
      {TIMEFRAMES.map((tf) => (
        <UpDownTimeframeRow
          key={tf}
          tf={tf}
          laneNowMs={laneNowMs}
          visibleAssets={visibleAssets}
          sortedOpenByAssetTf={sortedOpenByAssetTf}
          nextMarketsCount={nextMarketsCount}
          showTarget={showTarget}
          showTargetProb={showTargetProb}
          tfDupExpiry={timeframesWithSharedExpiry.has(tf)}
          colsPerAsset={colsPerAsset}
          volBySym={volBySym}
          volMultiplier={volMultiplier}
          bsTimeOffsetHours={bsTimeOffsetHours}
          positionTokenIds={positionTokenIds}
          orderLookup={orderLookup}
          selectedMarketId={selectedMarketId}
          onCellClick={onCellClick}
          liveTradesSource={liveTradesSource}
        />
      ))}
    </>
  );
});
