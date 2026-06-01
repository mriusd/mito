import { memo, useEffect, useMemo, useState } from 'react';
import { fetchOnchainMarkets, type OnchainMarketListItem } from '../api';
import { useAppStore } from '../stores/appStore';
import type { AssetName, AssetSymbol, Market } from '../types';
import { assetToSymbol, extractAssetFromMarket, resolvedBinaryOutcomeLabel, upDownTimeframeKeyFromMarket } from '../utils/format';
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

const SIDEBAR_PREV_SQUARE_CLS =
  'inline-flex h-4 min-w-[1.15rem] items-center justify-center rounded-sm border px-0 text-[6px] font-bold tabular-nums leading-none transition-colors';

function isResolvedOutcome(outcome: string): boolean {
  const o = outcome.trim().toUpperCase();
  return o === 'YES' || o === 'UP' || o === 'NO' || o === 'DOWN';
}

/** True when the market bucket immediately before `selectedEndMs` has a resolved YES/NO outcome. */
function immediatePredecessorResolved(
  batch: OnchainMarketListItem[],
  storeMarkets: Market[],
  selectedEndMs: number,
  timeframe: string,
  nowMs: number,
): boolean {
  const duration = tfDurationMs(timeframe);
  if (!duration || !selectedEndMs) return true;
  const expectedEnd = selectedEndMs - duration;
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
    const outcome =
      resolved === 'UP' ? 'YES' : resolved === 'DOWN' ? 'NO' : '';
    consider(parseMarketEndMs(m), outcome);
  }

  if (bestDist === Infinity) {
    // Current window live but adjacent bucket should have ended → treat as unresolved.
    if (selectedEndMs > nowMs && expectedEnd <= nowMs) return false;
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

function pickPreviousMarkets(
  batch: OnchainMarketListItem[],
  storeMarkets: Market[],
  beforeEndMs: number,
  count: number,
): SquareMarket[] {
  const byId = new Map<string, SquareMarket>();
  const add = (m: SquareMarket) => {
    const endMs = parseMarketEndMs(m);
    if (!endMs || endMs >= beforeEndMs) return;
    const id = squareConditionId(m).toLowerCase();
    if (!id) return;
    const prev = byId.get(id);
    if (prev) {
      const prevEnd = parseMarketEndMs(prev);
      if (prevEnd >= endMs) byId.set(id, m);
      return;
    }
    byId.set(id, m);
  };
  for (const m of batch) add(m);
  for (const m of storeMarkets) add(m);
  return [...byId.values()]
    .sort((a, b) => parseMarketEndMs(b) - parseMarketEndMs(a))
    .slice(0, count)
    .reverse();
}

function pickFutureMarkets(storeMarkets: Market[], afterEndMs: number, count: number): Market[] {
  const byId = new Map<string, Market>();
  for (const m of storeMarkets) {
    const endMs = parseMarketEndMs(m);
    if (!endMs || endMs <= afterEndMs) continue;
    const id = (m.id || m.conditionId || '').trim().toLowerCase();
    if (!id) continue;
    byId.set(id, m);
  }
  return [...byId.values()]
    .sort((a, b) => parseMarketEndMs(a) - parseMarketEndMs(b))
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
  const selectedEndMs = parseMarketEndMs(selectedMarket);
  const isUpDown = marketIsUpDown(selectedMarket);

  const markovO4 = useMemo(() => {
    if (!asset || !timeframe) return null;
    const model = markovModels?.[asset]?.[timeframe];
    const sym = assetToSymbol(asset as AssetName) as AssetSymbol;
    const cl = chainlinkPrices[asset as AssetName];
    const binanceSpot = priceData[sym]?.price;
    const preferChainlink = timeframe === '5m' || timeframe === '15m';
    const liveSpot = preferChainlink
      ? (cl != null && cl > 0 ? cl : (binanceSpot != null && binanceSpot > 0 ? binanceSpot : undefined))
      : (binanceSpot != null && binanceSpot > 0 ? binanceSpot : undefined);
    const strike = selectedMarket.priceToBeat;
    let pUpCur: number | null = null;
    if (liveSpot != null && liveSpot > 0 && strike != null && selectedMarket.endDate) {
      const sigma = (volatilityData[sym] || 0.6) * volMultiplier;
      const p = getMarketProbability('>' + strike, liveSpot, selectedMarket.endDate, sigma, bsTimeOffsetHours);
      if (p != null) pUpCur = p;
    }
    return markovNextUpProb(model, pUpCur).order4;
  }, [
    asset,
    timeframe,
    markovModels,
    chainlinkPrices,
    priceData,
    volatilityData,
    volMultiplier,
    bsTimeOffsetHours,
    selectedMarket.priceToBeat,
    selectedMarket.endDate,
  ]);

  const nowMs = useExpiryNow();

  const [batch, setBatch] = useState<OnchainMarketListItem[]>([]);

  useEffect(() => {
    if (!isUpDown || !asset || !timeframe || !selectedEndMs) {
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
  }, [selectedMarket.id, isUpDown, asset, timeframe, selectedEndMs]);

  const storeTfMarkets = useMemo(() => {
    if (!asset || !timeframe) return [];
    return upOrDownMarkets[asset]?.[timeframe] ?? [];
  }, [asset, timeframe, upOrDownMarkets]);

  const previous = useMemo(
    () => (selectedEndMs ? pickPreviousMarkets(batch, storeTfMarkets, selectedEndMs, 5) : []),
    [batch, storeTfMarkets, selectedEndMs],
  );

  const future = useMemo(
    () => (selectedEndMs ? pickFutureMarkets(storeTfMarkets, selectedEndMs, 5) : []),
    [storeTfMarkets, selectedEndMs],
  );

  const prevResolved = useMemo(() => {
    if (!selectedEndMs || !timeframe) return true;
    return immediatePredecessorResolved(batch, storeTfMarkets, selectedEndMs, timeframe, nowMs);
  }, [batch, storeTfMarkets, selectedEndMs, timeframe, nowMs]);

  if (!isUpDown || !timeframe) return null;
  if (previous.length === 0 && future.length === 0 && markovO4 == null && markovModels == null) return null;

  const selectedLc = (selectedMarket.conditionId || selectedMarket.id || '').trim().toLowerCase();

  const renderSquare = (m: SquareMarket) => {
    const id = squareConditionId(m);
    const endMs = parseMarketEndMs(m);
    const status = squareStatus(m, timeframe, nowMs);
    const label = squareLabelForTimeframe(timeframe, endMs);
    const isSelected = selectedLc === id.toLowerCase();
    return (
      <button
        key={id}
        type="button"
        className={`${SIDEBAR_PREV_SQUARE_CLS} ${STATUS_CLS[status]} hover:brightness-110 shrink-0 ${
          isSelected ? 'ring-1 ring-yellow-400/80 border-yellow-500/70 brightness-110' : ''
        }`}
        title={squareTooltip(m, status)}
        onClick={() => setSelectedMarket(squareToSelectedMarket(m, marketLookup, upOrDownMarkets))}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-0.5 px-1 py-0.5 border-t border-gray-700/60 shrink-0">
      {previous.length > 0 && (
        <>
          <span className="text-[7px] text-gray-500 font-semibold shrink-0">prev</span>
          <div className="flex min-w-0 items-center gap-px overflow-x-auto">{previous.map(renderSquare)}</div>
        </>
      )}
      {future.length > 0 && (
        <>
          <span className="text-[7px] text-gray-500 font-semibold shrink-0">next</span>
          <div className="flex min-w-0 items-center gap-px overflow-x-auto">{future.map(renderSquare)}</div>
        </>
      )}
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
