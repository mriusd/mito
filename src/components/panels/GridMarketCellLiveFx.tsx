import { memo, type CSSProperties } from 'react';
import type { AssetName } from '../../types';
import { assetToSymbol } from '../../utils/format';
import { getMarketProbability, getHitMarketProbability } from '../../utils/bsMath';
import { useGridAssetLivePrice } from '../../lib/gridAssetLivePriceStore';

const fmtSz = (sz: number) => {
  const v = Math.floor(sz);
  return v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : v.toLocaleString();
};

function deltaBgStyle(
  priceStr: string,
  yesMidProb: number | null,
  endDate: string,
  livePrice: number,
  adjVol: number,
  bsTimeOffsetHours: number,
  isHit: boolean,
): CSSProperties {
  if (yesMidProb == null || livePrice <= 0 || !endDate) return {};
  const cleaned = priceStr
    .replace(/\$/g, '').replace(/,/g, '')
    .replace(/↑/g, '>').replace(/↓/g, '<')
    .trim();
  const ps = (cleaned.startsWith('>') || cleaned.startsWith('<') || cleaned.includes('-'))
    ? cleaned : '>' + cleaned;
  const mathProb = isHit
    ? getHitMarketProbability(ps, livePrice, endDate, adjVol, bsTimeOffsetHours)
    : getMarketProbability(ps, livePrice, endDate, adjVol, bsTimeOffsetHours);
  if (mathProb == null || !Number.isFinite(mathProb)) return {};
  const spreadPp = Math.abs(yesMidProb - mathProb) * 100;
  const alpha = Math.min(0.4, spreadPp * 0.035);
  if (alpha < 0.02) return {};
  const green = yesMidProb > mathProb;
  return {
    backgroundColor: green
      ? `rgba(34, 197, 94, ${alpha.toFixed(3)})`
      : `rgba(239, 68, 68, ${alpha.toFixed(3)})`,
  };
}

export type GridMarketCellLiveFxProps = {
  asset: AssetName;
  endDate: string;
  strikeStr: string;
  yesMidProb: number | null;
  adjVol: number;
  bsTimeOffsetHours: number;
  isHit: boolean;
  isClosed: boolean;
  isPast: boolean;
  skipDelta: boolean;
  variant: 'above' | 'between' | 'hit' | 'updown';
  yesPosSize?: number;
  noPosSize?: number;
};

export const GridMarketCellLiveFx = memo(function GridMarketCellLiveFx({
  asset,
  endDate,
  strikeStr,
  yesMidProb,
  adjVol,
  bsTimeOffsetHours,
  isHit,
  isClosed,
  isPast,
  skipDelta,
  yesPosSize,
  noPosSize,
}: GridMarketCellLiveFxProps) {
  const livePrice = useGridAssetLivePrice(assetToSymbol(asset));

  const gridDeltaBg = !skipDelta && !isClosed && !isPast
    ? deltaBgStyle(strikeStr, yesMidProb, endDate, livePrice, adjVol, bsTimeOffsetHours, isHit)
    : {};

  return (
    <>
      {Object.keys(gridDeltaBg).length > 0 ? (
        <div className="absolute inset-0 pointer-events-none z-0" style={gridDeltaBg} aria-hidden />
      ) : null}
      {(yesPosSize != null || noPosSize != null) && (
        <div className="relative z-[2] mt-0.5 text-[9px] border-t border-gray-600/50 pt-0.5">
          {yesPosSize != null && (
            <div className="text-green-300 text-center bg-green-500/40 px-1 rounded font-bold">
              {fmtSz(yesPosSize)}
            </div>
          )}
          {noPosSize != null && (
            <div className="text-red-300 text-center bg-red-500/40 px-1 rounded font-bold">
              {fmtSz(noPosSize)}
            </div>
          )}
        </div>
      )}
    </>
  );
});
