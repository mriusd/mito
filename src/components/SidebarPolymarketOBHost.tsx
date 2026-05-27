import { memo, useLayoutEffect, useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { Market, Position } from '../types';
import { usePolymarketOB, type LiveTrade } from '../hooks/usePolymarketOB';
import type { SidebarObAggStep } from '../lib/sidebarOrderbookAggregate';
import { sidebarObAggregateLevels } from '../lib/sidebarOrderbookAggregate';
import { orderbookLongShortDepth } from '../lib/orderbookBookImbalance';
import { readSavedObAggStep, LS_SIDEBAR_OB_AGG_STEP } from '../lib/sidebarObAggStep';
import { bumpSidebarTopOfBookDigest } from '../lib/sidebarTopOfBookStore';
import { setSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import { SidebarLiveOrderbookSection } from './SidebarLiveOrderbookSection';
import { useSidebarOrderHighlightSets } from '../lib/sidebarOrderHighlightStore';

type OBLevel = { price: string; size: string };

const OB_RAW_TOP_REF = 15;
const OB_DEEP_BOOK = 380;

export type SidebarPolymarketBookSnapshot = {
  displayBids: OBLevel[];
  displayAsks: OBLevel[];
  polymarketLiveTrades: LiveTrade[];
  obLoading: boolean;
};

type Props = {
  obTokenId: string | null;
  sidebarBookRef: React.MutableRefObject<SidebarPolymarketBookSnapshot | null>;
  orderbookSectionHeight: string;
  liveOrderbookExpanded: boolean;
  onToggleLiveOrderbookExpanded: () => void;
  isMarketExpired: boolean;
  isUpDownMarket: boolean;
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
  orderbookSectionHeight,
  liveOrderbookExpanded,
  onToggleLiveOrderbookExpanded,
  isMarketExpired,
  isUpDownMarket,
  selectedMarket,
  orderOutcome,
  positions,
  outcomeMarket,
  setOrderSide,
  setOrderPrice,
  setOrderAmount,
}: Props) {
  const { bidPrices: sidebarUserBidPrices, askPrices: sidebarUserAskPrices } = useSidebarOrderHighlightSets();
  const [obAggStep, setObAggStep] = useState<SidebarObAggStep>(() => readSavedObAggStep());
  const setObAggStepPersist = useCallback((step: SidebarObAggStep) => {
    setObAggStep(step);
    try {
      localStorage.setItem(LS_SIDEBAR_OB_AGG_STEP, step);
    } catch {
      /* ignore */
    }
  }, []);

  const bookLimit = OB_DEEP_BOOK;
  const yesTokenId = useMemo(() => {
    if (!obTokenId || !selectedMarket?.clobTokenIds?.[0]) return null;
    return selectedMarket.clobTokenIds[0] || null;
  }, [obTokenId, selectedMarket?.clobTokenIds]);
  const noTokenId = useMemo(() => {
    if (!obTokenId || !selectedMarket?.clobTokenIds?.[1]) return null;
    return selectedMarket.clobTokenIds[1] || null;
  }, [obTokenId, selectedMarket?.clobTokenIds]);

  const {
    bids: yesBids,
    asks: yesAsks,
    trades: yesTrades,
    loading: yesObLoading,
  } = usePolymarketOB(yesTokenId, bookLimit);
  const {
    bids: noBids,
    asks: noAsks,
    trades: noTrades,
    loading: noObLoading,
  } = usePolymarketOB(noTokenId, bookLimit);

  const activeObLoading = orderOutcome === 'YES' ? yesObLoading : noObLoading;
  const polymarketLiveTrades = orderOutcome === 'YES' ? yesTrades : noTrades;
  const obLoading = activeObLoading || yesObLoading || noObLoading;

  const obStaleBookRef = useRef<{ bids: OBLevel[]; asks: OBLevel[] }>({ bids: [], asks: [] });
  useLayoutEffect(() => {
    obStaleBookRef.current = { bids: [], asks: [] };
  }, [obTokenId]);
  useLayoutEffect(() => {
    if (!activeObLoading) {
      obStaleBookRef.current =
        orderOutcome === 'YES' ? { bids: yesBids, asks: yesAsks } : { bids: noBids, asks: noAsks };
    }
  }, [activeObLoading, orderOutcome, yesBids, yesAsks, noBids, noAsks]);

  const snapshotBids = activeObLoading ? obStaleBookRef.current.bids : orderOutcome === 'YES' ? yesBids : noBids;
  const snapshotAsks = activeObLoading ? obStaleBookRef.current.asks : orderOutcome === 'YES' ? yesAsks : noAsks;
  const yesSnapshotBids = yesObLoading ? [] : yesBids;
  const yesSnapshotAsks = yesObLoading ? [] : yesAsks;
  const noSnapshotBids = noObLoading ? [] : noBids;
  const noSnapshotAsks = noObLoading ? [] : noAsks;

  const { viewBids, viewAsks, refSnapshotBids, refSnapshotAsks } = useMemo(() => {
    const refBid = snapshotBids.slice(0, OB_RAW_TOP_REF);
    const refAsk = snapshotAsks.slice(0, OB_RAW_TOP_REF);
    if (obAggStep === '0.1') {
      return {
        viewBids: snapshotBids.slice(0, OB_RAW_TOP_REF),
        viewAsks: snapshotAsks.slice(0, OB_RAW_TOP_REF),
        refSnapshotBids: refBid,
        refSnapshotAsks: refAsk,
      };
    }
    const step = obAggStep === '1' ? '1' : '5';
    const bidCap = step === '1' ? 40 : 24;
    const askCap = step === '1' ? 40 : 24;
    return {
      viewBids: sidebarObAggregateLevels(snapshotBids, step, 'bid', bidCap),
      viewAsks: sidebarObAggregateLevels(snapshotAsks, step, 'ask', askCap),
      refSnapshotBids: refBid,
      refSnapshotAsks: refAsk,
    };
  }, [snapshotBids, snapshotAsks, obAggStep]);

  const prevTopSig = useRef<string>('');
  const { orderbookBookImbalance, longDepthUsd, shortDepthUsd } = useMemo(() => {
    const depth = orderbookLongShortDepth(
      yesSnapshotBids,
      yesSnapshotAsks,
      noSnapshotBids,
      noSnapshotAsks,
    );
    return {
      orderbookBookImbalance: depth.imbalance,
      longDepthUsd: depth.longUsd,
      shortDepthUsd: depth.shortUsd,
    };
  }, [yesSnapshotBids, yesSnapshotAsks, noSnapshotBids, noSnapshotAsks]);

  useEffect(() => {
    setSidebarPolymarketTape(polymarketLiveTrades);
  }, [polymarketLiveTrades]);

  useLayoutEffect(() => {
    sidebarBookRef.current = {
      displayBids: refSnapshotBids,
      displayAsks: refSnapshotAsks,
      polymarketLiveTrades,
      obLoading,
    };
  }, [sidebarBookRef, refSnapshotBids, refSnapshotAsks, polymarketLiveTrades, obLoading]);

  useLayoutEffect(() => {
    const firstAsk = snapshotAsks[0]?.price ?? '';
    const lastBid = snapshotBids.length ? snapshotBids[snapshotBids.length - 1]?.price ?? '' : '';
    const sig = `${firstAsk}|${lastBid}|${obLoading ? 1 : 0}`;
    if (sig !== prevTopSig.current) {
      prevTopSig.current = sig;
      bumpSidebarTopOfBookDigest();
    }
  }, [snapshotBids, snapshotAsks, obLoading]);

  return (
    <SidebarLiveOrderbookSection
      orderbookSectionHeight={orderbookSectionHeight}
      liveOrderbookExpanded={liveOrderbookExpanded}
      onToggleLiveOrderbookExpanded={onToggleLiveOrderbookExpanded}
      orderbookBookImbalance={orderbookBookImbalance}
      longDepthUsd={longDepthUsd}
      shortDepthUsd={shortDepthUsd}
      displayBids={viewBids}
      displayAsks={viewAsks}
      obAggStep={obAggStep}
      onObAggStepChange={setObAggStepPersist}
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
