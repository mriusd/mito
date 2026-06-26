import { memo, useMemo } from 'react';
import type { AssetName, Market, Order } from '../../types';
import { gammaImpliedNoBestBid, outcomeBestBidProb, outcomeMidOrOneSideProb } from '../../lib/outcomeQuote';
import { marketRowContentEqual } from '../../lib/marketDataDedupe';
import { useThrottledBidAskPair } from '../../hooks/useThrottledBidAskPair';
import { MarketCellMidRow } from './MarketCellMidRow';
import { GridMarketCellLiveFx } from './GridMarketCellLiveFx';

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
  cellPyClass?: 'py-0.5' | 'py-1' | 'py-1.5' | 'py-2';
};

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
  cellPyClass,
}: GridMarketCellProps) {
  const tokenIds = market.clobTokenIds || [];
  const yesTokenId = tokenIds[0] || '';
  const noTokenId = tokenIds[1] || '';

  const ws = useThrottledBidAskPair(yesTokenId, noTokenId);
  const ptb = market.priceToBeat ?? ws.yes?.priceToBeat;
  const strikeStr =
    deltaPriceStr ||
    (ptb != null && Number.isFinite(ptb) ? '>' + ptb : '');
  const skipDelta = skipDeltaBg || (variant === 'updown' && (isPast || ptb == null));
  const showLiveFx = !skipDelta || yesPosSize != null || noPosSize != null;

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

  const bgColor = isClosed || isPast ? 'bg-gray-700/30' : '';
  const opacityClass = isClosed || isPast ? 'opacity-50' : '';
  const borderClass = variant === 'updown' ? 'border border-gray-400' : 'border border-gray-700';
  const rowBorder = 'border-b border-gray-700/50';
  const marketTitle = market.question || market.groupItemTitle || '';
  const strike = market.groupItemTitle || '';
  const pyClass =
    cellPyClass ?? (variant === 'above' || variant === 'between' ? 'py-0.5' : 'py-1');

  return (
    <td
      data-market-id={market.id}
      className={`market-cell px-0.5 ${pyClass} text-center ${rowBorder} ${bgColor} ${opacityClass} whitespace-nowrap ${borderClass} relative cursor-pointer hover:brightness-125 ${isSelected ? 'selected ring-2 ring-blue-500 ring-inset z-10' : ''} ${isColHighlighted && !isSelected ? 'date-column-highlighted' : ''}`}
      style={{
        minWidth,
        ...(isWeekend && !isSelected && !isColHighlighted ? { boxShadow: 'inset 0 0 0 100px rgba(147, 51, 234, 0.08)' } : {}),
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
        className="relative z-[2] text-[10px] text-gray-400"
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

      {showLiveFx ? (
        <GridMarketCellLiveFx
          asset={asset}
          endDate={endDate}
          strikeStr={strikeStr}
          yesMidProb={yesMidProb}
          adjVol={adjVol}
          bsTimeOffsetHours={bsTimeOffsetHours}
          isHit={isHit}
          isClosed={isClosed}
          isPast={isPast}
          skipDelta={skipDelta}
          variant={variant}
          yesPosSize={yesPosSize}
          noPosSize={noPosSize}
        />
      ) : null}

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
          className="absolute bottom-0 left-0 w-full"
          style={{ height: `${concPct}%`, backgroundColor: concColor }}
        />
      </div>
      <div
        className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none z-[1] flex"
        title={`Winners $ (USDC bias, top 30%): ${(wbUsdc * 100).toFixed(0)}%`}
      >
        <div className="bg-cyan-400/75 h-full shrink-0" style={{ width: `${wbPct}%` }} />
        <div className="bg-pink-400/75 h-full flex-1 min-w-0" />
      </div>
      <div
        className="absolute bottom-[2px] left-0 right-0 h-[2px] pointer-events-none z-[1] flex"
        title={`Smart Money (proven wallets): ${(smsRaw * 100).toFixed(0)}%`}
      >
        <div className="bg-yellow-400/75 h-full shrink-0" style={{ width: `${smsPct}%` }} />
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
    a.cellPyClass !== b.cellPyClass ||
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
