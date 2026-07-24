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
let liveNotifyRaf: number | null = null;
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

/** Coalesce live React notifies to one per frame — huge bidAskBatch dumps must not freeze UI. */
function scheduleLiveNotify() {
  if (liveNotifyRaf != null) return;
  liveNotifyRaf = requestAnimationFrame(() => {
    liveNotifyRaf = null;
    notifyBidAskMarketLookupLiveListeners();
  });
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

function pickWsFieldsFromMarket(old: Market): Partial<Market> {
  const ws: Partial<Market> = {};
  for (const k of BIDASK_EQ_KEYS) {
    const v = old[k];
    if (v !== undefined && v !== null) (ws as Record<string, unknown>)[k as string] = v;
  }
  return ws;
}

function cloneMarketForClobToken(m: Market, tokenId: string, prevLookup: Record<string, Market>): Market {
  const tids = m.clobTokenIds || [];
  const prev = prevLookup[tokenId];
  const ws = prev ? pickWsFieldsFromMarket(prev) : {};
  if (tids[1] === tokenId) {
    return { ...m, ...ws, bestBid: undefined, bestAsk: undefined };
  }
  return { ...m, ...ws };
}

/** Token → market seed — rebuilt when market arrays change. Avoids O(all markets) per WS item. */
let seedIndex: Map<string, Market> | null = null;
let seedIndexGen = 0;
let lastSeedIndexGen = -1;

function bumpSeedIndex(): void {
  seedIndexGen += 1;
  seedIndex = null;
}

function indexMarketList(map: Map<string, Market>, markets: Market[]): void {
  for (const m of markets) {
    for (const tid of m.clobTokenIds || []) {
      const id = String(tid || '').trim();
      if (id && !map.has(id)) map.set(id, m);
    }
  }
}

function getOrBuildSeedIndex(): Map<string, Market> {
  if (seedIndex && lastSeedIndexGen === seedIndexGen) return seedIndex;
  const state = useAppStore.getState();
  const map = new Map<string, Market>();
  for (const asset of Object.keys(state.upOrDownMarkets)) {
    for (const tf of Object.keys(state.upOrDownMarkets[asset] || {})) {
      indexMarketList(map, state.upOrDownMarkets[asset][tf] || []);
    }
  }
  for (const asset of Object.keys(state.aboveMarkets)) {
    indexMarketList(map, state.aboveMarkets[asset] || []);
  }
  for (const asset of Object.keys(state.priceOnMarkets)) {
    indexMarketList(map, state.priceOnMarkets[asset] || []);
  }
  for (const asset of Object.keys(state.weeklyHitMarkets)) {
    indexMarketList(map, state.weeklyHitMarkets[asset] || []);
  }
  for (const city of Object.keys(state.weatherMarkets)) {
    indexMarketList(map, state.weatherMarkets[city] || []);
  }
  seedIndex = map;
  lastSeedIndexGen = seedIndexGen;
  return map;
}

// Invalidate seed index when market buckets change (not on every bid/ask flush).
useAppStore.subscribe((state, prev) => {
  if (
    state.upOrDownMarkets !== prev.upOrDownMarkets ||
    state.aboveMarkets !== prev.aboveMarkets ||
    state.priceOnMarkets !== prev.priceOnMarkets ||
    state.weeklyHitMarkets !== prev.weeklyHitMarkets ||
    state.weatherMarkets !== prev.weatherMarkets
  ) {
    bumpSeedIndex();
    // Stubs may have landed before Gamma buckets — promote them now.
    queueMicrotask(() => upgradeWsStubsInMarketLookup());
  }
});

/** True when row is a quote-only stub (no Gamma id / title) from bid/ask before markets load. */
export function isWsBidAskStubMarket(m: Market | null | undefined): boolean {
  if (!m) return true;
  const id = String(m.id || '').trim();
  if (id.startsWith('ws:') || id.startsWith('expired:')) return true;
  if (!(m.question || '').trim() && !(m.conditionId || '').trim()) return true;
  return false;
}

/**
 * Canonical market for a CLOB token: Gamma/weather seed wins over stale `ws:` stubs in lookup.
 * Keeps live bid/ask fields from pending/lookup via cloneMarketForClobToken.
 */
export function resolveCanonicalMarketForToken(tokenId: string): Market | undefined {
  const id = String(tokenId || '').trim();
  if (!id) return undefined;
  const state = useAppStore.getState();
  const pending = pendingPatch[id];
  const seed = getOrBuildSeedIndex().get(id);
  if (seed) {
    const prevLookup = pending
      ? { ...state.marketLookup, [id]: pending }
      : state.marketLookup;
    return cloneMarketForClobToken(seed, id, prevLookup);
  }
  if (pending) return pending;
  return state.marketLookup[id];
}

/** Seed row for WS bid/ask merge when token not yet in marketLookup (e.g. new up/down market). */
export function resolveBidAskSeedMarket(assetId: string): Market | undefined {
  const id = String(assetId || '').trim();
  if (!id) return undefined;
  const canonical = resolveCanonicalMarketForToken(id);
  if (canonical) return canonical;

  return {
    id: `ws:${id}`,
    clobTokenIds: [id],
    question: '',
    endDate: '',
    conditionId: '',
    eventSlug: '',
  };
}

/** After markets refresh: replace quote-only `ws:` stubs in marketLookup with Gamma rows. */
export function upgradeWsStubsInMarketLookup(): void {
  const state = useAppStore.getState();
  const lookup = state.marketLookup;
  const seed = getOrBuildSeedIndex();
  let merged: Record<string, Market> | null = null;
  for (const [tid, row] of Object.entries(lookup)) {
    if (!isWsBidAskStubMarket(row)) continue;
    const s = seed.get(tid);
    if (!s) continue;
    const next = cloneMarketForClobToken(s, tid, lookup);
    if (merged == null) merged = { ...lookup };
    merged[tid] = next;
  }
  if (merged) {
    useAppStore.setState({ marketLookup: merged });
  }
}

const BIDASK_BATCH_CHUNK = 80;
let bidAskChunkQueue: BidAskWsItem[] = [];
let bidAskChunkRaf: number | null = null;
let bidAskChunkDrainTouched = false;

function processBidAskChunk(): void {
  bidAskChunkRaf = null;
  if (bidAskChunkQueue.length === 0) return;
  const chunk = bidAskChunkQueue.splice(0, BIDASK_BATCH_CHUNK);
  const more = bidAskChunkQueue.length > 0;
  // Defer live React notify until queue drained — mid-dump setState freezes clicks.
  if (applyBidAskMarketPatches(chunk, { notifyLive: false })) {
    bidAskChunkDrainTouched = true;
  }
  if (more) {
    bidAskChunkRaf = requestAnimationFrame(processBidAskChunk);
    return;
  }
  if (bidAskChunkDrainTouched) {
    bidAskChunkDrainTouched = false;
    scheduleLiveNotify();
  }
}

function applyBidAskMarketPatches(
  items: BidAskWsItem[],
  opts?: { notifyLive?: boolean },
): boolean {
  const notifyLive = opts?.notifyLive !== false;
  const lookup = useAppStore.getState().marketLookup;
  let touched = false;
  for (const item of items) {
    if (!item.assetId) continue;
    const id = item.assetId;
    const seed = resolveBidAskSeedMarket(id);
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
    if (notifyLive) scheduleLiveNotify();
    scheduleGridLiveCoalesceNotify();
  }
  if (Object.keys(pendingPatch).length > 0) scheduleBidAskFlush();
  return touched;
}

export function enqueueBidAskMarketPatches(items: BidAskWsItem[]) {
  if (items.length === 0) return;
  // Small live ticks: apply sync. Huge reconnect dumps: chunk across frames.
  if (items.length <= BIDASK_BATCH_CHUNK && bidAskChunkQueue.length === 0) {
    applyBidAskMarketPatches(items);
    return;
  }
  bidAskChunkQueue.push(...items);
  if (bidAskChunkRaf == null) {
    bidAskChunkRaf = requestAnimationFrame(processBidAskChunk);
  }
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
  if (liveNotifyRaf != null) {
    cancelAnimationFrame(liveNotifyRaf);
    liveNotifyRaf = null;
  }
  if (bidAskChunkRaf != null) {
    cancelAnimationFrame(bidAskChunkRaf);
    bidAskChunkRaf = null;
  }
  bidAskChunkQueue = [];
  bidAskChunkDrainTouched = false;
  for (const k of Object.keys(pendingPatch)) delete pendingPatch[k];
}
