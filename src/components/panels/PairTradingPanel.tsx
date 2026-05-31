import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import type { AssetSymbol, Market, Position, Trade } from '../../types';
import { placeOrder } from '../../api';
import { useAppStore } from '../../stores/appStore';
import { usePolymarketOB } from '../../hooks/usePolymarketOB';
import { useExpiryNow } from '../../hooks/useExpiryNow';
import { useTradingWalletAddress } from '../../hooks/useTradingWalletAddress';
import { formatMarketCountdown } from '../../lib/marketCountdown';
import { pickLiveUpDownMarketInTfBucket, pickNextUpDownMarketInTfBucket, resolvedBinaryOutcomeLabel } from '../../utils/format';
import { isMarketExpired } from '../../lib/marketExpiry';
import { triggerMarketDataRefresh } from '../../lib/marketDataRefresh';
import { triggerWalletRefresh } from '../../lib/clobClient';
import { cancelExistingSellOrdersForToken } from '../../lib/cancelExistingSellOrdersForToken';
import { resolveLegPositionForToken, resolveFeesPaidForToken } from '../../lib/sidebarMyPositions';
import { useSidebarOnchainGridWalletPositions } from '../../lib/sidebarOnchainTradesStore';
import type { SidebarObAggStep } from '../../lib/sidebarOrderbookAggregate';
import { buildSidebarUserOrderHighlightSets, sidebarObAggregateLevels } from '../../lib/sidebarOrderbookAggregate';
import { SidebarOrderbookBookGrid, type SidebarObLevel } from '../SidebarOrderbookBookGrid';
import { SidebarDataSourceBadge } from '../SidebarDataSourceBadge';
import { showToast } from '../../utils/toast';

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;

type PairAsset = (typeof ASSETS)[number];
type PairTimeframe = (typeof TIMEFRAMES)[number];
type PairLeg = 'UP' | 'DOWN';
type PairSlot = 'left' | 'right';
type PairMarketSlot = 'current' | 'next';

const PAIR_LIMIT_MAX_CENTS = 99;
const PAIR_LIMIT_MIN_CENTS = 1;
const PAIR_LIMIT_DELTA_DEFAULT_CENTS = 10;
const PAIR_98C_SELL_PRICE = 0.98;
const PAIR_98C_SELL_CENTS = 98;
const CLOB_MIN_EXPIRY_SEC = 90;

const LS_ORDER_EXPIRY_UPDOWN = 'polymarket-order-expiry-updown';
const LS_ORDER_EXPIRY_UNIT_UPDOWN = 'polymarket-order-expiry-unit-updown';
const LS_ORDER_EXPIRY_LEGACY = 'polymarket-order-expiry';
const LS_ORDER_EXPIRY_UNIT_LEGACY = 'polymarket-order-expiry-unit';

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

function pairExitColorClass(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return 'text-gray-400';
  if (cents > 100) return 'text-green-400';
  if (cents > 95) return 'text-yellow-400';
  return 'text-red-400';
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

function readStoredPairMarketSlot(panelId: string): PairMarketSlot {
  try {
    const saved = localStorage.getItem(`polybot-pair-trading-market-slot-${panelId}`);
    return saved === 'next' ? 'next' : 'current';
  } catch {
    return 'current';
  }
}

function readStoredPairPriceDelta(panelId: string): number {
  try {
    const saved = localStorage.getItem(`polybot-pair-trading-price-delta-${panelId}`);
    const n = parseFloat(String(saved ?? ''));
    return Number.isFinite(n) && n >= 0 ? n : PAIR_LIMIT_DELTA_DEFAULT_CENTS;
  } catch {
    return PAIR_LIMIT_DELTA_DEFAULT_CENTS;
  }
}

function readStoredPairObAggStep(panelId: string): SidebarObAggStep {
  try {
    const saved = localStorage.getItem(`polybot-pair-trading-ob-agg-${panelId}`);
    if (saved === '0.1' || saved === '1' || saved === '5') return saved;
  } catch {
    /* ignore */
  }
  return '0.1';
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

function normalizeExpiryUnit(raw: string | null): 's' | 'm' | 'h' {
  const u = String(raw || 'm').trim().toLowerCase();
  if (u === 's' || u === 'h') return u;
  return 'm';
}

function getUpDownOrderExpiryLeadSeconds(): number {
  const value = localStorage.getItem(LS_ORDER_EXPIRY_UPDOWN) ?? localStorage.getItem(LS_ORDER_EXPIRY_LEGACY) ?? '180';
  const uRaw = localStorage.getItem(LS_ORDER_EXPIRY_UNIT_UPDOWN) ?? localStorage.getItem(LS_ORDER_EXPIRY_UNIT_LEGACY);
  const unit = normalizeExpiryUnit(uRaw);
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (unit === 's') return Math.floor(n);
  if (unit === 'h') return Math.floor(n * 3600);
  return Math.floor(n * 60);
}

function computePairLimitExpiration(marketEndDate?: string): { expiration: number; invalidLead: boolean } {
  const expLeadSec = getUpDownOrderExpiryLeadSeconds();
  const nowSec = Math.floor(Date.now() / 1000);
  const endDate = String(marketEndDate || '').trim();
  if (!endDate) {
    return { expiration: nowSec + 86400, invalidLead: false };
  }
  const endTimeSec = Math.floor(new Date(endDate).getTime() / 1000);
  if (!Number.isFinite(endTimeSec)) {
    return { expiration: nowSec + 86400, invalidLead: false };
  }
  if (expLeadSec <= 0) {
    return { expiration: 0, invalidLead: false };
  }
  const expiration = endTimeSec - expLeadSec;
  const invalidLead = endTimeSec - nowSec <= expLeadSec;
  if (expiration - nowSec < CLOB_MIN_EXPIRY_SEC) {
    return { expiration: 0, invalidLead };
  }
  return { expiration, invalidLead };
}

function bestAskDecimal(asks: SidebarObLevel[]): number | null {
  const px = parseFloat(String(asks[0]?.price ?? ''));
  return Number.isFinite(px) && px > 0 ? px : null;
}

type AskWalkResult = {
  avgPrice: number;
  avgCents: number;
  totalCostUsd: number;
  filledShares: number;
  complete: boolean;
};

type BidWalkResult = {
  avgPrice: number;
  avgCents: number;
  totalProceedsUsd: number;
  filledShares: number;
  complete: boolean;
};

function bestBidDecimal(bids: SidebarObLevel[]): number | null {
  const px = parseFloat(String(bids[0]?.price ?? ''));
  return Number.isFinite(px) && px > 0 ? px : null;
}

function walkAsksForShares(asks: SidebarObLevel[], shares: number): AskWalkResult | null {
  if (!Number.isFinite(shares) || shares <= 0 || asks.length === 0) return null;

  let remaining = shares;
  let costUsd = 0;
  let filled = 0;

  for (const level of asks) {
    const px = parseFloat(String(level.price));
    const sz = parseFloat(String(level.size));
    if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(sz) || sz <= 0) continue;
    const take = Math.min(remaining, sz);
    costUsd += take * px;
    filled += take;
    remaining -= take;
    if (remaining <= 1e-9) break;
  }

  if (filled <= 0) return null;
  const avgPrice = costUsd / filled;
  return {
    avgPrice,
    avgCents: avgPrice * 100,
    totalCostUsd: costUsd,
    filledShares: filled,
    complete: remaining <= 1e-6,
  };
}

function walkBidsForShares(bids: SidebarObLevel[], shares: number): BidWalkResult | null {
  if (!Number.isFinite(shares) || shares <= 0 || bids.length === 0) return null;

  let remaining = shares;
  let proceedsUsd = 0;
  let filled = 0;

  for (const level of bids) {
    const px = parseFloat(String(level.price));
    const sz = parseFloat(String(level.size));
    if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(sz) || sz <= 0) continue;
    const take = Math.min(remaining, sz);
    proceedsUsd += take * px;
    filled += take;
    remaining -= take;
    if (remaining <= 1e-9) break;
  }

  if (filled <= 0) return null;
  const avgPrice = proceedsUsd / filled;
  return {
    avgPrice,
    avgCents: avgPrice * 100,
    totalProceedsUsd: proceedsUsd,
    filledShares: filled,
    complete: remaining <= 1e-6,
  };
}

function pairLimitFromAskPrice(askPrice: number | null, offsetCents: number): { price: number; cents: number } | null {
  if (askPrice == null || !Number.isFinite(askPrice) || askPrice <= 0) return null;
  if (!Number.isFinite(offsetCents) || offsetCents < 0) return null;
  const cents = Math.min(askPrice * 100 + offsetCents, PAIR_LIMIT_MAX_CENTS);
  return { price: cents / 100, cents };
}

function pairLimitFromBidPrice(bidPrice: number | null, offsetCents: number): { price: number; cents: number } | null {
  if (bidPrice == null || !Number.isFinite(bidPrice) || bidPrice <= 0) return null;
  if (!Number.isFinite(offsetCents) || offsetCents < 0) return null;
  const cents = Math.max(bidPrice * 100 - offsetCents, PAIR_LIMIT_MIN_CENTS);
  return { price: cents / 100, cents };
}

function formatPnlUsd(pnlUsd: number): string {
  return `${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)}`;
}

function fmtCents(cents: number): string {
  return `${cents.toFixed(1)}¢`;
}

function expiryCountdownColor(text: string, remaining: number): string {
  if (text === 'Expired') return 'text-red-400';
  if (remaining < 60_000) return 'text-red-400';
  if (remaining > 300_000) return 'text-green-400';
  return 'text-yellow-400';
}

const PairTradingExpiryCountdown = memo(function PairTradingExpiryCountdown({
  upMarket,
  downMarket,
  upAsset,
  downAsset,
}: {
  upMarket: Market | null;
  downMarket: Market | null;
  upAsset: PairAsset;
  downAsset: PairAsset;
}) {
  const now = useExpiryNow();
  const upEnd = upMarket?.endDate?.trim() ?? '';
  const downEnd = downMarket?.endDate?.trim() ?? '';
  const sameEnd = upEnd !== '' && upEnd === downEnd;

  if (sameEnd) {
    const { text, remaining } = formatMarketCountdown(upEnd, now);
    if (!text) return null;
    return (
      <div
        className="no-drag ml-auto shrink-0 text-right leading-tight"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-[8px] text-gray-500">Expires</div>
        <div className={`text-[10px] font-semibold tabular-nums ${expiryCountdownColor(text, remaining)}`}>
          {text}
        </div>
      </div>
    );
  }

  const up = formatMarketCountdown(upEnd, now);
  const down = formatMarketCountdown(downEnd, now);
  if (!up.text && !down.text) return null;

  return (
    <div
      className="no-drag ml-auto shrink-0 text-right leading-tight"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="text-[8px] text-gray-500">Expires</div>
      <div className="flex flex-col items-end gap-0.5 text-[10px] font-semibold tabular-nums">
        {up.text ? (
          <div>
            <span className={`${ASSET_COLORS[upAsset]} mr-1`}>{upAsset}</span>
            <span className={expiryCountdownColor(up.text, up.remaining)}>{up.text}</span>
          </div>
        ) : null}
        {down.text ? (
          <div>
            <span className={`${ASSET_COLORS[downAsset]} mr-1`}>{downAsset}</span>
            <span className={expiryCountdownColor(down.text, down.remaining)}>{down.text}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
});

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
    const cap = obAggStep === '0.1' ? 50 : obAggStep === '1' ? 40 : 24;
    viewBids = sidebarObAggregateLevels(snapshotBids, obAggStep, 'bid', cap);
    viewAsks = sidebarObAggregateLevels(snapshotAsks, obAggStep, 'ask', cap);

    const obLoading = activeObLoading && viewBids.length === 0 && viewAsks.length === 0;
    const rawAsks = orderOutcome === 'YES' ? yesAsks : noAsks;
    const rawBids = orderOutcome === 'YES' ? yesBids : noBids;

    return {
      viewBids,
      viewAsks,
      yesBarBidUsd: yesBidForBar,
      noBarBidUsd: noBidForBar,
      displayBidFullUsd: displayUsd.bidUsdTotal,
      displayAskFullUsd: displayUsd.askUsdTotal,
      obLoading,
      bestAsk: bestAskDecimal(rawAsks),
      bestBid: bestBidDecimal(rawBids),
      rawAsks,
      rawBids,
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
    yesBids,
    noBids,
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
  const orders = useAppStore((s) => s.orders);
  const progOrderMap = useAppStore((s) => s.progOrderMap) as Record<string, number>;
  const expired = isMarketExpired(market);
  const resolvedOutcomeLabel = useMemo(() => resolvedBinaryOutcomeLabel(market, true), [market]);
  const viewOutcome = leg === 'UP' ? 'YES' : 'NO';
  const yesTokenId = market?.clobTokenIds?.[0]?.trim() ?? '';
  const noTokenId = market?.clobTokenIds?.[1]?.trim() ?? '';

  const { bidPrices: sidebarUserBidPrices, askPrices: sidebarUserAskPrices } = useMemo(() => {
    if (!yesTokenId && !noTokenId) {
      return { bidPrices: EMPTY_PRICE_SET, askPrices: EMPTY_PRICE_SET };
    }
    const filtered = orders.filter((o) => !progOrderMap[o.id]);
    return buildSidebarUserOrderHighlightSets(filtered, yesTokenId, noTokenId, viewOutcome);
  }, [orders, progOrderMap, yesTokenId, noTokenId, viewOutcome]);

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
          sidebarUserBidPrices={sidebarUserBidPrices}
          sidebarUserAskPrices={sidebarUserAskPrices}
          readOnly
          overlay={overlayPrimary}
        />
      </div>
    </div>
  );
});

type PairLegPositionRowData = {
  leg: PairLeg;
  asset: PairAsset;
  size: number;
  entryCents: number | null;
  costUsd: number | null;
  feesUsd: number | null;
  exitCents: number | null;
  exitUsd: number | null;
  pnlUsd: number | null;
  exitPartial: boolean;
};

function buildPairLegPositionRow(
  leg: PairLeg,
  asset: PairAsset,
  tokenId: string,
  book: ReturnType<typeof usePairLegOrderbook>,
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: { tokenId: string; size: number; avgPrice: number; feesPaid?: number }[],
  trades: Trade[],
): PairLegPositionRowData {
  const pos = tokenId
    ? resolveLegPositionForToken(tokenId, positions, liveTradesSource, onchainWsPositions)
    : null;
  if (!pos) {
    return {
      leg,
      asset,
      size: 0,
      entryCents: null,
      costUsd: null,
      feesUsd: null,
      exitCents: null,
      exitUsd: null,
      pnlUsd: null,
      exitPartial: false,
    };
  }

  const feesUsd = resolveFeesPaidForToken(tokenId, liveTradesSource, onchainWsPositions, trades);
  const feePart = feesUsd ?? 0;
  const baseCostUsd = pos.avgPrice > 0 ? pos.avgPrice * pos.size : 0;
  let costUsd: number | null = null;
  let entryCents: number | null = null;
  if (baseCostUsd > 0 || feePart > 0) {
    costUsd = baseCostUsd + feePart;
    if (pos.size > 0) {
      entryCents = (costUsd / pos.size) * 100;
    }
  }
  const bidWalk = walkBidsForShares(book.rawBids, pos.size);
  const exitCents =
    bidWalk?.avgCents ?? (book.bestBid != null ? book.bestBid * 100 : null);
  const exitUsd =
    bidWalk?.totalProceedsUsd ?? (book.bestBid != null ? book.bestBid * pos.size : null);
  const pnlUsd =
    costUsd != null && exitUsd != null ? exitUsd - costUsd : null;

  return {
    leg,
    asset,
    size: pos.size,
    entryCents,
    costUsd,
    feesUsd,
    exitCents,
    exitUsd,
    pnlUsd,
    exitPartial: bidWalk != null && !bidWalk.complete,
  };
}

function legTokenId(market: Market | null, leg: PairLeg): string {
  const idx = leg === 'UP' ? 0 : 1;
  return market?.clobTokenIds?.[idx]?.trim() ?? '';
}

const PAIR_POS_FIELDS = ['sz', 'ent', 'cost', 'fees', 'exit', 'PnL'] as const;
const PAIR_TOTAL_SECTION_W = 'w-[10rem]';

function pairPosFieldColorClass(field: (typeof PAIR_POS_FIELDS)[number]): string {
  switch (field) {
    case 'ent':
      return 'text-yellow-400';
    case 'cost':
      return 'text-gray-400';
    case 'fees':
      return 'text-red-400';
    case 'exit':
      return 'text-emerald-300';
    case 'PnL':
      return 'font-semibold';
    default:
      return 'text-gray-200';
  }
}

function pairLegPositionValues(row: PairLegPositionRowData): (string | JSX.Element)[] {
  const flat = row.size <= 0;
  const exitValue =
    flat || row.exitCents == null ? (
      '—'
    ) : (
      <>
        {fmtCents(row.exitCents)}
        {row.exitPartial ? <span className="text-red-400"> thin</span> : null}
      </>
    );
  const pnlValue =
    flat || row.pnlUsd == null ? (
      '—'
    ) : (
      <span className={row.pnlUsd >= 0 ? 'text-green-400' : 'text-red-400'}>
        {`${row.pnlUsd >= 0 ? '+' : ''}$${row.pnlUsd.toFixed(2)}`}
      </span>
    );

  return [
    flat ? '—' : row.size.toFixed(0),
    row.entryCents != null ? fmtCents(row.entryCents) : '—',
    row.costUsd != null ? `$${row.costUsd.toFixed(2)}` : '—',
    flat || row.feesUsd == null ? '—' : `$${row.feesUsd.toFixed(2)}`,
    exitValue,
    pnlValue,
  ];
}

function PairLegPositionTableRow({ row }: { row: PairLegPositionRowData }) {
  const values = pairLegPositionValues(row);
  return (
    <tr>
      <td className="whitespace-nowrap py-0.5 pr-2 text-left align-middle">
        <span className="inline-flex items-center gap-0.5 leading-none">
          <span className={`font-bold ${ASSET_COLORS[row.asset]}`}>{row.asset}</span>
          <span
            className={`rounded px-1 py-px text-[8px] font-bold ${
              row.leg === 'UP' ? 'bg-green-900/60 text-green-300' : 'bg-red-900/60 text-red-300'
            }`}
          >
            {row.leg}
          </span>
        </span>
      </td>
      {values.map((value, i) => (
        <td
          key={PAIR_POS_FIELDS[i]}
          className={`whitespace-nowrap px-1 py-0.5 text-right align-middle text-[9px] font-medium ${pairPosFieldColorClass(PAIR_POS_FIELDS[i])}`}
        >
          {value}
        </td>
      ))}
    </tr>
  );
}

function PairLegPositionsRow({
  left,
  right,
  totalEntryCents,
  totalExitCents,
  totalPnlUsd,
  onSell98c,
  onClose,
  selling98c,
  closing,
  sell98Disabled,
  closeDisabled,
}: {
  left: PairLegPositionRowData;
  right: PairLegPositionRowData;
  totalEntryCents: number | null;
  totalExitCents: number | null;
  totalPnlUsd: number | null;
  onSell98c: () => void;
  onClose: () => void;
  selling98c: boolean;
  closing: boolean;
  sell98Disabled: boolean;
  closeDisabled: boolean;
}) {
  return (
    <div className="mt-2 border-t border-gray-700/60 pt-1.5 text-[9px]">
      <div className="flex min-w-0 items-stretch gap-3">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <table className="min-w-full border-collapse tabular-nums">
            <colgroup>
              <col />
              {PAIR_POS_FIELDS.map((label) => (
                <col key={label} className="w-[3rem]" />
              ))}
            </colgroup>
            <thead>
              <tr className="text-[8px] text-gray-500">
                <th className="pb-0.5 pr-2 text-left align-bottom font-normal" scope="col" />
                {PAIR_POS_FIELDS.map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className={`px-1 pb-0.5 text-right align-bottom font-normal whitespace-nowrap ${pairPosFieldColorClass(label)}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <PairLegPositionTableRow row={left} />
              <PairLegPositionTableRow row={right} />
            </tbody>
          </table>
        </div>
        <div className={`flex ${PAIR_TOTAL_SECTION_W} shrink-0 flex-none flex-col gap-1.5 border-l border-gray-700/50 pl-3`}>
          <div className="grid w-full grid-cols-3 gap-0.5">
            <div className="flex min-w-0 flex-col items-end gap-0.5">
              <span className="text-[8px] text-gray-500">Entry</span>
              <span className="block w-full truncate text-right font-bold tabular-nums text-gray-200">
                {totalEntryCents != null ? fmtCents(totalEntryCents) : '—'}
              </span>
            </div>
            <div className="flex min-w-0 flex-col items-end gap-0.5">
              <span className="text-[8px] text-gray-500">Exit</span>
              <span className={`block w-full truncate text-right font-bold tabular-nums ${pairExitColorClass(totalExitCents)}`}>
                {totalExitCents != null ? fmtCents(totalExitCents) : '—'}
              </span>
            </div>
            <div className="flex min-w-0 flex-col items-end gap-0.5">
              <span className="text-[8px] text-gray-500">PnL</span>
              <span
                className={`block w-full truncate text-right font-bold tabular-nums ${
                  totalPnlUsd == null ? 'text-gray-400' : totalPnlUsd >= 0 ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {totalPnlUsd == null ? '—' : formatPnlUsd(totalPnlUsd)}
              </span>
            </div>
          </div>
          <div className="flex w-full gap-1">
            <button
              type="button"
              disabled={sell98Disabled}
              onClick={onSell98c}
              className="h-5 flex-1 rounded bg-amber-700 text-[9px] font-bold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {selling98c ? '98c…' : '98c'}
            </button>
            <button
              type="button"
              disabled={closeDisabled}
              onClick={onClose}
              className="h-5 flex-1 rounded bg-red-700 text-[9px] font-bold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {closing ? 'Closing…' : 'CLOSE'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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

function MarketSlotToggle({
  slot,
  onPick,
}: {
  slot: PairMarketSlot;
  onPick: (slot: PairMarketSlot) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-gray-600 divide-x divide-gray-600 bg-gray-900/90">
      {(['current', 'next'] as const).map((side) => (
        <button
          key={side}
          type="button"
          onClick={() => onPick(side)}
          className={`px-1.5 py-0.5 text-[9px] font-semibold capitalize transition ${
            slot === side ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
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
  const positions = useAppStore((s) => s.positions);
  const orders = useAppStore((s) => s.orders);
  const trades = useAppStore((s) => s.trades);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const signingMode = useAppStore((s) => s.signingMode);
  const pkAddress = useAppStore((s) => s.pkAddress);
  const onchainWsPositions = useSidebarOnchainGridWalletPositions();
  const { isConnected } = useAccount();
  const tradingWallet = useTradingWalletAddress();
  const expiryNow = useExpiryNow();
  const lastMarketRefreshAtRef = useRef(0);

  const [timeframe, setTimeframe] = useState<PairTimeframe>(() => readStoredPairTf(panelId));
  const [leftAsset, setLeftAsset] = useState<PairAsset>(() => readStoredPairAsset(panelId, 'left', 'BTC'));
  const [rightAsset, setRightAsset] = useState<PairAsset>(() => readStoredPairAsset(panelId, 'right', 'ETH'));
  const [upSlot, setUpSlot] = useState<PairSlot>(() => readStoredUpSlot(panelId));
  const [marketSlot, setMarketSlot] = useState<PairMarketSlot>(() => readStoredPairMarketSlot(panelId));
  const [priceDeltaCents, setPriceDeltaCents] = useState<number>(() => readStoredPairPriceDelta(panelId));
  const [priceDeltaInput, setPriceDeltaInput] = useState<string>(() => String(readStoredPairPriceDelta(panelId)));
  const [obAggStep, setObAggStep] = useState<SidebarObAggStep>(() => readStoredPairObAggStep(panelId));
  const [orderAmount, setOrderAmount] = useState('');
  const [placing, setPlacing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [selling98c, setSelling98c] = useState(false);

  const leftLeg: PairLeg = upSlot === 'left' ? 'UP' : 'DOWN';
  const rightLeg: PairLeg = upSlot === 'left' ? 'DOWN' : 'UP';

  const walletReady =
    !!tradingWallet && (signingMode === 'privateKey' ? !!pkAddress : isConnected);

  const setObAggStepPersist = useCallback((step: SidebarObAggStep) => {
    setObAggStep(step);
    try {
      localStorage.setItem(`polybot-pair-trading-ob-agg-${panelId}`, step);
    } catch {
      /* ignore */
    }
  }, [panelId]);

  const setUpSlotPersist = useCallback(
    (slot: PairSlot) => {
      setUpSlot(slot);
      localStorage.setItem(`polybot-pair-trading-up-slot-${panelId}`, slot);
    },
    [panelId],
  );

  const commitPriceDelta = useCallback(
    (raw: string) => {
      const n = parseFloat(raw.trim());
      if (!Number.isFinite(n) || n < 0) {
        setPriceDeltaInput(String(priceDeltaCents));
        return;
      }
      setPriceDeltaCents(n);
      setPriceDeltaInput(String(n));
      localStorage.setItem(`polybot-pair-trading-price-delta-${panelId}`, String(n));
    },
    [panelId, priceDeltaCents],
  );

  const setMarketSlotPersist = useCallback(
    (slot: PairMarketSlot) => {
      setMarketSlot(slot);
      localStorage.setItem(`polybot-pair-trading-market-slot-${panelId}`, slot);
    },
    [panelId],
  );

  const leftMarket = useMemo(() => {
    const bucket = upOrDownMarkets[leftAsset as AssetSymbol]?.[timeframe];
    return marketSlot === 'next'
      ? pickNextUpDownMarketInTfBucket(bucket, expiryNow)
      : pickLiveUpDownMarketInTfBucket(bucket, expiryNow);
  }, [upOrDownMarkets, leftAsset, timeframe, marketSlot, expiryNow]);
  const rightMarket = useMemo(() => {
    const bucket = upOrDownMarkets[rightAsset as AssetSymbol]?.[timeframe];
    return marketSlot === 'next'
      ? pickNextUpDownMarketInTfBucket(bucket, expiryNow)
      : pickLiveUpDownMarketInTfBucket(bucket, expiryNow);
  }, [upOrDownMarkets, rightAsset, timeframe, marketSlot, expiryNow]);

  useEffect(() => {
    if (marketSlot !== 'current') return;

    const needsRefresh = (asset: PairAsset) => {
      const bucket = upOrDownMarkets[asset as AssetSymbol]?.[timeframe];
      if (!bucket?.length) return false;
      return pickLiveUpDownMarketInTfBucket(bucket, expiryNow) == null;
    };

    if (!needsRefresh(leftAsset) && !needsRefresh(rightAsset)) return;

    const now = Date.now();
    if (now - lastMarketRefreshAtRef.current < 2000) return;
    lastMarketRefreshAtRef.current = now;
    triggerMarketDataRefresh();
  }, [expiryNow, marketSlot, leftAsset, rightAsset, timeframe, upOrDownMarkets]);

  const leftBook = usePairLegOrderbook(leftMarket, leftLeg, obAggStep);
  const rightBook = usePairLegOrderbook(rightMarket, rightLeg, obAggStep);

  const upBook = upSlot === 'left' ? leftBook : rightBook;
  const downBook = upSlot === 'left' ? rightBook : leftBook;
  const upMarket = upSlot === 'left' ? leftMarket : rightMarket;
  const downMarket = upSlot === 'left' ? rightMarket : leftMarket;
  const upAsset = upSlot === 'left' ? leftAsset : rightAsset;
  const downAsset = upSlot === 'left' ? rightAsset : leftAsset;

  const shares = parseFloat(orderAmount);
  const hasShareAmount = Number.isFinite(shares) && shares > 0;

  const upAskWalk = useMemo(
    () => (hasShareAmount ? walkAsksForShares(upBook.rawAsks, shares) : null),
    [hasShareAmount, shares, upBook.rawAsks],
  );
  const downAskWalk = useMemo(
    () => (hasShareAmount ? walkAsksForShares(downBook.rawAsks, shares) : null),
    [hasShareAmount, shares, downBook.rawAsks],
  );

  const pairTopAskCents =
    upBook.bestAsk != null && downBook.bestAsk != null ? (upBook.bestAsk + downBook.bestAsk) * 100 : null;

  const pairAskCents = useMemo(() => {
    if (hasShareAmount && upAskWalk && downAskWalk) {
      return upAskWalk.avgCents + downAskWalk.avgCents;
    }
    return pairTopAskCents;
  }, [hasShareAmount, upAskWalk, downAskWalk, pairTopAskCents]);

  const pairAskInsufficient =
    hasShareAmount && upAskWalk != null && downAskWalk != null && (!upAskWalk.complete || !downAskWalk.complete);

  const estPairCostUsd =
    hasShareAmount && pairAskCents != null ? (pairAskCents / 100) * shares : null;

  const upTokenId = upMarket?.clobTokenIds?.[0]?.trim() ?? '';
  const downTokenId = downMarket?.clobTokenIds?.[1]?.trim() ?? '';
  const leftTokenId = legTokenId(leftMarket, leftLeg);
  const rightTokenId = legTokenId(rightMarket, rightLeg);

  const leftPositionRow = useMemo(
    () =>
      buildPairLegPositionRow(
        leftLeg,
        leftAsset,
        leftTokenId,
        leftBook,
        positions,
        liveTradesSource,
        onchainWsPositions,
        trades,
      ),
    [leftLeg, leftAsset, leftTokenId, leftBook, positions, liveTradesSource, onchainWsPositions, trades],
  );
  const rightPositionRow = useMemo(
    () =>
      buildPairLegPositionRow(
        rightLeg,
        rightAsset,
        rightTokenId,
        rightBook,
        positions,
        liveTradesSource,
        onchainWsPositions,
        trades,
      ),
    [rightLeg, rightAsset, rightTokenId, rightBook, positions, liveTradesSource, onchainWsPositions, trades],
  );

  const totalEntryCents = useMemo(() => {
    const parts = [leftPositionRow.entryCents, rightPositionRow.entryCents].filter((v): v is number => v != null);
    if (parts.length === 0) return null;
    return parts.reduce((sum, v) => sum + v, 0);
  }, [leftPositionRow.entryCents, rightPositionRow.entryCents]);

  const totalExitCents = useMemo(() => {
    const parts = [leftPositionRow.exitCents, rightPositionRow.exitCents].filter((v): v is number => v != null);
    if (parts.length === 0) return null;
    return parts.reduce((sum, v) => sum + v, 0);
  }, [leftPositionRow.exitCents, rightPositionRow.exitCents]);

  const totalPnlUsd = useMemo(() => {
    const parts = [leftPositionRow.pnlUsd, rightPositionRow.pnlUsd].filter((v): v is number => v != null);
    if (parts.length === 0) return null;
    return parts.reduce((sum, v) => sum + v, 0);
  }, [leftPositionRow.pnlUsd, rightPositionRow.pnlUsd]);

  const hasOpenPosition = leftPositionRow.size > 0 || rightPositionRow.size > 0;

  const handleClosePair = useCallback(async () => {
    if (!walletReady) {
      showToast('Connect wallet first', 'error');
      return;
    }
    if (!hasOpenPosition) {
      showToast('No open positions', 'error');
      return;
    }

    const legs = [
      {
        row: leftPositionRow,
        market: leftMarket,
        book: leftBook,
        tokenId: leftTokenId,
      },
      {
        row: rightPositionRow,
        market: rightMarket,
        book: rightBook,
        tokenId: rightTokenId,
      },
    ];

    setClosing(true);
    try {
      for (const { row, market, book, tokenId } of legs) {
        if (row.size <= 0 || !tokenId || !market) continue;
        if (isMarketExpired(market)) {
          showToast(`${row.asset} ${row.leg}: market expired`, 'error');
          return;
        }

        const size = Math.floor(row.size * 100) / 100;
        if (size <= 0) continue;

        const bidWalk = walkBidsForShares(book.rawBids, size);
        if (!bidWalk?.complete) {
          showToast(`${row.asset} ${row.leg}: not enough bid depth for ${size} shares`, 'error');
          return;
        }

        const limitPx = pairLimitFromBidPrice(bidWalk.avgPrice, priceDeltaCents);
        if (!limitPx) {
          showToast(`${row.asset} ${row.leg}: no bid in book`, 'error');
          return;
        }

        const result = await placeOrder({
          tokenId,
          side: 'SELL',
          price: limitPx.price,
          size,
          expiration: 0,
          orderInfo: `Pair SELL ${size} ${row.leg} ${row.asset} @ ${fmtCents(limitPx.cents)} (${timeframe})`,
        });
        if (!result.success) {
          showToast(result.error || `${row.asset} ${row.leg} close failed`, 'error');
          triggerWalletRefresh();
          return;
        }
      }

      showToast('Pair close orders placed', 'success');
      triggerWalletRefresh();
    } catch {
      showToast('Pair close failed', 'error');
    } finally {
      setClosing(false);
    }
  }, [
    walletReady,
    hasOpenPosition,
    leftPositionRow,
    rightPositionRow,
    leftMarket,
    rightMarket,
    leftBook,
    rightBook,
    leftTokenId,
    rightTokenId,
    priceDeltaCents,
    timeframe,
  ]);

  const handleSell98c = useCallback(async () => {
    if (!walletReady) {
      showToast('Connect wallet first', 'error');
      return;
    }
    if (!hasOpenPosition) {
      showToast('No open positions', 'error');
      return;
    }

    const legs = [
      { row: leftPositionRow, market: leftMarket, tokenId: leftTokenId },
      { row: rightPositionRow, market: rightMarket, tokenId: rightTokenId },
    ];

    setSelling98c(true);
    try {
      for (const { row, market, tokenId } of legs) {
        if (row.size <= 0 || !tokenId || !market) continue;
        if (isMarketExpired(market)) {
          showToast(`${row.asset} ${row.leg}: market expired`, 'error');
          return;
        }

        const size = Math.floor(row.size * 100) / 100;
        if (size <= 0) continue;

        const cancel = await cancelExistingSellOrdersForToken(tokenId, orders);
        if (!cancel.success) {
          showToast(cancel.error || `${row.asset} ${row.leg}: cancel existing sells failed`, 'error');
          triggerWalletRefresh();
          return;
        }

        const result = await placeOrder({
          tokenId,
          side: 'SELL',
          price: PAIR_98C_SELL_PRICE,
          size,
          expiration: 0,
          orderInfo: `Pair SELL ${size} ${row.leg} ${row.asset} @ ${PAIR_98C_SELL_CENTS}¢ (${timeframe})`,
        });
        if (!result.success) {
          showToast(result.error || `${row.asset} ${row.leg} 98c sell failed`, 'error');
          triggerWalletRefresh();
          return;
        }
      }

      showToast('Pair 98c sell orders placed', 'success');
      triggerWalletRefresh();
    } catch {
      showToast('Pair 98c sell failed', 'error');
    } finally {
      setSelling98c(false);
    }
  }, [
    walletReady,
    hasOpenPosition,
    leftPositionRow,
    rightPositionRow,
    leftMarket,
    rightMarket,
    leftTokenId,
    rightTokenId,
    orders,
    timeframe,
  ]);

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

    const upAskWalkPx = walkAsksForShares(upBook.rawAsks, shares);
    const downAskWalkPx = walkAsksForShares(downBook.rawAsks, shares);
    if (!upAskWalkPx?.complete) {
      showToast(`${upAsset} UP: not enough ask depth for ${shares} shares`, 'error');
      return;
    }
    if (!downAskWalkPx?.complete) {
      showToast(`${downAsset} DOWN: not enough ask depth for ${shares} shares`, 'error');
      return;
    }

    const upLimitPx = pairLimitFromAskPrice(upAskWalkPx.avgPrice, priceDeltaCents);
    const downLimitPx = pairLimitFromAskPrice(downAskWalkPx.avgPrice, priceDeltaCents);
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
    upBook.rawAsks,
    downBook.rawAsks,
    priceDeltaCents,
  ]);

  const selectClass =
    'rounded border border-gray-600 bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-gray-200 focus:outline-none';

  return (
    <div className="panel-wrapper flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-gray-800/50 p-3">
      <div className="panel-header mb-1.5 flex shrink-0 items-start gap-2 cursor-grab">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
          <MarketSlotToggle slot={marketSlot} onPick={setMarketSlotPersist} />
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
        <PairTradingExpiryCountdown
          upMarket={upMarket}
          downMarket={downMarket}
          upAsset={upAsset}
          downAsset={downAsset}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        <PairTradingOrderbookColumn asset={leftAsset} leg={leftLeg} market={leftMarket} obAggStep={obAggStep} book={leftBook} />
        <PairTradingOrderbookColumn asset={rightAsset} leg={rightLeg} market={rightMarket} obAggStep={obAggStep} book={rightBook} />
      </div>

      <div className="no-drag mt-2 shrink-0 rounded border border-gray-700/80 bg-gray-900/50 p-2" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-[72px] shrink-0">
            <label className="mb-1 block text-[10px] text-gray-400">Δ price (¢)</label>
            <input
              type="number"
              value={priceDeltaInput}
              onChange={(e) => setPriceDeltaInput(e.target.value)}
              onBlur={() => commitPriceDelta(priceDeltaInput)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitPriceDelta(priceDeltaInput);
              }}
              onWheel={(e) => e.preventDefault()}
              className="order-input no-spin h-[34px] w-full"
              placeholder="10"
              min={0}
              step={0.1}
            />
          </div>
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
            <div>Ask price</div>
            <div className={`font-bold tabular-nums ${pairAskColorClass(pairAskCents)}`}>
              {pairAskCents != null ? `${pairAskCents.toFixed(1)}¢` : '—'}
            </div>
            {pairAskInsufficient ? (
              <div className="text-[9px] font-semibold text-red-400">insufficient ask depth</div>
            ) : null}
          </div>
          <div className="rounded bg-gray-800/80 px-2 py-1 text-[10px] text-gray-400">
            <div>Est. cost</div>
            <div className="font-bold tabular-nums text-red-300">
              {estPairCostUsd != null ? `$${estPairCostUsd.toFixed(2)}` : '—'}
            </div>
          </div>
          <button
            type="button"
            disabled={!walletReady || placing || leftAsset === rightAsset || pairAskInsufficient === true}
            onClick={() => void handlePlacePair()}
            className="h-[34px] shrink-0 rounded-lg bg-emerald-700 px-4 text-[11px] font-bold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {placing ? 'Placing…' : 'Place Pair'}
          </button>
        </div>
        <PairLegPositionsRow
          left={leftPositionRow}
          right={rightPositionRow}
          totalEntryCents={totalEntryCents}
          totalExitCents={totalExitCents}
          totalPnlUsd={totalPnlUsd}
          onSell98c={() => void handleSell98c()}
          onClose={() => void handleClosePair()}
          selling98c={selling98c}
          closing={closing}
          sell98Disabled={!walletReady || selling98c || closing || placing || !hasOpenPosition}
          closeDisabled={!walletReady || closing || selling98c || placing || !hasOpenPosition}
        />
      </div>
    </div>
  );
}
