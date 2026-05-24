import { memo, useMemo, type CSSProperties } from 'react';
import type { AssetName, Market, Order } from '../../types';
import { assetToSymbol } from '../../utils/format';
import { getMarketProbability, getHitMarketProbability } from '../../utils/bsMath';
import { gammaImpliedNoBestBid, outcomeBestBidProb, outcomeMidOrOneSideProb } from '../../lib/outcomeQuote';
import { marketRowContentEqual } from '../../lib/marketDataDedupe';
import { GRID_BID_ASK_THROTTLE_MS } from '../../lib/bidAskMarketLookup';
import { useThrottledBidAskPair } from '../../hooks/useThrottledBidAskPair';
import { useThrottledStorePrice } from '../../hooks/useThrottledStorePrice';
import { MarketCellMidRow } from './MarketCellMidRow';

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
  isHit = false,
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

export type GridMarketCellProps = {
  market: Market;
  asset: AssetName;
  endDate: string;
  /** Strike / range label for B-S delta background */
  deltaPriceStr: string;
  isHit?: boolean;
  isClosed?: boolean;
  isPast?: boolean;
  isWeekend?: boolean;
  minWidth?: number;
  signalsOnGrid: boolean;
  yesDiff?: string | null;
  noDiff?: string | null;
  isSelected: boolean;
  isColHighlighted?: boolean;
  adjVol: number;
  bsTimeOffsetHours: number;
  yesPosSize?: number;
  noPosSize?: number;
  yesOrders: Order[];
  noOrders: Order[];
  onCellClick: (market: Market, outcome?: 'YES' | 'NO') => void;
  /** above/between show sell-order badges; hit shows highlighted position rows */
  variant: 'above' | 'between' | 'hit' | 'updown';
  skipDeltaBg?: boolean;
};

function isPriceConditionTrue(priceStr: string, live: number): boolean {
  if (live <= 0) return false;
  const cleaned = priceStr.replace(/\$/g, '').replace(/,/g, '');
  if (cleaned.startsWith('>')) {
    const val = parseFloat(cleaned.substring(1));
    return !isNaN(val) && live > val;
  }
  if (cleaned.startsWith('<')) {
    const val = parseFloat(cleaned.substring(1));
    return !isNaN(val) && live < val;
  }
  if (cleaned.includes('-')) {
    const parts = cleaned.split('-');
    const lo = parseFloat(parts[0]);
    const hi = parseFloat(parts[1]);
    return !isNaN(lo) && !isNaN(hi) && live >= lo && live <= hi;
  }
  const threshold = parseFloat(cleaned);
  return !isNaN(threshold) && live >= threshold;
}

function GridMarketCellInner({
  market,
  asset,
  endDate,
  deltaPriceStr,
  isHit = false,
  isClosed = false,
  isPast = false,
  isWeekend = false,
  minWidth = 68,
  signalsOnGrid,
  yesDiff,
  noDiff,
  isSelected,
  isColHighlighted = false,
  adjVol,
  bsTimeOffsetHours,
  yesPosSize,
  noPosSize,
  yesOrders,
  noOrders,
  onCellClick,
  variant,
  skipDeltaBg = false,
}: GridMarketCellProps) {
  const livePrice = useThrottledStorePrice(assetToSymbol(asset), 1000);
  const tokenIds = market.clobTokenIds || [];
  const yesTokenId = tokenIds[0] || '';
  const noTokenId = tokenIds[1] || '';

  const ws = useThrottledBidAskPair(yesTokenId, noTokenId, GRID_BID_ASK_THROTTLE_MS);
  const ptb = market.priceToBeat ?? ws.yes?.priceToBeat;
  const strikeStr =
    deltaPriceStr ||
    (ptb != null && Number.isFinite(ptb) ? '>' + ptb : '');
  const skipDelta = skipDeltaBg || (variant === 'updown' && (isPast || ptb == null));

  const conditionMet =
    variant === 'above' || variant === 'between'
      ? isPriceConditionTrue(strikeStr, livePrice)
      : false;
  const yesWinning = conditionMet;
  const noWinning = !conditionMet && livePrice > 0;

  const cellLookup = useMemo(() => {
    const o: Record<string, Market> = {};
    if (yesTokenId) o[yesTokenId] = (ws.yes as Market | undefined) ?? market;
    if (noTokenId && ws.no) o[noTokenId] = ws.no;
    return o;
  }, [yesTokenId, noTokenId, ws.yes, ws.no, market]);

  const gammaYes = { bestBid: market.bestBid, bestAsk: market.bestAsk };
  const gammaNo = gammaImpliedNoBestBid(gammaYes);
  const yesBidProb = outcomeBestBidProb(yesTokenId, cellLookup, gammaYes);
  const yesMidProb = outcomeMidOrOneSideProb(yesTokenId, cellLookup, gammaYes);
  const noBidProb = outcomeBestBidProb(noTokenId, cellLookup, gammaNo);
  const yesBidStr = yesBidProb != null ? (yesBidProb * 100).toFixed(1) : '-';
  const noBidStr = noBidProb != null ? (noBidProb * 100).toFixed(1) : '-';

  const yesBuyOrders = yesOrders.filter((o) => o.side === 'BUY');
  const noBuyOrders = noOrders.filter((o) => o.side === 'BUY');
  const yesSellOrders = yesOrders.filter((o) => o.side === 'SELL');
  const noSellOrders = noOrders.filter((o) => o.side === 'SELL');

  const wbUsdc =
    typeof ws.yes?.winnerBias === 'number' && Number.isFinite(ws.yes.winnerBias)
      ? ws.yes.winnerBias
      : 0;
  const smsRaw = ws.yes?.provenSMS ?? 0;
  const smsPct = Math.max(2, Math.min(98, 50 + smsRaw * 50));
  const concRaw =
    typeof ws.yes?.concentration === 'number' && Number.isFinite(ws.yes.concentration)
      ? ws.yes.concentration
      : 0;
  const concPct = Math.max(0, Math.min(100, concRaw * 100));
  const cR = Math.round(Math.min(255, concRaw * 2 * 255));
  const cG = Math.round(Math.min(255, (1 - concRaw) * 2 * 255));
  const concColor = `rgb(${cR}, ${cG}, 0)`;
  const wbPct = Math.max(2, Math.min(98, 50 + wbUsdc * 50));

  const gridDeltaBg = !skipDelta && !isClosed && !isPast
    ? deltaBgStyle(strikeStr, yesMidProb, endDate, livePrice, adjVol, bsTimeOffsetHours, isHit)
    : {};

  const bgColor = isClosed || isPast ? 'bg-gray-700/30' : '';
  const opacityClass = isClosed || isPast ? 'opacity-50' : '';
  const borderClass = variant === 'updown' ? 'border border-gray-400' : 'border border-gray-700';
  const rowBorder = 'border-b border-gray-700/50';
  const marketTitle = market.question || market.groupItemTitle || '';
  const strike = market.groupItemTitle || '';

  return (
    <td
      data-market-id={market.id}
      className={`market-cell px-0.5 py-${variant === 'above' || variant === 'between' ? '0.5' : '1'} text-center ${rowBorder} ${bgColor} ${opacityClass} whitespace-nowrap ${borderClass} relative cursor-pointer hover:brightness-125 ${isSelected ? 'selected' : ''} ${isColHighlighted && !isSelected ? 'date-column-highlighted' : ''}`}
      style={{
        minWidth,
        ...(isWeekend && !isSelected && !isColHighlighted ? { boxShadow: 'inset 0 0 0 100px rgba(147, 51, 234, 0.08)' } : {}),
        ...gridDeltaBg,
      }}
      onClick={() => onCellClick(market)}
    >
      {signalsOnGrid && (yesDiff || noDiff) && (
        <>
          {yesDiff && (
            <div className="absolute top-0 left-0 text-[7px] font-bold leading-none px-[2px] text-black bg-green-400 rounded-br-sm z-10">{yesDiff}</div>
          )}
          {noDiff && (
            <div className="absolute top-0 right-0 text-[7px] font-bold leading-none px-[2px] text-black bg-green-400 rounded-bl-sm z-10">{noDiff}</div>
          )}
        </>
      )}
      <MarketCellMidRow
        className="text-[10px] text-gray-400"
        left={
          <span
            className="ob-trigger text-green-400 cursor-pointer hover:underline"
            data-token-id={yesTokenId}
            data-market-title={`${marketTitle} (YES bid)`}
            data-asset={asset}
            data-strike={strike}
            data-end-date={endDate || ''}
            onClick={(e) => { e.stopPropagation(); onCellClick(market, 'YES'); }}
          >{yesBidStr}</span>
        }
        right={
          <span
            className="ob-trigger text-red-400 cursor-pointer hover:underline"
            data-token-id={noTokenId}
            data-market-title={`${marketTitle} (NO bid)`}
            data-asset={asset}
            data-strike={strike}
            data-end-date={endDate || ''}
            onClick={(e) => { e.stopPropagation(); onCellClick(market, 'NO'); }}
          >{noBidStr}</span>
        }
      />

      {(yesPosSize != null || noPosSize != null) && (
        <div className="mt-0.5 text-[9px] border-t border-gray-600/50 pt-0.5">
          {yesPosSize != null && (
            <div className={`text-green-300 text-center ${
              variant === 'hit'
                ? 'bg-yellow-500/40 px-1 rounded font-bold'
                : yesWinning
                  ? 'bg-green-500/40 px-1 rounded font-bold'
                  : livePrice > 0
                    ? 'bg-red-500/40 px-1 rounded'
                    : ''
            }`}>
              {fmtSz(yesPosSize)}
            </div>
          )}
          {noPosSize != null && (
            <div className={`text-red-300 text-center ${
              variant === 'hit'
                ? 'bg-yellow-500/40 px-1 rounded font-bold'
                : noWinning
                  ? 'bg-green-500/40 px-1 rounded font-bold'
                  : livePrice > 0
                    ? 'bg-red-500/40 px-1 rounded'
                    : ''
            }`}>
              {fmtSz(noPosSize)}
            </div>
          )}
        </div>
      )}

      {yesBuyOrders.length > 0 && (
        <div className="absolute bottom-0 left-0 z-[5] bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tr-sm">
          {(Math.max(...yesBuyOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
        </div>
      )}
      {yesSellOrders.length > 0 && (
        <div className={`absolute ${yesBuyOrders.length > 0 ? 'bottom-[9px]' : 'bottom-0'} left-0 z-[5] bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tr-sm`} style={{ color: '#78350f' }}>
          {(Math.min(...yesSellOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
        </div>
      )}
      {noBuyOrders.length > 0 && (
        <div className="absolute bottom-0 right-0 z-[5] bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tl-sm">
          {(Math.max(...noBuyOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
        </div>
      )}
      {noSellOrders.length > 0 && (
        <div className={`absolute ${noBuyOrders.length > 0 ? 'bottom-[9px]' : 'bottom-0'} right-0 z-[5] bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tl-sm`} style={{ color: '#78350f' }}>
          {(Math.min(...noSellOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
        </div>
      )}
      <div
        className="absolute left-0 bottom-0 w-[2px] pointer-events-none z-0 bg-gray-800/80 overflow-hidden"
        style={{ height: '100%' }}
        title={`Concentration (top wallets): ${concPct.toFixed(0)}%`}
      >
        <div
          className="absolute bottom-0 left-0 w-full transition-all"
          style={{ height: `${concPct}%`, backgroundColor: concColor }}
        />
      </div>
      <div
        className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none z-[1] flex"
        title={`Winners $ (USDC bias, top 30%): ${(wbUsdc * 100).toFixed(0)}%`}
      >
        <div className="bg-cyan-400/75 h-full shrink-0 transition-[width]" style={{ width: `${wbPct}%` }} />
        <div className="bg-pink-400/75 h-full flex-1 min-w-0" />
      </div>
      <div
        className="absolute bottom-[2px] left-0 right-0 h-[2px] pointer-events-none z-[1] flex"
        title={`Smart Money (proven wallets): ${(smsRaw * 100).toFixed(0)}%`}
      >
        <div className="bg-yellow-400/75 h-full shrink-0 transition-[width]" style={{ width: `${smsPct}%` }} />
        <div className="bg-purple-400/75 h-full flex-1 min-w-0" />
      </div>
    </td>
  );
}

export const GridMarketCell = memo(GridMarketCellInner, (a, b) => {
  if (
    a.asset !== b.asset ||
    a.endDate !== b.endDate ||
    a.deltaPriceStr !== b.deltaPriceStr ||
    a.isHit !== b.isHit ||
    a.isClosed !== b.isClosed ||
    a.isPast !== b.isPast ||
    a.isWeekend !== b.isWeekend ||
    a.minWidth !== b.minWidth ||
    a.signalsOnGrid !== b.signalsOnGrid ||
    a.yesDiff !== b.yesDiff ||
    a.noDiff !== b.noDiff ||
    a.isSelected !== b.isSelected ||
    a.isColHighlighted !== b.isColHighlighted ||
    a.adjVol !== b.adjVol ||
    a.bsTimeOffsetHours !== b.bsTimeOffsetHours ||
    a.yesPosSize !== b.yesPosSize ||
    a.noPosSize !== b.noPosSize ||
    a.variant !== b.variant ||
    a.skipDeltaBg !== b.skipDeltaBg ||
    a.onCellClick !== b.onCellClick
  ) {
    return false;
  }
  if (!ordersPropEqual(a.yesOrders, b.yesOrders)) return false;
  if (!ordersPropEqual(a.noOrders, b.noOrders)) return false;
  return marketRowContentEqual(a.market, b.market);
});

function ordersPropEqual(a: Order[], b: Order[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const oa = a[i];
    const ob = b[i];
    if (oa.id !== ob.id || oa.side !== ob.side || oa.price !== ob.price || oa.size !== ob.size) return false;
  }
  return true;
}
