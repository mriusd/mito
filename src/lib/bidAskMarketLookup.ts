import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';

/** Grid store flush for bid/ask + lookup fields — sidebar uses `getBidAskMarketRow` (unthrottled). */
export const BID_ASK_LOOKUP_FLUSH_MS = 2000;
export const GRID_BID_ASK_THROTTLE_MS = BID_ASK_LOOKUP_FLUSH_MS;
/** Coalesce live WS bid/ask into grid flush listeners (faster yes/no on grid/updown without per-tick React). */
export const GRID_BID_ASK_LIVE_COALESCE_MS = 500;

/** Fields bid/ask WS batches can materially change vs prior store row — cheap equality gate. */
const BIDASK_EQ_KEYS: (keyof Market)[] = [
  'bestBid',
  'bestAsk',
  'volume',
  'wmpVolumeSum',
  'sharesInExistence',
  'marketNetDirection',
  'holders',
  'smartMoneyBias',
  'provenSMS',
  'crowdBias',
  'liveBias',
  'liveBiasWindowMin',
  'concentration',
  'winnerBias',
  'winnerBiasYesWR',
  'winnerBiasNoWR',
  'winBiasShares',
  'winBiasSharesYes',
  'winBiasSharesNo',
  'winnerBiasConviction',
  'winnerBiasConvictionYesWR',
  'winnerBiasConvictionNoWR',
  'winBiasConvictionShares',
  'winBiasConvictionSharesYes',
  'winBiasConvictionSharesNo',
  'stakedUsdYesLeg',
  'stakedUsdNoLeg',
  'stakedSumAbsSignedNetUsd',
  'stakedTopHoldersCohortYesUsd',
  'stakedTopHoldersCohortNoUsd',
  'stakedNetYesUsd',
  'stakedNetNoUsd',
];

const NON_BIDASK_EQ_KEYS = BIDASK_EQ_KEYS.filter((k) => k !== 'bestBid' && k !== 'bestAsk');

export function bidAskWsRowEqual(prev: Market | undefined | null, next: Market | undefined | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  for (const k of BIDASK_EQ_KEYS) {
    if (prev[k] !== next[k]) return false;
  }
  return true;
}

/** Holders/volume/staked/etc. — epoch bump only when these change (not bid/ask alone). */
export function nonBidAskMarketRowEqual(prev: Market | undefined | null, next: Market | undefined | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  for (const k of NON_BIDASK_EQ_KEYS) {
    if (prev[k] !== next[k]) return false;
  }
  return true;
}

/** Partial row from `/ws/chart` bid/ask batches — keys overlap `Market`. */
export type BidAskWsItem = Record<string, unknown> & {
  assetId?: string;
  bestBid?: number;
  bestAsk?: number;
  usdcVolume?: number;
  volume?: number;
  wmpVolumeSum?: number;
};

function mergeWsItemOntoMarket(seed: Market, item: BidAskWsItem): Market {
  const patch: Partial<Market> = {};
  let changed = false;

  if (item.bestBid !== undefined) {
    const bestBid = item.bestBid ?? 0;
    if (bestBid !== seed.bestBid) {
      patch.bestBid = bestBid;
      changed = true;
    }
  }
  if (item.bestAsk !== undefined) {
    const bestAsk = item.bestAsk ?? 0;
    if (bestAsk !== seed.bestAsk) {
      patch.bestAsk = bestAsk;
      changed = true;
    }
  }

  for (const key of BIDASK_EQ_KEYS) {
    if (key === 'bestBid' || key === 'bestAsk') continue;
    const v = item[key as string];
    if (key === 'liveBiasWindowMin') {
      if (typeof v === 'number' && v > 0 && v !== seed.liveBiasWindowMin) {
        patch.liveBiasWindowMin = v;
        changed = true;
      }
      continue;
    }
    if (typeof v === 'number' && Number.isFinite(v) && v !== seed[key]) {
      (patch as Record<string, unknown>)[key as string] = v;
      changed = true;
    }
  }

  const vol = item.usdcVolume ?? item.volume;
  if (typeof vol === 'number' && Number.isFinite(vol) && vol !== seed.volume) {
    patch.volume = vol;
    changed = true;
  }

  if (!changed) return seed;
  return { ...seed, ...patch };
}

const pendingPatch: Record<string, Market> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let gridLiveCoalesceTimer: ReturnType<typeof setTimeout> | null = null;
const bidAskLookupLiveListeners = new Set<() => void>();
const bidAskLookupGridFlushListeners = new Set<() => void>();
let bidAskGridFlushDigest = 0;

/** Fires on each WS bid/ask patch — sidebar live prob bar, unthrottled hooks. */
export function subscribeBidAskMarketLookup(listener: () => void): () => void {
  bidAskLookupLiveListeners.add(listener);
  return () => {
    bidAskLookupLiveListeners.delete(listener);
  };
}

/** Fires when pending patches flush to store (~2s) — grid cells only. */
export function subscribeBidAskMarketLookupGridFlush(listener: () => void): () => void {
  bidAskLookupGridFlushListeners.add(listener);
  return () => {
    bidAskLookupGridFlushListeners.delete(listener);
  };
}

export function getBidAskGridFlushDigest(): number {
  return bidAskGridFlushDigest;
}

function notifyBidAskMarketLookupLiveListeners() {
  for (const listener of bidAskLookupLiveListeners) listener();
}

function notifyBidAskMarketLookupGridFlushListeners() {
  bidAskGridFlushDigest += 1;
  for (const listener of bidAskLookupGridFlushListeners) listener();
}

function scheduleGridLiveCoalesceNotify() {
  if (gridLiveCoalesceTimer != null) return;
  gridLiveCoalesceTimer = setTimeout(() => {
    gridLiveCoalesceTimer = null;
    notifyBidAskMarketLookupGridFlushListeners();
  }, GRID_BID_ASK_LIVE_COALESCE_MS);
}

function flushPendingBidAskToStore() {
  flushTimer = null;
  const ids = Object.keys(pendingPatch);
  if (ids.length === 0) {
    notifyBidAskMarketLookupGridFlushListeners();
    return;
  }

  const snapshot: Record<string, Market> = {};
  for (const id of ids) {
    snapshot[id] = pendingPatch[id]!;
    delete pendingPatch[id];
  }

  useAppStore.setState((state) => {
    const lookup = state.marketLookup;
    let merged = lookup;
    let bumped = false;
    for (const id of ids) {
      const next = snapshot[id];
      const baseline = lookup[id];
      if (bidAskWsRowEqual(baseline, next)) continue;
      if (merged === lookup) merged = { ...lookup };
      merged[id] = next;
      bumped = true;
    }
    if (!bumped) return {};
    return { marketLookup: merged };
  });
  notifyBidAskMarketLookupGridFlushListeners();
}

function scheduleBidAskFlush() {
  if (flushTimer != null) return;
  flushTimer = setTimeout(flushPendingBidAskToStore, BID_ASK_LOOKUP_FLUSH_MS);
}

export function flushBidAskMarketLookupNow() {
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushPendingBidAskToStore();
}

/** Latest WS row for order checks: unflushed pending patch wins over store (not throttled React snapshot). */
export function getBidAskMarketRow(tokenId: string): Market | undefined {
  const id = String(tokenId || '').trim();
  if (!id) return undefined;
  const pending = pendingPatch[id];
  if (pending) return pending;
  return useAppStore.getState().marketLookup[id];
}

export function enqueueBidAskMarketPatches(items: BidAskWsItem[]) {
  const lookup = useAppStore.getState().marketLookup;
  let touched = false;
  for (const item of items) {
    if (!item.assetId) continue;
    const id = item.assetId;
    const seed = pendingPatch[id] ?? lookup[id];
    if (!seed) continue;
    const next = mergeWsItemOntoMarket(seed, item);
    if (bidAskWsRowEqual(lookup[id], next)) {
      if (pendingPatch[id]) {
        delete pendingPatch[id];
        touched = true;
      }
      continue;
    }
    pendingPatch[id] = next;
    touched = true;
  }
  if (touched) {
    notifyBidAskMarketLookupLiveListeners();
    scheduleGridLiveCoalesceNotify();
  }
  if (Object.keys(pendingPatch).length > 0) scheduleBidAskFlush();
}

export function resetBidAskMarketLookupPending() {
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (gridLiveCoalesceTimer != null) {
    clearTimeout(gridLiveCoalesceTimer);
    gridLiveCoalesceTimer = null;
  }
  for (const k of Object.keys(pendingPatch)) delete pendingPatch[k];
}
