import { memo, useLayoutEffect, useMemo, useRef, useEffect } from 'react';
import type { Market, Position } from '../types';
import { usePolymarketOB, type LiveTrade } from '../hooks/usePolymarketOB';
import { SidebarLiveOrderbookSection } from './SidebarLiveOrderbookSection';

type OBLevel = { price: string; size: string };

export type SidebarPolymarketBookSnapshot = {
  displayBids: OBLevel[];
  displayAsks: OBLevel[];
  /** YES token legs only — stable when sidebar outcome toggles. */
  yesDisplayBids: OBLevel[];
  yesDisplayAsks: OBLevel[];
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
  const yesTid = useMemo(() => (selectedMarket?.clobTokenIds?.[0] || '').trim() || null, [selectedMarket?.clobTokenIds]);

  const needSeparateOutcomeBook = !!(obTokenId && yesTid && obTokenId !== yesTid);

  const yesWs = usePolymarketOB(yesTid);
  const outcomeWs = usePolymarketOB(needSeparateOutcomeBook ? obTokenId : null);

  const displayWs = needSeparateOutcomeBook ? outcomeWs : yesWs;
  const polymarketLiveTrades = displayWs.trades;

  const displayStaleBookRef = useRef<{ bids: OBLevel[]; asks: OBLevel[] }>({ bids: [], asks: [] });
  useLayoutEffect(() => {
    displayStaleBookRef.current = { bids: [], asks: [] };
  }, [obTokenId]);
  useLayoutEffect(() => {
    if (!displayWs.loading) {
      displayStaleBookRef.current = { bids: displayWs.bids, asks: displayWs.asks };
    }
  }, [displayWs.loading, displayWs.bids, displayWs.asks]);
  const displayBids = displayWs.loading ? displayStaleBookRef.current.bids : displayWs.bids;
  const displayAsks = displayWs.loading ? displayStaleBookRef.current.asks : displayWs.asks;

  const yesStaleBookRef = useRef<{ bids: OBLevel[]; asks: OBLevel[] }>({ bids: [], asks: [] });
  useLayoutEffect(() => {
    yesStaleBookRef.current = { bids: [], asks: [] };
  }, [yesTid]);
  useLayoutEffect(() => {
    if (!yesWs.loading) {
      yesStaleBookRef.current = { bids: yesWs.bids, asks: yesWs.asks };
    }
  }, [yesWs.loading, yesWs.bids, yesWs.asks]);
  const yesDisplayBids = yesWs.loading ? yesStaleBookRef.current.bids : yesWs.bids;
  const yesDisplayAsks = yesWs.loading ? yesStaleBookRef.current.asks : yesWs.asks;

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
      yesDisplayBids,
      yesDisplayAsks,
      polymarketLiveTrades,
      obLoading: displayWs.loading,
    };
  }, [sidebarBookRef, displayBids, displayAsks, yesDisplayBids, yesDisplayAsks, polymarketLiveTrades, displayWs.loading]);

  useLayoutEffect(() => {
    const firstAsk = displayAsks[0]?.price ?? '';
    const lastBid = displayBids.length ? displayBids[displayBids.length - 1]?.price ?? '' : '';
    const firstAskYes = yesDisplayAsks[0]?.price ?? '';
    const lastBidYes = yesDisplayBids.length ? yesDisplayBids[yesDisplayBids.length - 1]?.price ?? '' : '';
    const sig = `${firstAsk}|${lastBid}|${firstAskYes}|${lastBidYes}|${displayWs.loading ? 1 : 0}|${yesWs.loading ? 1 : 0}`;
    if (sig !== prevTopSig.current) {
      prevTopSig.current = sig;
      onTopOfBookDigestBump();
    }
  }, [
    displayBids,
    displayAsks,
    yesDisplayBids,
    yesDisplayAsks,
    displayWs.loading,
    yesWs.loading,
    onTopOfBookDigestBump,
  ]);

  return (
    <SidebarLiveOrderbookSection
      orderbookSectionHeight={orderbookSectionHeight}
      liveOrderbookExpanded={liveOrderbookExpanded}
      onToggleLiveOrderbookExpanded={onToggleLiveOrderbookExpanded}
      orderbookBookImbalance={orderbookBookImbalance}
      displayBids={displayBids}
      displayAsks={displayAsks}
      obLoading={displayWs.loading}
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
