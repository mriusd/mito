import { memo, useMemo } from 'react';
import type { Market } from '../../types';
import { useBidAskMarketRow } from '../../hooks/useBidAskMarketRow';
import { noOutcomeBidAsk, outcomeBestBidProb } from '../../lib/outcomeQuote';
import { MarketCellMidRow } from './MarketCellMidRow';

const LIVE_ONLY = { liveOnly: true as const };

/** Live best-bid YES/NO cents from WS book — no stale Gamma fallback once WS row exists. */
export const UpDownLiveMidCell = memo(function UpDownLiveMidCell({
  market,
  className,
  onYesClick,
  onNoClick,
}: {
  market: Market;
  className?: string;
  onYesClick: () => void;
  onNoClick: () => void;
}) {
  const yesId = market.clobTokenIds?.[0] || '';
  const noId = market.clobTokenIds?.[1] || '';
  const yesRow = useBidAskMarketRow(yesId);
  const noRow = useBidAskMarketRow(noId);
  const lookup = useMemo(() => {
    const o: Record<string, Market> = {};
    if (yesId && yesRow) o[yesId] = yesRow;
    if (noId && noRow) o[noId] = noRow;
    return o;
  }, [yesId, noId, yesRow, noRow]);
  const gammaYes = yesRow ? undefined : { bestBid: market.bestBid, bestAsk: market.bestAsk };
  const yesBid = outcomeBestBidProb(yesId, lookup, gammaYes, yesRow ? LIVE_ONLY : undefined);
  const noBook = noOutcomeBidAsk(yesId, noId, lookup, gammaYes, yesRow || noRow ? LIVE_ONLY : undefined);
  const noBid = outcomeBestBidProb(
    noId,
    lookup,
    noRow ? undefined : { bestBid: noBook.bestBid, bestAsk: noBook.bestAsk },
    noRow ? LIVE_ONLY : undefined,
  );
  const yesStr = yesBid != null ? (yesBid * 100).toFixed(1) : '-';
  const noStr = noBid != null ? (noBid * 100).toFixed(1) : '-';

  return (
    <MarketCellMidRow
      className={className}
      left={
        <span className="text-green-400 cursor-pointer hover:underline" onClick={onYesClick}>
          {yesStr}
        </span>
      }
      right={
        <span className="text-red-400 cursor-pointer hover:underline" onClick={onNoClick}>
          {noStr}
        </span>
      }
    />
  );
});
