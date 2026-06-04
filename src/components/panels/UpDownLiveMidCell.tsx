import { memo, useMemo } from 'react';
import type { Market } from '../../types';
import { bidAskLookupFromPair, useLiveBidAskPair } from '../../hooks/useLiveBidAskPair';
import { noOutcomeBidAsk, outcomeBestBidProb } from '../../lib/outcomeQuote';
import { MarketCellMidRow } from './MarketCellMidRow';

/** Live best-bid YES/NO cents from WS book (per-cell subscription). */
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
  const pair = useLiveBidAskPair(yesId, noId);
  const lookup = useMemo(
    () => bidAskLookupFromPair(yesId, noId, pair),
    [yesId, noId, pair.yes, pair.no],
  );
  const gamma = { bestBid: market.bestBid, bestAsk: market.bestAsk };
  const yesBid = outcomeBestBidProb(yesId, lookup, gamma);
  const noBook = noOutcomeBidAsk(yesId, noId, lookup, gamma);
  const noBid = outcomeBestBidProb(noId, lookup, { bestBid: noBook.bestBid, bestAsk: noBook.bestAsk });
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
