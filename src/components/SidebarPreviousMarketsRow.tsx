import { memo, useEffect, useMemo, useState } from 'react';
import { fetchOnchainMarkets, type OnchainMarketListItem } from '../api';
import { useAppStore } from '../stores/appStore';
import type { Market } from '../types';
import { extractAssetFromMarket, pickLiveUpDownMarketInTfBucket, upDownTimeframeKeyFromMarket } from '../utils/format';
import {
  marketSquareStatusFromMarket,
  marketSquareStatusFromOnchain,
  parseMarketEndMs,
  squareLabelForTimeframe,
  marketSquareTooltip,
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

  if (!isUpDown || !timeframe) return null;
  if (!liveMarket && past.length === 0 && future.length === 0) return null;

  const selectedLc = (selectedMarket.conditionId || selectedMarket.id || '').trim().toLowerCase();

  const renderSquare = (m: SquareMarket, opts?: { live?: boolean }) => {
    const id = squareConditionId(m);
    const endMs = parseMarketEndMs(m);
    const isLive = opts?.live === true;
    const status = isLive ? ('current' as const) : squareStatus(m, timeframe, nowMs);
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
