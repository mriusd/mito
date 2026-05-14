import { memo, useLayoutEffect, useMemo, useRef, useEffect, useState, useCallback } from 'react';
import type { Market, Position } from '../types';
import { usePolymarketOB, type LiveTrade } from '../hooks/usePolymarketOB';
import type { SidebarObAggStep } from '../lib/sidebarOrderbookAggregate';
import { sidebarObAggregateLevels } from '../lib/sidebarOrderbookAggregate';
import { SidebarLiveOrderbookSection } from './SidebarLiveOrderbookSection';

type OBLevel = { price: string; size: string };

const LS_SIDEBAR_OB_AGG_STEP = 'polybot_sidebar_ob_agg_step';
const OB_RAW_TOP_REF = 15;
const OB_DEEP_BOOK = 380;

function readSavedObAggStep(): SidebarObAggStep {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_SIDEBAR_OB_AGG_STEP) : null;
    if (v === '0.1' || v === '1' || v === '5') return v;
  } catch {
    /* ignore */
  }
  return '0.1';
}

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
  const [obAggStep, setObAggStep] = useState<SidebarObAggStep>(() => readSavedObAggStep());
  const setObAggStepPersist = useCallback((step: SidebarObAggStep) => {
    setObAggStep(step);
    try {
      localStorage.setItem(LS_SIDEBAR_OB_AGG_STEP, step);
    } catch {
      /* ignore */
    }
  }, []);

  const bookLimit = obAggStep === '0.1' ? OB_RAW_TOP_REF : OB_DEEP_BOOK;
  const { bids, asks, trades: polymarketLiveTrades, loading: obLoading } = usePolymarketOB(obTokenId, bookLimit);

  const obStaleBookRef = useRef<{ bids: OBLevel[]; asks: OBLevel[] }>({ bids: [], asks: [] });
  useLayoutEffect(() => {
    obStaleBookRef.current = { bids: [], asks: [] };
  }, [obTokenId]);
  useLayoutEffect(() => {
    if (!obLoading) {
      obStaleBookRef.current = { bids, asks };
    }
  }, [obLoading, bids, asks]);

  const snapshotBids = obLoading ? obStaleBookRef.current.bids : bids;
  const snapshotAsks = obLoading ? obStaleBookRef.current.asks : asks;

  const { viewBids, viewAsks, refSnapshotBids, refSnapshotAsks } = useMemo(() => {
    const refBid = snapshotBids.slice(0, OB_RAW_TOP_REF);
    const refAsk = snapshotAsks.slice(0, OB_RAW_TOP_REF);
    if (obAggStep === '0.1') {
      return {
        viewBids: snapshotBids,
        viewAsks: snapshotAsks,
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
  const orderbookBookImbalance = useMemo(() => {
    const bidTotal = snapshotBids.reduce((s, l) => {
      const pCents = parseFloat(l.price) * 100;
      if (!Number.isFinite(pCents) || pCents < 5 || pCents > 95) return s;
      return s + parseFloat(l.size);
    }, 0);
    const askTotal = snapshotAsks.reduce((s, l) => {
      const pCents = parseFloat(l.price) * 100;
      if (!Number.isFinite(pCents) || pCents < 5 || pCents > 95) return s;
      return s + parseFloat(l.size);
    }, 0);
    const bookDenom = bidTotal + askTotal;
    return bookDenom > 0 ? (bidTotal - askTotal) / bookDenom : 0;
  }, [snapshotBids, snapshotAsks]);

  useEffect(() => {
    onPolymarketTrades(polymarketLiveTrades);
  }, [polymarketLiveTrades, onPolymarketTrades]);

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
      onTopOfBookDigestBump();
    }
  }, [snapshotBids, snapshotAsks, obLoading, onTopOfBookDigestBump]);

  return (
    <SidebarLiveOrderbookSection
      orderbookSectionHeight={orderbookSectionHeight}
      liveOrderbookExpanded={liveOrderbookExpanded}
      onToggleLiveOrderbookExpanded={onToggleLiveOrderbookExpanded}
      orderbookBookImbalance={orderbookBookImbalance}
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
