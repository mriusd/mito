import { memo, useLayoutEffect, useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { Market, Position } from '../types';
import { usePolymarketOB, type LiveTrade } from '../hooks/usePolymarketOB';
import type { SidebarObAggStep } from '../lib/sidebarOrderbookAggregate';
import { sidebarObAggregateBook } from '../lib/sidebarOrderbookAggregate';
import { readSavedObAggStep, LS_SIDEBAR_OB_AGG_STEP } from '../lib/sidebarObAggStep';
import { bumpSidebarTopOfBookDigest } from '../lib/sidebarTopOfBookStore';
import { setSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import { SidebarLiveOrderbookSection } from './SidebarLiveOrderbookSection';
import { useSidebarOrderHighlightSets } from '../lib/sidebarOrderHighlightStore';
import { setSidebarYesObDepth, resetSidebarYesObDepth } from '../lib/sidebarYesObDepthStore';
import { outcomeMidCentsFromSidebarBook } from '../lib/sidebarYesMidFromBook';

type OBLevel = { price: string; size: string };

const OB_RAW_TOP_REF = 15;
const OB_DEEP_BOOK = 380;

export type SidebarPolymarketBookSnapshot = {
  displayBids: OBLevel[];
  displayAsks: OBLevel[];
  yesBids: OBLevel[];
  yesAsks: OBLevel[];
  noBids: OBLevel[];
  noAsks: OBLevel[];
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
  const obEnabled = obTokenId != null;
  const yesTokenId = useMemo(() => {
    if (!obEnabled || !selectedMarket?.clobTokenIds?.[0]) return null;
    return selectedMarket.clobTokenIds[0] || null;
  }, [obEnabled, selectedMarket?.id, selectedMarket?.clobTokenIds?.[0]]);
  const noTokenId = useMemo(() => {
    if (!obEnabled || !selectedMarket?.clobTokenIds?.[1]) return null;
    return selectedMarket.clobTokenIds[1] || null;
  }, [obEnabled, selectedMarket?.id, selectedMarket?.clobTokenIds?.[1]]);

  const {
    bids: yesBids,
    asks: yesAsks,
    trades: yesTrades,
    loading: yesObLoading,
    bidUsdTotal: yesBidUsdTotal,
    askUsdTotal: yesAskUsdTotal,
  } = usePolymarketOB(yesTokenId, bookLimit);
  const {
    bids: noBids,
    asks: noAsks,
    trades: noTrades,
    loading: noObLoading,
    bidUsdTotal: noBidUsdTotal,
    askUsdTotal: noAskUsdTotal,
  } = usePolymarketOB(noTokenId, bookLimit);

  const activeObLoading = orderOutcome === 'YES' ? yesObLoading : noObLoading;
  const polymarketLiveTrades = orderOutcome === 'YES' ? yesTrades : noTrades;

  const obStaleBookRef = useRef<{ bids: OBLevel[]; asks: OBLevel[] }>({ bids: [], asks: [] });
  const yesStaleBookRef = useRef<{ bids: OBLevel[]; asks: OBLevel[] }>({ bids: [], asks: [] });
  const noStaleBookRef = useRef<{ bids: OBLevel[]; asks: OBLevel[] }>({ bids: [], asks: [] });
  const yesUsdStaleRef = useRef({ bidUsdTotal: 0 });
  const noUsdStaleRef = useRef({ bidUsdTotal: 0 });
  const displayUsdStaleRef = useRef({ bidUsdTotal: 0, askUsdTotal: 0 });
  useLayoutEffect(() => {
    obStaleBookRef.current = { bids: [], asks: [] };
    yesStaleBookRef.current = { bids: [], asks: [] };
    noStaleBookRef.current = { bids: [], asks: [] };
    yesUsdStaleRef.current = { bidUsdTotal: 0 };
    noUsdStaleRef.current = { bidUsdTotal: 0 };
    displayUsdStaleRef.current = { bidUsdTotal: 0, askUsdTotal: 0 };
    resetSidebarYesObDepth();
  }, [selectedMarket?.id, obTokenId]);
  useLayoutEffect(() => {
    if (!activeObLoading) {
      obStaleBookRef.current =
        orderOutcome === 'YES' ? { bids: yesBids, asks: yesAsks } : { bids: noBids, asks: noAsks };
    }
  }, [activeObLoading, orderOutcome, yesBids, yesAsks, noBids, noAsks]);
  useLayoutEffect(() => {
    if (!yesObLoading) {
      yesStaleBookRef.current = { bids: yesBids, asks: yesAsks };
    }
  }, [yesObLoading, yesBids, yesAsks]);
  useLayoutEffect(() => {
    if (!noObLoading) {
      noStaleBookRef.current = { bids: noBids, asks: noAsks };
    }
  }, [noObLoading, noBids, noAsks]);
  useLayoutEffect(() => {
    if (!yesObLoading) {
      yesUsdStaleRef.current = { bidUsdTotal: yesBidUsdTotal };
    }
  }, [yesObLoading, yesBidUsdTotal]);
  useLayoutEffect(() => {
    if (!noObLoading) {
      noUsdStaleRef.current = { bidUsdTotal: noBidUsdTotal };
    }
  }, [noObLoading, noBidUsdTotal]);
  useLayoutEffect(() => {
    const loading = orderOutcome === 'YES' ? yesObLoading : noObLoading;
    if (!loading) {
      displayUsdStaleRef.current =
        orderOutcome === 'YES'
          ? { bidUsdTotal: yesBidUsdTotal, askUsdTotal: yesAskUsdTotal }
          : { bidUsdTotal: noBidUsdTotal, askUsdTotal: noAskUsdTotal };
    }
  }, [orderOutcome, yesObLoading, noObLoading, yesBidUsdTotal, yesAskUsdTotal, noBidUsdTotal, noAskUsdTotal]);

  const snapshotBids = activeObLoading ? obStaleBookRef.current.bids : orderOutcome === 'YES' ? yesBids : noBids;
  const snapshotAsks = activeObLoading ? obStaleBookRef.current.asks : orderOutcome === 'YES' ? yesAsks : noAsks;

  const { viewBids, viewAsks, refSnapshotBids, refSnapshotAsks, yesBarBidUsd, noBarBidUsd, displayBidFullUsd, displayAskFullUsd } =
    useMemo(() => {
      const refBid = snapshotBids.slice(0, OB_RAW_TOP_REF);
      const refAsk = snapshotAsks.slice(0, OB_RAW_TOP_REF);
      const yesBidForBar = yesObLoading ? yesUsdStaleRef.current.bidUsdTotal : yesBidUsdTotal;
      const noBidForBar = noObLoading ? noUsdStaleRef.current.bidUsdTotal : noBidUsdTotal;
      const displayUsd = (orderOutcome === 'YES' ? yesObLoading : noObLoading)
        ? displayUsdStaleRef.current
        : orderOutcome === 'YES'
          ? { bidUsdTotal: yesBidUsdTotal, askUsdTotal: yesAskUsdTotal }
          : { bidUsdTotal: noBidUsdTotal, askUsdTotal: noAskUsdTotal };

      const bidCap = obAggStep === '0.1' ? 50 : obAggStep === '1' ? 40 : 24;
      const askCap = bidCap;
      const { bids: viewBids, asks: viewAsks } = sidebarObAggregateBook(
        snapshotBids,
        snapshotAsks,
        obAggStep,
        bidCap,
      );
      return {
        viewBids,
        viewAsks,
        refSnapshotBids: refBid,
        refSnapshotAsks: refAsk,
        yesBarBidUsd: yesBidForBar,
        noBarBidUsd: noBidForBar,
        displayBidFullUsd: displayUsd.bidUsdTotal,
        displayAskFullUsd: displayUsd.askUsdTotal,
      };
    }, [
      snapshotBids,
      snapshotAsks,
      obAggStep,
      orderOutcome,
      yesObLoading,
      noObLoading,
      yesBidUsdTotal,
      yesAskUsdTotal,
      noBidUsdTotal,
      noAskUsdTotal,
    ]);

  const obLoading = activeObLoading && viewBids.length === 0 && viewAsks.length === 0;

  // Mid from raw CLOB top-of-book — never from grouped viewBids/viewAsks (1¢/5¢ buckets).
  const midCents = useMemo(
    () => outcomeMidCentsFromSidebarBook(snapshotBids, snapshotAsks),
    [snapshotBids, snapshotAsks],
  );

  const prevTopSig = useRef<string>('');

  useLayoutEffect(() => {
    setSidebarYesObDepth({ yesBidUsd: yesBarBidUsd, noBidUsd: noBarBidUsd });
  }, [yesBarBidUsd, noBarBidUsd]);

  useEffect(() => {
    setSidebarPolymarketTape(polymarketLiveTrades);
  }, [polymarketLiveTrades]);

  const yesRefBids = (yesObLoading ? yesStaleBookRef.current.bids : yesBids).slice(0, OB_RAW_TOP_REF);
  const yesRefAsks = (yesObLoading ? yesStaleBookRef.current.asks : yesAsks).slice(0, OB_RAW_TOP_REF);
  const noRefBids = (noObLoading ? noStaleBookRef.current.bids : noBids).slice(0, OB_RAW_TOP_REF);
  const noRefAsks = (noObLoading ? noStaleBookRef.current.asks : noAsks).slice(0, OB_RAW_TOP_REF);

  useLayoutEffect(() => {
    sidebarBookRef.current = {
      displayBids: refSnapshotBids,
      displayAsks: refSnapshotAsks,
      yesBids: yesRefBids,
      yesAsks: yesRefAsks,
      noBids: noRefBids,
      noAsks: noRefAsks,
      polymarketLiveTrades,
      obLoading,
    };
  }, [
    sidebarBookRef,
    refSnapshotBids,
    refSnapshotAsks,
    yesRefBids,
    yesRefAsks,
    noRefBids,
    noRefAsks,
    polymarketLiveTrades,
    obLoading,
  ]);

  useLayoutEffect(() => {
    const yesBid = yesRefBids[0]?.price ?? '';
    const noBid = noRefBids[0]?.price ?? '';
    const dispAsk = snapshotAsks[0]?.price ?? '';
    const dispBid = snapshotBids[0]?.price ?? '';
    const sig = `${orderOutcome}|${yesBid}|${noBid}|${dispBid}|${dispAsk}|${obLoading ? 1 : 0}`;
    if (sig !== prevTopSig.current) {
      prevTopSig.current = sig;
      bumpSidebarTopOfBookDigest();
    }
  }, [orderOutcome, yesRefBids, noRefBids, snapshotBids, snapshotAsks, obLoading]);

  return (
    <SidebarLiveOrderbookSection
      orderbookSectionHeight={orderbookSectionHeight}
      liveOrderbookExpanded={liveOrderbookExpanded}
      onToggleLiveOrderbookExpanded={onToggleLiveOrderbookExpanded}
      yesBidUsd={yesBarBidUsd}
      noBidUsd={noBarBidUsd}
      displayBidFullUsd={displayBidFullUsd}
      displayAskFullUsd={displayAskFullUsd}
      displayBids={viewBids}
      displayAsks={viewAsks}
      midCents={midCents}
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
