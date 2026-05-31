import { memo, useEffect, useMemo, useState } from 'react';
import { fetchOnchainMarkets, type OnchainMarketListItem } from '../api';
import { useAppStore } from '../stores/appStore';
import type { AssetName, AssetSymbol, Market } from '../types';
import { assetToSymbol, extractAssetFromMarket, resolvedBinaryOutcomeLabel, upDownTimeframeKeyFromMarket } from '../utils/format';
import { getMarketProbability } from '../utils/bsMath';
import { useChainlinkPricesMap } from '../hooks/usePolymarketPrice';
import { useMarkovUpDown, markovNextUpProb } from '../hooks/useMarkovUpDown';
import {
  MARKET_SQUARE_CLS,
  STATUS_CLS,
  marketSquareStatusFromOnchain,
  parseMarketEndMs,
  squareLabelForTimeframe,
  marketSquareTooltip,
  tfDurationMs,
} from '../lib/marketSquareUi';

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

function pickPreviousMarkets(
  batch: OnchainMarketListItem[],
  beforeEndMs: number,
  count: number,
): OnchainMarketListItem[] {
  const prev = batch
    .filter((m) => {
      const endMs = parseMarketEndMs(m);
      if (!endMs || endMs >= beforeEndMs) return false;
      const outcome = (m.outcome || '').trim().toUpperCase();
      return outcome === 'YES' || outcome === 'UP' || outcome === 'NO' || outcome === 'DOWN';
    })
    .sort((a, b) => parseMarketEndMs(b) - parseMarketEndMs(a))
    .slice(0, count);
  return prev.reverse();
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

  const previous = useMemo(
    () => (selectedEndMs ? pickPreviousMarkets(batch, selectedEndMs, 5) : []),
    [batch, selectedEndMs],
  );

  const storeTfMarkets = useMemo(() => {
    if (!asset || !timeframe) return [];
    return upOrDownMarkets[asset]?.[timeframe] ?? [];
  }, [asset, timeframe, upOrDownMarkets]);

  const prevResolved = useMemo(() => {
    if (!selectedEndMs || !timeframe) return true;
    return immediatePredecessorResolved(batch, storeTfMarkets, selectedEndMs, timeframe, Date.now());
  }, [batch, storeTfMarkets, selectedEndMs, timeframe]);

  if (!isUpDown || !timeframe) return null;
  if (previous.length === 0 && markovO4 == null && markovModels == null) return null;

  const selectedLc = (selectedMarket.conditionId || selectedMarket.id || '').trim().toLowerCase();
  const nowMs = Date.now();

  return (
    <div className="flex items-center gap-1 px-1 py-1 border-t border-gray-700/60 shrink-0">
      {previous.length > 0 && (
        <>
          <span className="text-[8px] text-gray-500 font-semibold shrink-0 pr-0.5">prev</span>
          <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
            {previous.map((m) => {
              const id = (m.conditionId || '').trim();
              const endMs = parseMarketEndMs(m);
              const status = marketSquareStatusFromOnchain(m, timeframe, nowMs);
              const label = squareLabelForTimeframe(timeframe, endMs);
              const isSelected = selectedLc === id.toLowerCase();
              const tip = marketSquareTooltip(
                { conditionId: id, question: m.question ?? '', eventSlug: m.eventSlug ?? '', endDate: m.endDate ?? '' },
                status,
              );
              return (
                <button
                  key={id}
                  type="button"
                  className={`${MARKET_SQUARE_CLS} ${STATUS_CLS[status]} hover:brightness-110 shrink-0 ${
                    isSelected ? 'ring-1 ring-yellow-400 border-yellow-500/70 brightness-110' : ''
                  }`}
                  title={tip}
                  onClick={() => {
                    const hit = findMarketInStore(id, marketLookup, upOrDownMarkets);
                    setSelectedMarket(hit ?? onchainToMarket(m));
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
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
