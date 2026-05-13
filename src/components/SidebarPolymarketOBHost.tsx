import { memo, useLayoutEffect, useMemo, useRef, useEffect } from 'react';
import type { Market, Position } from '../types';
import { usePolymarketOB, type LiveTrade } from '../hooks/usePolymarketOB';
import { SidebarLiveOrderbookSection } from './SidebarLiveOrderbookSection';

type OBLevel = { price: string; size: string };

export type SidebarPolymarketBookSnapshot = {
  displayBids: OBLevel[];
  displayAsks: OBLevel[];
  polymarketLiveTrades: LiveTrade[];
  obLoading: boolean;
};

type Props = {
  obTokenId: string | null;
  sidebarBookRef: React.MutableRefObject<SidebarPolymarketBookSnapshot | null>;
  /** Bump parent state when top-of-book (summary / strip) inputs change — not on every intra-book RAF. */
  onTopOfBookDigestBump: () => void;
  onPolymarketTrades: (trades: LiveTrade[]) => void;
  orderbookSectionHeight: string;
  liveOrderbookExpanded: boolean;
  onToggleLiveOrderbookExpanded: () => void;
  isMarketExpired: boolean;
  isUpDownMarket: boolean;
  sidebarUserBidPrices: Set<string>;
  sidebarUserAskPrices: Set<string>;
  selectedMarket: Market | null;
  orderOutcome: 'YES' | 'NO';
  positions: Position[];
  outcomeMarket: Market | null;
  setOrderSide: (s: 'BUY' | 'SELL') => void;
  setOrderPrice: (p: string) => void;
  setOrderAmount: (a: string) => void;
};

export const SidebarPolymarketOBHost = memo(function SidebarPolymarketOBHost({
  obTokenId,
  sidebarBookRef,
  onTopOfBookDigestBump,
  onPolymarketTrades,
  orderbookSectionHeight,
  liveOrderbookExpanded,
  onToggleLiveOrderbookExpanded,
  isMarketExpired,
  isUpDownMarket,
  sidebarUserBidPrices,
  sidebarUserAskPrices,
  selectedMarket,
  orderOutcome,
  positions,
  outcomeMarket,
  setOrderSide,
  setOrderPrice,
  setOrderAmount,
}: Props) {
  const { bids, asks, trades: polymarketLiveTrades, loading: obLoading } = usePolymarketOB(obTokenId);

  const obStaleBookRef = useRef<{ bids: OBLevel[]; asks: OBLevel[] }>({ bids: [], asks: [] });
  useLayoutEffect(() => {
    obStaleBookRef.current = { bids: [], asks: [] };
  }, [obTokenId]);
  useLayoutEffect(() => {
    if (!obLoading) {
      obStaleBookRef.current = { bids, asks };
    }
  }, [obLoading, bids, asks]);
  const displayBids = obLoading ? obStaleBookRef.current.bids : bids;
  const displayAsks = obLoading ? obStaleBookRef.current.asks : asks;

  const prevTopSig = useRef<string>('');
  const orderbookBookImbalance = useMemo(() => {
    const bidTotal = displayBids.reduce((s, l) => {
      const pCents = parseFloat(l.price) * 100;
      if (!Number.isFinite(pCents) || pCents < 5 || pCents > 95) return s;
      return s + parseFloat(l.size);
    }, 0);
    const askTotal = displayAsks.reduce((s, l) => {
      const pCents = parseFloat(l.price) * 100;
      if (!Number.isFinite(pCents) || pCents < 5 || pCents > 95) return s;
      return s + parseFloat(l.size);
    }, 0);
    const bookDenom = bidTotal + askTotal;
    return bookDenom > 0 ? (bidTotal - askTotal) / bookDenom : 0;
  }, [displayBids, displayAsks]);

  useEffect(() => {
    onPolymarketTrades(polymarketLiveTrades);
  }, [polymarketLiveTrades, onPolymarketTrades]);

  useLayoutEffect(() => {
    sidebarBookRef.current = {
      displayBids,
      displayAsks,
      polymarketLiveTrades,
      obLoading,
    };
  }, [sidebarBookRef, displayBids, displayAsks, polymarketLiveTrades, obLoading]);

  useLayoutEffect(() => {
    const firstAsk = displayAsks[0]?.price ?? '';
    const lastBid = displayBids.length ? displayBids[displayBids.length - 1]?.price ?? '' : '';
    const sig = `${firstAsk}|${lastBid}|${obLoading ? 1 : 0}`;
    if (sig !== prevTopSig.current) {
      prevTopSig.current = sig;
      onTopOfBookDigestBump();
    }
  }, [displayBids, displayAsks, obLoading, onTopOfBookDigestBump]);

  return (
    <SidebarLiveOrderbookSection
      orderbookSectionHeight={orderbookSectionHeight}
      liveOrderbookExpanded={liveOrderbookExpanded}
      onToggleLiveOrderbookExpanded={onToggleLiveOrderbookExpanded}
      orderbookBookImbalance={orderbookBookImbalance}
      displayBids={displayBids}
      displayAsks={displayAsks}
      obLoading={obLoading}
      isMarketExpired={isMarketExpired}
      isUpDownMarket={isUpDownMarket}
      sidebarUserBidPrices={sidebarUserBidPrices}
      sidebarUserAskPrices={sidebarUserAskPrices}
      selectedMarket={selectedMarket}
      orderOutcome={orderOutcome}
      positions={positions}
      outcomeMarket={outcomeMarket}
      setOrderSide={setOrderSide}
      setOrderPrice={setOrderPrice}
      setOrderAmount={setOrderAmount}
    />
  );
});
