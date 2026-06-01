import { memo, useEffect, useMemo, useState } from 'react';
import { fetchOnchainMarkets, type OnchainMarketListItem } from '../api';
import { useAppStore } from '../stores/appStore';
import type { Market } from '../types';
import { extractAssetFromMarket, pickLiveUpDownMarketInTfBucket, resolvedBinaryOutcomeLabel, upDownTimeframeKeyFromMarket } from '../utils/format';
import {
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
  'inline-flex h-5 min-w-[1.4rem] items-center justify-center rounded-sm px-0 text-[7px] font-bold tabular-nums leading-none transition-colors';
const SIDEBAR_LIVE_FILL_CLS = 'bg-pink-900/45 text-pink-100';
const SIDEBAR_LIVE_BORDER_CLS = 'border border-pink-500/70';
const SIDEBAR_SELECTED_BORDER_CLS = 'border-2 border-blue-500';

const STATUS_FILL_CLS: Record<MarketSquareStatus, string> = {
  resolved_yes: 'bg-green-900/45 text-green-100',
  resolved_no: 'bg-red-900/45 text-red-100',
  current: 'bg-orange-900/40 text-orange-100',
  future: 'bg-gray-800/40 text-gray-500',
  expired_unresolved: 'bg-yellow-900/40 text-yellow-100',
};

const STATUS_BORDER_CLS: Record<MarketSquareStatus, string> = {
  resolved_yes: 'border border-green-600/55',
  resolved_no: 'border border-red-600/55',
  current: 'border border-orange-500/70',
  future: 'border border-gray-600/80',
  expired_unresolved: 'border border-yellow-500/70',
};

const PAST_COUNT = 5;
const FUTURE_COUNT = 5;

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

function onchainMatchesUpDownTimeframe(m: OnchainMarketListItem, tf: string): boolean {
  const dbTf = (m.timeframe || '').trim().toLowerCase();
  if (dbTf === tf) return true;
  return upDownTimeframeKeyFromMarket({ eventSlug: m.eventSlug, question: m.question }) === tf;
}

function inferExpiredSquareStatusFromQuotes(
  m: Market,
  marketLookup: Record<string, Market>,
  endMs: number,
  nowMs: number,
): MarketSquareStatus | null {
  if (!endMs || endMs > nowMs) return null;
  const yesTok = (m.clobTokenIds?.[0] || '').trim();
  const live = yesTok ? marketLookup[yesTok] : undefined;
  const bid = live?.bestBid ?? m.bestBid;
  if (bid == null || !Number.isFinite(bid)) return null;
  if (bid >= 0.95) return 'resolved_yes';
  if (bid <= 0.05) return 'resolved_no';
  return null;
}

function isStoreMarket(m: SquareMarket): m is Market {
  return typeof (m as Market).id === 'string' && (m as Market).id.length > 0;
}

function squareMarketResolvedRank(m: SquareMarket): number {
  if (isStoreMarket(m)) {
    return resolvedBinaryOutcomeLabel(m, true) ? 2 : 0;
  }
  const o = (m.outcome || '').trim().toUpperCase();
  if (o === 'YES' || o === 'UP' || o === 'NO' || o === 'DOWN') return 2;
  if ((m as OnchainMarketListItem).resolved === 1) return 1;
  return 0;
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
    const prevRank = squareMarketResolvedRank(prev);
    const nextRank = squareMarketResolvedRank(m);
    if (nextRank > prevRank) {
      byId.set(id, m);
      return;
    }
    if (prevRank > nextRank) return;
    const prevEnd = parseMarketEndMs(prev);
    const nextEnd = parseMarketEndMs(m);
    if (nextEnd >= prevEnd) byId.set(id, m);
  };
  for (const m of batch) add(m);
  for (const m of storeMarkets) add(m);
  return [...byId.values()].sort((a, b) => parseMarketEndMs(a) - parseMarketEndMs(b));
}

function batchByConditionId(batch: OnchainMarketListItem[]): Map<string, OnchainMarketListItem> {
  const out = new Map<string, OnchainMarketListItem>();
  for (const m of batch) {
    const id = (m.conditionId || '').trim().toLowerCase();
    if (id) out.set(id, m);
  }
  return out;
}

function enrichStoreMarketFromLookup(m: Market, marketLookup: Record<string, Market>): Market {
  if (resolvedBinaryOutcomeLabel(m, true)) return m;
  for (const tok of m.clobTokenIds || []) {
    const hit = marketLookup[String(tok || '').trim()];
    if (!hit?.outcomePrices) continue;
    if (resolvedBinaryOutcomeLabel(hit, true)) {
      return { ...m, outcomePrices: hit.outcomePrices, closed: hit.closed ?? m.closed };
    }
  }
  return m;
}

function pickPastMarkets(
  all: SquareMarket[],
  anchorEndMs: number,
  timeframe: string,
  count: number,
  excludeIds?: ReadonlySet<string>,
): SquareMarket[] {
  const duration = tfDurationMs(timeframe);
  if (!duration || !anchorEndMs) return [];

  const tol = Math.max(Math.round(duration * 0.25), 45_000);
  const used = new Set<string>();
  const slots: SquareMarket[] = [];

  for (let slot = 1; slot <= count; slot++) {
    const expectedEnd = anchorEndMs - slot * duration;
    let best: SquareMarket | null = null;
    let bestDist = Infinity;
    for (const m of all) {
      const id = squareConditionId(m).toLowerCase();
      if (!id || used.has(id) || excludeIds?.has(id)) continue;
      const endMs = parseMarketEndMs(m);
      if (!endMs || endMs >= anchorEndMs) continue;
      const dist = Math.abs(endMs - expectedEnd);
      if (dist <= tol && dist < bestDist) {
        bestDist = dist;
        best = m;
      }
    }
    if (best) {
      used.add(squareConditionId(best).toLowerCase());
      slots.push(best);
    }
  }

  if (slots.length >= count) return slots.reverse();

  const chronological = all
    .filter((m) => {
      const id = squareConditionId(m).toLowerCase();
      const endMs = parseMarketEndMs(m);
      return endMs > 0 && endMs < anchorEndMs && !excludeIds?.has(id);
    })
    .slice(-count);
  if (slots.length === 0) return chronological;

  const byId = new Map<string, SquareMarket>();
  for (const m of chronological) byId.set(squareConditionId(m).toLowerCase(), m);
  for (const m of slots) byId.set(squareConditionId(m).toLowerCase(), m);
  return [...byId.values()].sort((a, b) => parseMarketEndMs(a) - parseMarketEndMs(b)).slice(-count);
}

function pickFutureMarkets(all: SquareMarket[], anchorEndMs: number, count: number): SquareMarket[] {
  return all
    .filter((m) => {
      const endMs = parseMarketEndMs(m);
      return endMs > anchorEndMs;
    })
    .slice(0, count);
}

function squareStatus(
  m: SquareMarket,
  timeframe: string,
  nowMs: number,
  onchainById: Map<string, OnchainMarketListItem>,
  marketLookup: Record<string, Market>,
  upOrDownMarkets: Record<string, Record<string, Market[]>>,
): MarketSquareStatus {
  const id = squareConditionId(m).toLowerCase();
  const endMs = parseMarketEndMs(m);
  const storeHit = findMarketInStore(id, marketLookup, upOrDownMarkets);
  if (storeHit) {
    const st = marketSquareStatusFromMarket(enrichStoreMarketFromLookup(storeHit, marketLookup), timeframe, nowMs);
    if (st !== 'expired_unresolved') return st;
    const inferred = inferExpiredSquareStatusFromQuotes(enrichStoreMarketFromLookup(storeHit, marketLookup), marketLookup, endMs, nowMs);
    if (inferred) return inferred;
  }
  const onchainHit = onchainById.get(id);
  if (onchainHit) {
    const st = marketSquareStatusFromOnchain(onchainHit, timeframe, nowMs);
    if (st !== 'expired_unresolved') return st;
  }
  if (isStoreMarket(m)) {
    const enriched = enrichStoreMarketFromLookup(m, marketLookup);
    const st = marketSquareStatusFromMarket(enriched, timeframe, nowMs);
    if (st !== 'expired_unresolved') return st;
    const inferred = inferExpiredSquareStatusFromQuotes(enriched, marketLookup, endMs, nowMs);
    if (inferred) return inferred;
    return st;
  }
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

  const [batch, setBatch] = useState<OnchainMarketListItem[]>([]);

  useEffect(() => {
    if (!isUpDown || !asset || !timeframe) {
      setBatch([]);
      return;
    }
    let disposed = false;
    const load = () => {
      void fetchOnchainMarkets({ asset, expired_only: true, limit: 100, offset: 0 })
        .then((data) => {
          if (disposed) return;
          const markets = (data.markets ?? []).filter((m) => onchainMatchesUpDownTimeframe(m, timeframe));
          setBatch(markets);
        })
        .catch(() => {
          if (!disposed) setBatch([]);
        });
    };
    load();
    const iv = window.setInterval(load, 15_000);
    return () => {
      disposed = true;
      window.clearInterval(iv);
    };
  }, [isUpDown, asset, timeframe]);

  const onchainById = useMemo(() => batchByConditionId(batch), [batch]);

  const allSquareMarkets = useMemo(
    () => mergeSquareMarkets(batch, storeTfMarkets),
    [batch, storeTfMarkets],
  );

  const past = useMemo(() => {
    if (!liveEndMs || !timeframe) return [];
    const liveId = (liveMarket?.conditionId || liveMarket?.id || '').trim().toLowerCase();
    const exclude = liveId ? new Set([liveId]) : undefined;
    return pickPastMarkets(allSquareMarkets, liveEndMs, timeframe, PAST_COUNT, exclude);
  }, [allSquareMarkets, liveEndMs, timeframe, liveMarket]);

  const future = useMemo(
    () => (liveEndMs ? pickFutureMarkets(allSquareMarkets, liveEndMs, FUTURE_COUNT) : []),
    [allSquareMarkets, liveEndMs],
  );

  if (!isUpDown || !timeframe) return null;
  if (!liveMarket && past.length === 0 && future.length === 0) return null;

  const selectedLc = (selectedMarket.conditionId || selectedMarket.id || '').trim().toLowerCase();

  const renderSquare = (m: SquareMarket, opts?: { live?: boolean }) => {
    const id = squareConditionId(m);
    const endMs = parseMarketEndMs(m);
    const isLive = opts?.live === true;
    const status = isLive ? ('current' as const) : squareStatus(m, timeframe, nowMs, onchainById, marketLookup, upOrDownMarkets);
    const label = squareLabelForTimeframe(timeframe, endMs);
    const isSelected = selectedLc === id.toLowerCase();
    const fillCls = isLive ? SIDEBAR_LIVE_FILL_CLS : STATUS_FILL_CLS[status];
    const borderCls = isSelected
      ? SIDEBAR_SELECTED_BORDER_CLS
      : isLive
        ? SIDEBAR_LIVE_BORDER_CLS
        : STATUS_BORDER_CLS[status];
    return (
      <button
        key={id}
        type="button"
        className={`${SIDEBAR_SQUARE_CLS} ${fillCls} ${borderCls} hover:brightness-110 shrink-0 relative ${
          isSelected ? 'selected z-10' : ''
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
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {past.map((m) => renderSquare(m))}
        {liveMarket ? renderSquare(liveMarket, { live: true }) : null}
        {future.map((m) => renderSquare(m))}
      </div>
    </div>
  );
}

export const SidebarPreviousMarketsRow = memo(SidebarPreviousMarketsRowInner);
