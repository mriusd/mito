import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';

/** Max delay before flushing non–order-critical lookup fields to the store (grid/UI). */
export const BID_ASK_LOOKUP_FLUSH_MS = 1000;

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
];

export function bidAskWsRowEqual(prev: Market | undefined | null, next: Market | undefined | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  for (const k of BIDASK_EQ_KEYS) {
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

function flushPendingBidAskToStore() {
  flushTimer = null;
  const snapshot = pendingPatch;
  const ids = Object.keys(snapshot);
  if (ids.length === 0) return;

  for (const id of ids) delete pendingPatch[id];

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
    return { marketLookup: merged, marketLookupEpoch: state.marketLookupEpoch + 1 };
  });
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
  for (const item of items) {
    if (!item.assetId) continue;
    const id = item.assetId;
    const seed = pendingPatch[id] ?? lookup[id];
    if (!seed) continue;
    const next = mergeWsItemOntoMarket(seed, item);
    if (bidAskWsRowEqual(lookup[id], next)) {
      delete pendingPatch[id];
      continue;
    }
    pendingPatch[id] = next;
  }
  if (Object.keys(pendingPatch).length > 0) scheduleBidAskFlush();
}

export function resetBidAskMarketLookupPending() {
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  for (const k of Object.keys(pendingPatch)) delete pendingPatch[k];
}
