import { memo, useEffect, useMemo, useState } from 'react';
import { fetchOnchainMarkets, type OnchainMarketListItem } from '../api';
import { useAppStore } from '../stores/appStore';
import type { AssetName, AssetSymbol, Market } from '../types';
import {
  assetToSymbol,
  extractAssetFromMarket,
  pickLiveUpDownMarketInTfBucket,
  resolvedBinaryOutcomeLabel,
  upDownTimeframeKeyFromMarket,
} from '../utils/format';
import { getMarketProbability } from '../utils/bsMath';
import { useChainlinkPricesMap } from '../hooks/usePolymarketPrice';
import { useMarkovUpDown, markovNextUpProb } from '../hooks/useMarkovUpDown';
import {
  STATUS_CLS,
  marketSquareStatusFromMarket,
  marketSquareStatusFromOnchain,
  parseMarketEndMs,
  squareLabelForTimeframe,
  marketSquareTooltip,
  tfDurationMs,
  type MarketSquareStatus,
} from '../lib/marketSquareUi';
import { useExpiryNow } from '../hooks/useExpiryNow';

const SIDEBAR_SQUARE_CLS =
  'inline-flex h-4 min-w-[1.15rem] items-center justify-center rounded-sm border px-0 text-[6px] font-bold tabular-nums leading-none transition-colors';
const SIDEBAR_LIVE_SQUARE_CLS =
  'border-pink-500/70 bg-pink-900/45 text-pink-100';
const SIDEBAR_SELECTED_RING_CLS = 'ring-1 ring-yellow-400/80 border-yellow-500/70 brightness-110';

const PAST_COUNT = 5;
const FUTURE_COUNT = 5;

function isResolvedOutcome(outcome: string): boolean {
  const o = outcome.trim().toUpperCase();
  return o === 'YES' || o === 'UP' || o === 'NO' || o === 'DOWN';
}

function immediatePredecessorResolved(
  batch: OnchainMarketListItem[],
  storeMarkets: Market[],
  liveEndMs: number,
  timeframe: string,
  nowMs: number,
): boolean {
  const duration = tfDurationMs(timeframe);
  if (!duration || !liveEndMs) return true;
  const expectedEnd = liveEndMs - duration;
  const tol = duration * 0.25;

  let bestOutcome = '';
  let bestDist = Infinity;

  const consider = (endMs: number, outcome: string) => {
    if (!endMs) return;
    const dist = Math.abs(endMs - expectedEnd);
    if (dist <= tol && dist < bestDist) {
      bestDist = dist;
      bestOutcome = outcome;
    }
  };

  for (const m of batch) {
    consider(parseMarketEndMs(m), (m.outcome || '').trim());
  }
  for (const m of storeMarkets) {
    const resolved = resolvedBinaryOutcomeLabel(m, true);
    const outcome = resolved === 'UP' ? 'YES' : resolved === 'DOWN' ? 'NO' : '';
    consider(parseMarketEndMs(m), outcome);
  }

  if (bestDist === Infinity) {
    if (liveEndMs > nowMs && expectedEnd <= nowMs) return false;
    return true;
  }
  return isResolvedOutcome(bestOutcome);
}

function probColor(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return 'text-gray-500';
  if (Math.abs(p * 100 - 50) <= 1) return 'text-gray-300/90';
  return p > 0.5 ? 'text-green-300' : 'text-red-300';
}

const pct = (p: number | null | undefined): string =>
  p == null || !Number.isFinite(p) ? '-' : (p * 100).toFixed(0);

function marketIsUpDown(market: Market | null | undefined): boolean {
  return !!(market?.question?.match(/up\s+or\s+down/i) || market?.eventSlug?.match(/up-or-down|updown/i));
}

function findMarketInStore(
  conditionId: string,
  marketLookup: Record<string, Market>,
  upOrDownMarkets: Record<string, Record<string, Market[]>>,
): Market | null {
  const lc = conditionId.trim().toLowerCase();
  if (!lc) return null;
  for (const m of Object.values(marketLookup)) {
    const id = (m.id || '').trim().toLowerCase();
    const cid = (m.conditionId || '').trim().toLowerCase();
    if (id === lc || cid === lc) return m;
  }
  for (const assetBucket of Object.values(upOrDownMarkets)) {
    for (const tfBucket of Object.values(assetBucket)) {
      for (const m of tfBucket) {
        const id = (m.id || '').trim().toLowerCase();
        const cid = (m.conditionId || '').trim().toLowerCase();
        if (id === lc || cid === lc) return m;
      }
    }
  }
  return null;
}

function onchainToMarket(m: OnchainMarketListItem): Market {
  const id = (m.conditionId || '').trim();
  return {
    id,
    conditionId: id,
    question: (m.question || '').trim() || id,
    endDate: (m.endDate || '').trim(),
    eventSlug: m.eventSlug,
    clobTokenIds: [],
    closed: true,
  };
}

type SquareMarket = OnchainMarketListItem | Market;

function squareConditionId(m: SquareMarket): string {
  if ('conditionId' in m && m.conditionId) return String(m.conditionId).trim();
  return String((m as Market).id || '').trim();
}

function mergeSquareMarkets(batch: OnchainMarketListItem[], storeMarkets: Market[]): SquareMarket[] {
  const byId = new Map<string, SquareMarket>();
  const add = (m: SquareMarket) => {
    const id = squareConditionId(m).toLowerCase();
    if (!id) return;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, m);
      return;
    }
    const prevEnd = parseMarketEndMs(prev);
    const nextEnd = parseMarketEndMs(m);
    if (nextEnd >= prevEnd) byId.set(id, m);
  };
  for (const m of batch) add(m);
  for (const m of storeMarkets) add(m);
  return [...byId.values()].sort((a, b) => parseMarketEndMs(a) - parseMarketEndMs(b));
}

function pickPastMarkets(all: SquareMarket[], anchorEndMs: number, count: number): SquareMarket[] {
  return all
    .filter((m) => {
      const endMs = parseMarketEndMs(m);
      return endMs > 0 && endMs < anchorEndMs;
    })
    .slice(-count);
}

function pickFutureMarkets(all: SquareMarket[], anchorEndMs: number, count: number): SquareMarket[] {
  return all
    .filter((m) => {
      const endMs = parseMarketEndMs(m);
      return endMs > anchorEndMs;
    })
    .slice(0, count);
}

function isStoreMarket(m: SquareMarket): m is Market {
  return typeof (m as Market).id === 'string' && (m as Market).id.length > 0;
}

function squareStatus(m: SquareMarket, timeframe: string, nowMs: number): MarketSquareStatus {
  if (isStoreMarket(m)) return marketSquareStatusFromMarket(m, timeframe, nowMs);
  return marketSquareStatusFromOnchain(m, timeframe, nowMs);
}

function squareTooltip(m: SquareMarket, status: MarketSquareStatus): string {
  const conditionId = squareConditionId(m);
  const question = ('question' in m ? m.question : '') ?? '';
  const eventSlug = ('eventSlug' in m ? m.eventSlug : undefined) ?? undefined;
  const endDate = ('endDate' in m ? m.endDate : '') ?? '';
  return marketSquareTooltip({ conditionId, question, eventSlug, endDate }, status);
}

function squareToSelectedMarket(
  m: SquareMarket,
  marketLookup: Record<string, Market>,
  upOrDownMarkets: Record<string, Record<string, Market[]>>,
): Market {
  const id = squareConditionId(m);
  const hit = findMarketInStore(id, marketLookup, upOrDownMarkets);
  if (hit) return hit;
  if (isStoreMarket(m)) return m;
  return onchainToMarket(m);
}

function SidebarPreviousMarketsRowInner({ selectedMarket }: { selectedMarket: Market }) {
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const marketLookup = useAppStore((s) => s.marketLookup);
  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const priceData = useAppStore((s) => s.priceData);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);
  const chainlinkPrices = useChainlinkPricesMap();
  const markovModels = useMarkovUpDown();

  const asset = extractAssetFromMarket(selectedMarket);
  const timeframe = upDownTimeframeKeyFromMarket(selectedMarket);
  const isUpDown = marketIsUpDown(selectedMarket);
  const nowMs = useExpiryNow();

  const storeTfMarkets = useMemo(() => {
    if (!asset || !timeframe) return [];
    return upOrDownMarkets[asset]?.[timeframe] ?? [];
  }, [asset, timeframe, upOrDownMarkets]);

  const liveMarket = useMemo(
    () => pickLiveUpDownMarketInTfBucket(storeTfMarkets, nowMs),
    [storeTfMarkets, nowMs],
  );

  const liveEndMs = liveMarket ? parseMarketEndMs(liveMarket) : 0;

  const markovO4 = useMemo(() => {
    if (!asset || !timeframe || !liveMarket) return null;
    const model = markovModels?.[asset]?.[timeframe];
    const sym = assetToSymbol(asset as AssetName) as AssetSymbol;
    const cl = chainlinkPrices[asset as AssetName];
    const binanceSpot = priceData[sym]?.price;
    const preferChainlink = timeframe === '5m' || timeframe === '15m';
    const liveSpot = preferChainlink
      ? (cl != null && cl > 0 ? cl : (binanceSpot != null && binanceSpot > 0 ? binanceSpot : undefined))
      : (binanceSpot != null && binanceSpot > 0 ? binanceSpot : undefined);
    const strike = liveMarket.priceToBeat;
    let pUpCur: number | null = null;
    if (liveSpot != null && liveSpot > 0 && strike != null && liveMarket.endDate) {
      const sigma = (volatilityData[sym] || 0.6) * volMultiplier;
      const p = getMarketProbability('>' + strike, liveSpot, liveMarket.endDate, sigma, bsTimeOffsetHours);
      if (p != null) pUpCur = p;
    }
    return markovNextUpProb(model, pUpCur).order4;
  }, [
    asset,
    timeframe,
    liveMarket,
    markovModels,
    chainlinkPrices,
    priceData,
    volatilityData,
    volMultiplier,
    bsTimeOffsetHours,
  ]);

  const [batch, setBatch] = useState<OnchainMarketListItem[]>([]);

  useEffect(() => {
    if (!isUpDown || !asset || !timeframe) {
      setBatch([]);
      return;
    }
    let disposed = false;
    void fetchOnchainMarkets({ asset, timeframe, expired_only: true, limit: 40, offset: 0 })
      .then((data) => {
        if (!disposed) setBatch(data.markets ?? []);
      })
      .catch(() => {
        if (!disposed) setBatch([]);
      });
    return () => {
      disposed = true;
    };
  }, [isUpDown, asset, timeframe]);

  const allSquareMarkets = useMemo(
    () => mergeSquareMarkets(batch, storeTfMarkets),
    [batch, storeTfMarkets],
  );

  const past = useMemo(
    () => (liveEndMs ? pickPastMarkets(allSquareMarkets, liveEndMs, PAST_COUNT) : []),
    [allSquareMarkets, liveEndMs],
  );

  const future = useMemo(
    () => (liveEndMs ? pickFutureMarkets(allSquareMarkets, liveEndMs, FUTURE_COUNT) : []),
    [allSquareMarkets, liveEndMs],
  );

  const prevResolved = useMemo(() => {
    if (!liveEndMs || !timeframe) return true;
    return immediatePredecessorResolved(batch, storeTfMarkets, liveEndMs, timeframe, nowMs);
  }, [batch, storeTfMarkets, liveEndMs, timeframe, nowMs]);

  if (!isUpDown || !timeframe) return null;
  if (!liveMarket && past.length === 0 && future.length === 0 && markovO4 == null && markovModels == null) {
    return null;
  }

  const selectedLc = (selectedMarket.conditionId || selectedMarket.id || '').trim().toLowerCase();

  const renderSquare = (m: SquareMarket, opts?: { live?: boolean }) => {
    const id = squareConditionId(m);
    const endMs = parseMarketEndMs(m);
    const isLive = opts?.live === true;
    const status = isLive ? ('current' as const) : squareStatus(m, timeframe, nowMs);
    const label = squareLabelForTimeframe(timeframe, endMs);
    const isSelected = selectedLc === id.toLowerCase();
    const colorCls = isLive ? SIDEBAR_LIVE_SQUARE_CLS : STATUS_CLS[status];
    return (
      <button
        key={id}
        type="button"
        className={`${SIDEBAR_SQUARE_CLS} ${colorCls} hover:brightness-110 shrink-0 ${
          isSelected ? SIDEBAR_SELECTED_RING_CLS : ''
        }`}
        title={squareTooltip(m, status)}
        onClick={() => setSelectedMarket(squareToSelectedMarket(m, marketLookup, upOrDownMarkets))}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-0.5 px-1 py-0.5 border-t border-gray-700/60 shrink-0 min-w-0">
      <div className="flex min-w-0 flex-1 items-center gap-px overflow-x-auto">
        {past.map((m) => renderSquare(m))}
        {liveMarket ? renderSquare(liveMarket, { live: true }) : null}
        {future.map((m) => renderSquare(m))}
      </div>
      {(markovO4 != null || markovModels != null) && (
        <div
          className="ml-auto flex items-center gap-1 shrink-0 pl-1 border-l border-gray-700/50"
          title={
            !prevResolved
              ? 'Previous market not resolved — Markov state unknown'
              : '4th-order Markov P(next market UP), live-conditioned on current BS prob'
          }
        >
          <span className="text-[8px] text-amber-400/90 font-semibold">o4</span>
          <span
            className={`text-[10px] font-bold tabular-nums ${
              !prevResolved ? 'text-gray-400' : probColor(markovO4)
            }`}
          >
            {!prevResolved ? '?' : pct(markovO4)}
          </span>
        </div>
      )}
    </div>
  );
}

export const SidebarPreviousMarketsRow = memo(SidebarPreviousMarketsRowInner);
