import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import type { AssetSymbol, Market } from '../../types';
import { placeOrder } from '../../api';
import { useAppStore } from '../../stores/appStore';
import { usePolymarketOB } from '../../hooks/usePolymarketOB';
import { useTradingWalletAddress } from '../../hooks/useTradingWalletAddress';
import { pickLiveUpDownMarketInTfBucket, resolvedBinaryOutcomeLabel } from '../../utils/format';
import { isMarketExpired } from '../../lib/marketExpiry';
import { triggerWalletRefresh } from '../../lib/clobClient';
import type { SidebarObAggStep } from '../../lib/sidebarOrderbookAggregate';
import { sidebarObAggregateLevels } from '../../lib/sidebarOrderbookAggregate';
import { readSavedObAggStep, LS_SIDEBAR_OB_AGG_STEP } from '../../lib/sidebarObAggStep';
import { SidebarOrderbookBookGrid, type SidebarObLevel } from '../SidebarOrderbookBookGrid';
import { SidebarDataSourceBadge } from '../SidebarDataSourceBadge';
import { showToast } from '../../utils/toast';

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;

type PairAsset = (typeof ASSETS)[number];
type PairTimeframe = (typeof TIMEFRAMES)[number];
type PairLeg = 'UP' | 'DOWN';
type PairSlot = 'left' | 'right';

const PAIR_LIMIT_ASK_OFFSET_CENTS = 10;
const PAIR_LIMIT_MAX_CENTS = 99;
const CLOB_MIN_EXPIRY_SEC = 90;

const ASSET_COLORS: Record<PairAsset, string> = {
  BTC: 'text-orange-400',
  ETH: 'text-blue-400',
  SOL: 'text-purple-400',
  XRP: 'text-cyan-400',
};

const EMPTY_PRICE_SET = new Set<string>();
const OB_DEEP_BOOK = 380;

function pairAskColorClass(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return 'text-gray-400';
  if (cents > 100) return 'text-red-400';
  if (cents >= 95) return 'text-yellow-400';
  return 'text-green-400';
}

function readStoredPairAsset(panelId: string, key: PairSlot, fallback: PairAsset): PairAsset {
  try {
    const saved = localStorage.getItem(`polybot-pair-trading-${key}-${panelId}`);
    return ASSETS.includes(saved as PairAsset) ? (saved as PairAsset) : fallback;
  } catch {
    return fallback;
  }
}

function readStoredPairTf(panelId: string): PairTimeframe {
  try {
    const saved = localStorage.getItem(`polybot-pair-trading-tf-${panelId}`);
    return TIMEFRAMES.includes(saved as PairTimeframe) ? (saved as PairTimeframe) : '5m';
  } catch {
    return '5m';
  }
}

function readStoredUpSlot(panelId: string): PairSlot {
  try {
    const saved = localStorage.getItem(`polybot-pair-trading-up-slot-${panelId}`);
    return saved === 'right' ? 'right' : 'left';
  } catch {
    return 'left';
  }
}

function orderNotionalUsd(priceDecimal: number, size: number): number {
  if (!Number.isFinite(priceDecimal) || !Number.isFinite(size) || size <= 0 || priceDecimal <= 0) return 0;
  return priceDecimal * size;
}

function maxOrderUsdViolationMessage(maxUsd: number, valueUsd: number): string | null {
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) return null;
  if (!Number.isFinite(valueUsd) || valueUsd <= maxUsd) return null;
  const lim =
    Number.isInteger(maxUsd) || Math.abs(maxUsd - Math.round(maxUsd)) < 1e-9 ? String(Math.round(maxUsd)) : maxUsd.toFixed(2);
  return `Max order size ${lim} USD. To increase the limit go to settings menu in the header.`;
}

function computePairLimitExpiration(marketEndDate?: string): { expiration: number; invalidLead: boolean } {
  const nowSec = Math.floor(Date.now() / 1000);
  const endDate = String(marketEndDate || '').trim();
  if (!endDate) {
    return { expiration: nowSec + 86400, invalidLead: false };
  }
  const endTimeSec = Math.floor(new Date(endDate).getTime() / 1000);
  if (!Number.isFinite(endTimeSec)) {
    return { expiration: nowSec + 86400, invalidLead: false };
  }
  const leadSec = 60;
  const expiration = endTimeSec - leadSec;
  const invalidLead = endTimeSec - nowSec <= leadSec;
  if (expiration - nowSec < CLOB_MIN_EXPIRY_SEC) {
    return { expiration: 0, invalidLead };
  }
  return { expiration, invalidLead };
}

function bestAskDecimal(asks: SidebarObLevel[]): number | null {
  const px = parseFloat(String(asks[0]?.price ?? ''));
  return Number.isFinite(px) && px > 0 ? px : null;
}

function pairLimitFromBestAsk(bestAsk: number | null): { price: number; cents: number } | null {
  if (bestAsk == null || !Number.isFinite(bestAsk) || bestAsk <= 0) return null;
  const cents = Math.min(bestAsk * 100 + PAIR_LIMIT_ASK_OFFSET_CENTS, PAIR_LIMIT_MAX_CENTS);
  return { price: cents / 100, cents };
}

function fmtCents(cents: number): string {
  return `${cents.toFixed(1)}¢`;
}

function usePairLegOrderbook(market: Market | null, leg: PairLeg, obAggStep: SidebarObAggStep) {
  const yesTokenId = market?.clobTokenIds?.[0]?.trim() || null;
  const noTokenId = market?.clobTokenIds?.[1]?.trim() || null;
  const orderOutcome = leg === 'UP' ? 'YES' : 'NO';

  const {
    bids: yesBids,
    asks: yesAsks,
    loading: yesObLoading,
    bidUsdTotal: yesBidUsdTotal,
    askUsdTotal: yesAskUsdTotal,
  } = usePolymarketOB(yesTokenId, OB_DEEP_BOOK);
  const {
    bids: noBids,
    asks: noAsks,
    loading: noObLoading,
    bidUsdTotal: noBidUsdTotal,
    askUsdTotal: noAskUsdTotal,
  } = usePolymarketOB(noTokenId, OB_DEEP_BOOK);

  const activeObLoading = orderOutcome === 'YES' ? yesObLoading : noObLoading;
  const obStaleBookRef = useRef<{ bids: SidebarObLevel[]; asks: SidebarObLevel[] }>({ bids: [], asks: [] });
  const yesUsdStaleRef = useRef({ bidUsdTotal: 0 });
  const noUsdStaleRef = useRef({ bidUsdTotal: 0 });
  const displayUsdStaleRef = useRef({ bidUsdTotal: 0, askUsdTotal: 0 });

  useLayoutEffect(() => {
    obStaleBookRef.current = { bids: [], asks: [] };
    yesUsdStaleRef.current = { bidUsdTotal: 0 };
    noUsdStaleRef.current = { bidUsdTotal: 0 };
    displayUsdStaleRef.current = { bidUsdTotal: 0, askUsdTotal: 0 };
  }, [market?.id, leg]);

  useLayoutEffect(() => {
    if (!activeObLoading) {
      obStaleBookRef.current =
        orderOutcome === 'YES' ? { bids: yesBids, asks: yesAsks } : { bids: noBids, asks: noAsks };
    }
  }, [activeObLoading, orderOutcome, yesBids, yesAsks, noBids, noAsks]);

  useLayoutEffect(() => {
    if (!yesObLoading) yesUsdStaleRef.current = { bidUsdTotal: yesBidUsdTotal };
  }, [yesObLoading, yesBidUsdTotal]);
  useLayoutEffect(() => {
    if (!noObLoading) noUsdStaleRef.current = { bidUsdTotal: noBidUsdTotal };
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

  return useMemo(() => {
    const yesBidForBar = yesObLoading ? yesUsdStaleRef.current.bidUsdTotal : yesBidUsdTotal;
    const noBidForBar = noObLoading ? noUsdStaleRef.current.bidUsdTotal : noBidUsdTotal;
    const displayUsd = activeObLoading
      ? displayUsdStaleRef.current
      : orderOutcome === 'YES'
        ? { bidUsdTotal: yesBidUsdTotal, askUsdTotal: yesAskUsdTotal }
        : { bidUsdTotal: noBidUsdTotal, askUsdTotal: noAskUsdTotal };

    let viewBids = snapshotBids;
    let viewAsks = snapshotAsks;
    if (obAggStep !== '0.1') {
      const step = obAggStep === '1' ? '1' : '5';
      viewBids = sidebarObAggregateLevels(snapshotBids, step, 'bid', step === '1' ? 40 : 24);
      viewAsks = sidebarObAggregateLevels(snapshotAsks, step, 'ask', step === '1' ? 40 : 24);
    }

    const obLoading = activeObLoading && viewBids.length === 0 && viewAsks.length === 0;
    const rawAsks = orderOutcome === 'YES' ? yesAsks : noAsks;

    return {
      viewBids,
      viewAsks,
      yesBarBidUsd: yesBidForBar,
      noBarBidUsd: noBidForBar,
      displayBidFullUsd: displayUsd.bidUsdTotal,
      displayAskFullUsd: displayUsd.askUsdTotal,
      obLoading,
      bestAsk: bestAskDecimal(rawAsks),
      rawAsks,
    };
  }, [
    snapshotBids,
    snapshotAsks,
    obAggStep,
    orderOutcome,
    activeObLoading,
    yesObLoading,
    noObLoading,
    yesBidUsdTotal,
    yesAskUsdTotal,
    noBidUsdTotal,
    noAskUsdTotal,
    yesAsks,
    noAsks,
  ]);
}

type PairTradingOrderbookColumnProps = {
  asset: PairAsset;
  leg: PairLeg;
  market: Market | null;
  obAggStep: SidebarObAggStep;
  book: ReturnType<typeof usePairLegOrderbook>;
};

const PairTradingOrderbookColumn = memo(function PairTradingOrderbookColumn({
  asset,
  leg,
  market,
  obAggStep,
  book,
}: PairTradingOrderbookColumnProps) {
  const expired = isMarketExpired(market);
  const resolvedOutcomeLabel = useMemo(() => resolvedBinaryOutcomeLabel(market, true), [market]);

  const overlayPrimary = !market
    ? { text: 'No live market', className: 'text-gray-400' }
    : resolvedOutcomeLabel
      ? { text: `Outcome: ${resolvedOutcomeLabel}`, className: 'text-emerald-400 font-bold' }
      : expired
        ? { text: 'Market expired', className: 'text-red-400' }
        : book.obLoading
          ? { text: 'Loading orderbook...', className: 'text-gray-300' }
          : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded border border-gray-700/80 bg-gray-900/40">
      <div className="flex shrink-0 items-center gap-1 border-b border-gray-700/60 px-2 py-1">
        <span className={`text-[11px] font-bold ${ASSET_COLORS[asset]}`}>{asset}</span>
        <span
          className={`rounded px-1 py-0.5 text-[9px] font-bold ${
            leg === 'UP' ? 'bg-green-900/60 text-green-300' : 'bg-red-900/60 text-red-300'
          }`}
        >
          {leg}
        </span>
        <SidebarDataSourceBadge source="polymarket" />
        {book.bestAsk != null ? (
          <span className="ml-auto text-[9px] tabular-nums text-gray-400">ask {(book.bestAsk * 100).toFixed(1)}¢</span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ minHeight: 100 }}>
        <SidebarOrderbookBookGrid
          displayBids={book.viewBids}
          displayAsks={book.viewAsks}
          obAggStep={obAggStep}
          yesBidUsd={book.yesBarBidUsd}
          noBidUsd={book.noBarBidUsd}
          displayBidFullUsd={book.displayBidFullUsd}
          displayAskFullUsd={book.displayAskFullUsd}
          sidebarUserBidPrices={EMPTY_PRICE_SET}
          sidebarUserAskPrices={EMPTY_PRICE_SET}
          readOnly
          overlay={overlayPrimary}
        />
      </div>
    </div>
  );
});

function LegToggle({
  leg,
  onPick,
}: {
  leg: PairLeg;
  onPick: (leg: PairLeg) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-gray-600 divide-x divide-gray-600 bg-gray-900/90">
      {(['UP', 'DOWN'] as const).map((side) => (
        <button
          key={side}
          type="button"
          onClick={() => onPick(side)}
          className={`px-1.5 py-0.5 text-[9px] font-semibold transition ${
            leg === side
              ? side === 'UP'
                ? 'bg-green-800 text-green-100'
                : 'bg-red-800 text-red-100'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {side}
        </button>
      ))}
    </div>
  );
}

export function PairTradingPanel({ panelId }: { panelId: string }) {
  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const maxOrderSizeUsd = useAppStore((s) => s.maxOrderSizeUsd);
  const signingMode = useAppStore((s) => s.signingMode);
  const pkAddress = useAppStore((s) => s.pkAddress);
  const { isConnected } = useAccount();
  const tradingWallet = useTradingWalletAddress();

  const [timeframe, setTimeframe] = useState<PairTimeframe>(() => readStoredPairTf(panelId));
  const [leftAsset, setLeftAsset] = useState<PairAsset>(() => readStoredPairAsset(panelId, 'left', 'BTC'));
  const [rightAsset, setRightAsset] = useState<PairAsset>(() => readStoredPairAsset(panelId, 'right', 'ETH'));
  const [upSlot, setUpSlot] = useState<PairSlot>(() => readStoredUpSlot(panelId));
  const [obAggStep, setObAggStep] = useState<SidebarObAggStep>(() => readSavedObAggStep());
  const [orderAmount, setOrderAmount] = useState('');
  const [placing, setPlacing] = useState(false);

  const leftLeg: PairLeg = upSlot === 'left' ? 'UP' : 'DOWN';
  const rightLeg: PairLeg = upSlot === 'left' ? 'DOWN' : 'UP';

  const walletReady =
    !!tradingWallet && (signingMode === 'privateKey' ? !!pkAddress : isConnected);

  const setObAggStepPersist = useCallback((step: SidebarObAggStep) => {
    setObAggStep(step);
    try {
      localStorage.setItem(LS_SIDEBAR_OB_AGG_STEP, step);
    } catch {
      /* ignore */
    }
  }, []);

  const setUpSlotPersist = useCallback(
    (slot: PairSlot) => {
      setUpSlot(slot);
      localStorage.setItem(`polybot-pair-trading-up-slot-${panelId}`, slot);
    },
    [panelId],
  );

  const leftMarket = useMemo(
    () => pickLiveUpDownMarketInTfBucket(upOrDownMarkets[leftAsset as AssetSymbol]?.[timeframe]),
    [upOrDownMarkets, leftAsset, timeframe],
  );
  const rightMarket = useMemo(
    () => pickLiveUpDownMarketInTfBucket(upOrDownMarkets[rightAsset as AssetSymbol]?.[timeframe]),
    [upOrDownMarkets, rightAsset, timeframe],
  );

  const leftBook = usePairLegOrderbook(leftMarket, leftLeg, obAggStep);
  const rightBook = usePairLegOrderbook(rightMarket, rightLeg, obAggStep);

  const upBook = upSlot === 'left' ? leftBook : rightBook;
  const downBook = upSlot === 'left' ? rightBook : leftBook;
  const upMarket = upSlot === 'left' ? leftMarket : rightMarket;
  const downMarket = upSlot === 'left' ? rightMarket : leftMarket;
  const upAsset = upSlot === 'left' ? leftAsset : rightAsset;
  const downAsset = upSlot === 'left' ? rightAsset : leftAsset;

  const pairAskCents =
    upBook.bestAsk != null && downBook.bestAsk != null ? (upBook.bestAsk + downBook.bestAsk) * 100 : null;

  const upLimit = pairLimitFromBestAsk(upBook.bestAsk);
  const downLimit = pairLimitFromBestAsk(downBook.bestAsk);
  const pairLimitCents =
    upLimit != null && downLimit != null ? upLimit.cents + downLimit.cents : null;

  const shares = parseFloat(orderAmount);
  const estPairCostUsd =
    Number.isFinite(shares) && shares > 0 && upLimit != null && downLimit != null
      ? (upLimit.price + downLimit.price) * shares
      : null;

  const handlePlacePair = useCallback(async () => {
    if (!walletReady) {
      showToast('Connect wallet first', 'error');
      return;
    }
    if (leftAsset === rightAsset) {
      showToast('Pick two different assets', 'error');
      return;
    }
    if (!upMarket || !downMarket) {
      showToast('Missing live market for one or both legs', 'error');
      return;
    }
    if (isMarketExpired(upMarket) || isMarketExpired(downMarket)) {
      showToast('Market expired', 'error');
      return;
    }
    const upTokenId = upMarket.clobTokenIds?.[0]?.trim();
    const downTokenId = downMarket.clobTokenIds?.[1]?.trim();
    if (!upTokenId || !downTokenId) {
      showToast('Missing token ids', 'error');
      return;
    }
    if (!Number.isFinite(shares) || shares <= 0) {
      showToast('Enter amount (shares)', 'error');
      return;
    }

    const upLimitPx = pairLimitFromBestAsk(upBook.bestAsk);
    const downLimitPx = pairLimitFromBestAsk(downBook.bestAsk);
    if (!upLimitPx) {
      showToast(`${upAsset} UP: no ask in book`, 'error');
      return;
    }
    if (!downLimitPx) {
      showToast(`${downAsset} DOWN: no ask in book`, 'error');
      return;
    }

    const upExp = computePairLimitExpiration(upMarket.endDate);
    const downExp = computePairLimitExpiration(downMarket.endDate);
    if (upExp.invalidLead || downExp.invalidLead) {
      showToast('Lead time to expiration already passed for this market', 'error');
      return;
    }

    const upVusd = orderNotionalUsd(upLimitPx.price, shares);
    const upCap = maxOrderUsdViolationMessage(maxOrderSizeUsd, upVusd);
    if (upCap) {
      showToast(`${upAsset} UP: ${upCap}`, 'error');
      return;
    }
    const downVusd = orderNotionalUsd(downLimitPx.price, shares);
    const downCap = maxOrderUsdViolationMessage(maxOrderSizeUsd, downVusd);
    if (downCap) {
      showToast(`${downAsset} DOWN: ${downCap}`, 'error');
      return;
    }

    setPlacing(true);
    try {
      const upResult = await placeOrder({
        tokenId: upTokenId,
        side: 'BUY',
        price: upLimitPx.price,
        size: shares,
        expiration: upExp.expiration,
        orderInfo: `Pair BUY ${shares} UP ${upAsset} @ ${fmtCents(upLimitPx.cents)} (${timeframe})`,
      });
      if (!upResult.success) {
        showToast(upResult.error || `${upAsset} UP order failed`, 'error');
        return;
      }

      const downResult = await placeOrder({
        tokenId: downTokenId,
        side: 'BUY',
        price: downLimitPx.price,
        size: shares,
        expiration: downExp.expiration,
        orderInfo: `Pair BUY ${shares} DOWN ${downAsset} @ ${fmtCents(downLimitPx.cents)} (${timeframe})`,
      });
      if (!downResult.success) {
        showToast(downResult.error || `${downAsset} DOWN order failed (UP leg filled)`, 'error');
        triggerWalletRefresh();
        return;
      }

      showToast('Pair limit orders placed', 'success');
      triggerWalletRefresh();
    } catch {
      showToast('Pair order failed', 'error');
    } finally {
      setPlacing(false);
    }
  }, [
    walletReady,
    leftAsset,
    rightAsset,
    upMarket,
    downMarket,
    shares,
    maxOrderSizeUsd,
    upAsset,
    downAsset,
    timeframe,
    upBook.bestAsk,
    downBook.bestAsk,
  ]);

  const selectClass =
    'rounded border border-gray-600 bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-gray-200 focus:outline-none';

  return (
    <div className="panel-wrapper flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-gray-800/50 p-3">
      <div className="panel-header mb-1.5 flex shrink-0 flex-wrap items-center gap-2 cursor-grab">
        <div className="text-[11px] font-bold text-emerald-400">Pair Trading</div>
        <div className="no-drag flex flex-wrap items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
          <label className="flex items-center gap-1 text-[9px] text-gray-500">
            TF
            <select
              className={selectClass}
              value={timeframe}
              onChange={(e) => {
                const next = e.target.value as PairTimeframe;
                setTimeframe(next);
                localStorage.setItem(`polybot-pair-trading-tf-${panelId}`, next);
              }}
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[9px] text-gray-500">
            Left
            <select
              className={selectClass}
              value={leftAsset}
              onChange={(e) => {
                const next = e.target.value as PairAsset;
                setLeftAsset(next);
                localStorage.setItem(`polybot-pair-trading-left-${panelId}`, next);
              }}
            >
              {ASSETS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <LegToggle leg={leftLeg} onPick={(leg) => setUpSlotPersist(leg === 'UP' ? 'left' : 'right')} />
          </label>
          <label className="flex items-center gap-1 text-[9px] text-gray-500">
            Right
            <select
              className={selectClass}
              value={rightAsset}
              onChange={(e) => {
                const next = e.target.value as PairAsset;
                setRightAsset(next);
                localStorage.setItem(`polybot-pair-trading-right-${panelId}`, next);
              }}
            >
              {ASSETS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <LegToggle leg={rightLeg} onPick={(leg) => setUpSlotPersist(leg === 'UP' ? 'right' : 'left')} />
          </label>
          <div
            className="inline-flex overflow-hidden rounded border border-gray-600 divide-x divide-gray-600 bg-gray-900/90"
            title="Bid/ask grouping"
          >
            {(
              [
                { step: '0.1' as const, label: '0.1¢' },
                { step: '1' as const, label: '1¢' },
                { step: '5' as const, label: '5¢' },
              ] as const
            ).map(({ step, label }) => (
              <button
                key={step}
                type="button"
                onClick={() => setObAggStepPersist(step)}
                className={`px-1.5 py-0.5 text-[9px] font-semibold tabular-nums transition ${
                  obAggStep === step ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        <PairTradingOrderbookColumn asset={leftAsset} leg={leftLeg} market={leftMarket} obAggStep={obAggStep} book={leftBook} />
        <PairTradingOrderbookColumn asset={rightAsset} leg={rightLeg} market={rightMarket} obAggStep={obAggStep} book={rightBook} />
      </div>

      <div className="no-drag mt-2 shrink-0 rounded border border-gray-700/80 bg-gray-900/50 p-2" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px]">
          <div className="text-gray-400">
            Pair ask:{' '}
            <span className={`font-bold tabular-nums ${pairAskColorClass(pairAskCents)}`}>
              {pairAskCents != null ? `${pairAskCents.toFixed(1)}¢` : '—'}
            </span>
            <span className="ml-1 text-gray-500">
              ({upAsset} UP {(upBook.bestAsk != null ? (upBook.bestAsk * 100).toFixed(1) : '—')}¢ + {downAsset} DOWN{' '}
              {(downBook.bestAsk != null ? (downBook.bestAsk * 100).toFixed(1) : '—')}¢)
            </span>
            <span className="ml-2 text-gray-500">
              Limit:{' '}
              <span className="tabular-nums text-gray-300">
                {pairLimitCents != null ? fmtCents(pairLimitCents) : '—'}
              </span>
              {upLimit != null && downLimit != null ? (
                <span className="ml-1">
                  ({upAsset} UP {fmtCents(upLimit.cents)} + {downAsset} DOWN {fmtCents(downLimit.cents)})
                </span>
              ) : null}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[120px] flex-1">
            <label className="mb-1 block text-[10px] text-gray-400">Amount (shares per leg)</label>
            <input
              type="number"
              value={orderAmount}
              onChange={(e) => setOrderAmount(e.target.value)}
              onWheel={(e) => e.preventDefault()}
              className="order-input no-spin h-[34px] w-full"
              placeholder="100"
              min={1}
              step={1}
            />
          </div>
          <div className="rounded bg-gray-800/80 px-2 py-1 text-[10px] text-gray-400">
            <div>Est. cost</div>
            <div className="font-bold tabular-nums text-red-300">
              {estPairCostUsd != null ? `$${estPairCostUsd.toFixed(2)}` : '—'}
            </div>
          </div>
          <button
            type="button"
            disabled={!walletReady || placing || leftAsset === rightAsset}
            onClick={() => void handlePlacePair()}
            className="h-[34px] shrink-0 rounded-lg bg-emerald-700 px-4 text-[11px] font-bold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {placing ? 'Placing…' : 'Place Pair'}
          </button>
        </div>
      </div>
    </div>
  );
}
