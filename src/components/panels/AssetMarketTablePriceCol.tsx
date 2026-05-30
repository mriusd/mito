import { memo } from 'react';
import type { AssetName } from '../../types';
import { assetToSymbol, formatPriceShort, formatThousandsAsK, parseStrikeTokenToNumber } from '../../utils/format';
import { useGridAssetLivePrice } from '../../lib/gridAssetLivePriceStore';

function isPriceConditionTrue(priceStr: string, live: number): boolean {
  if (live <= 0) return false;
  const bounds = parsePriceBounds(priceStr);
  if (bounds.low === 0 && bounds.high !== Infinity) return live < bounds.high;
  if (bounds.high === Infinity) return live > bounds.low;
  if (bounds.low === bounds.high) return live >= bounds.low;
  return live >= bounds.low && live <= bounds.high;
}

export function parsePriceBounds(str: string): { low: number; high: number } {
  let s = str.replace(/\$/g, '').replace(/,/g, '').trim();
  const isLt = s.startsWith('<');
  const isGt = s.startsWith('>');
  s = s.replace(/</g, '').replace(/>/g, '');
  const parseNum = (v: string) => parseStrikeTokenToNumber(v) || 0;
  if (s.includes('-')) {
    const parts = s.split('-');
    return { low: parseNum(parts[0]), high: parseNum(parts[1]) };
  }
  const n = parseNum(s);
  if (isLt) return { low: 0, high: n };
  if (isGt) return { low: n, high: Infinity };
  return { low: n, high: n };
}

export const AssetMarketTableHitPriceCol = memo(function AssetMarketTableHitPriceCol({
  asset,
  priceStr,
  titleColor,
  hitPrice,
}: {
  asset: AssetName;
  priceStr: string;
  titleColor: string;
  hitPrice: (t: string) => number;
}) {
  const livePrice = useGridAssetLivePrice(assetToSymbol(asset));
  const arrow = priceStr.includes('↑') ? '↑' : priceStr.includes('↓') ? '↓' : '';
  const num = hitPrice(priceStr);
  const priceShortAsset = asset === 'ETH' ? 'ETH' : undefined;
  const fmt = num >= 1000 ? formatThousandsAsK(num, priceShortAsset) : String(num);
  const pct = livePrice > 0 && num > 0 ? ((num - livePrice) / livePrice) * 100 : 0;
  const pctSign = pct >= 0 ? '+' : '';
  const isAtPrice = livePrice > 0 && Math.abs(pct) < 0.5;

  return (
    <td
      className={`price-col-cell sticky left-0 bg-gray-900 z-10 px-1 py-0.5 font-bold ${titleColor} border-b border-gray-700/50 whitespace-nowrap text-xs`}
      data-price-low={hitPrice(priceStr)}
      data-price-high={hitPrice(priceStr)}
    >
      <div className="flex flex-col leading-tight">
        <span>{arrow}{fmt}</span>
        {!isAtPrice && pct !== 0 && (
          <span className="text-gray-400 text-[11px]">{pctSign}{pct.toFixed(0)}%</span>
        )}
      </div>
    </td>
  );
});

export const AssetMarketTableStrikePriceCol = memo(function AssetMarketTableStrikePriceCol({
  asset,
  priceStr,
  titleColor,
  tableType,
  priceShortAsset,
}: {
  asset: AssetName;
  priceStr: string;
  titleColor: string;
  tableType: string;
  priceShortAsset?: 'ETH';
}) {
  const livePrice = useGridAssetLivePrice(assetToSymbol(asset));
  const conditionTrue = isPriceConditionTrue(priceStr, livePrice);
  const priceCellBg = conditionTrue ? 'bg-green-900/50' : 'bg-gray-900';
  const priceFontSize = tableType === 'price' ? 'text-[10px]' : 'text-xs';
  const bounds = parsePriceBounds(priceStr);
  const isCurrentRange = livePrice > bounds.low && livePrice < bounds.high;
  let targetPrice: number;
  if (livePrice <= bounds.low) targetPrice = bounds.low;
  else if (livePrice >= bounds.high) targetPrice = bounds.high;
  else targetPrice = livePrice;
  const pctChange = livePrice > 0 && targetPrice > 0 && targetPrice !== Infinity
    ? ((targetPrice - livePrice) / livePrice) * 100
    : 0;
  const pctSign = pctChange >= 0 ? '+' : '';

  return (
    <td
      className={`price-col-cell sticky left-0 ${priceCellBg} z-10 px-1 py-0.5 font-bold ${titleColor} border-b border-gray-700/50 whitespace-nowrap ${priceFontSize}`}
      data-price-low={bounds.low}
      data-price-high={bounds.high === Infinity ? 999999999 : bounds.high}
    >
      <div className="flex flex-col leading-tight">
        <span>{formatPriceShort(priceStr, priceShortAsset)}</span>
        {!isCurrentRange && pctChange !== 0 && (
          <span className="text-gray-400 text-[11px]">{pctSign}{pctChange.toFixed(0)}%</span>
        )}
      </div>
    </td>
  );
});
