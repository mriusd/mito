import { startTransition } from 'react';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';

/** Grid store flush for bid/ask + lookup fields — sidebar uses `getBidAskMarketRow` (unthrottled). */
export const BID_ASK_LOOKUP_FLUSH_MS = 2000;
export const GRID_BID_ASK_THROTTLE_MS = BID_ASK_LOOKUP_FLUSH_MS;
/**
 * Coalesce live WS → grid flush listeners (useThrottledBidAskPair / grid cells).
 * Was 2s (matched store flush) — bid/ask looked multi-minute stale under load when
 * pending was cleared before store committed. 250ms keeps books usable without
 * per-tick full-grid storms.
 */
export const GRID_BID_ASK_LIVE_COALESCE_MS = 250;

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
  /** Backend tokenRegistry / onchain prep — fills empty `ws:` stubs. */
  marketId?: string;
  question?: string;
  eventSlug?: string;
  endDate?: string;
  conditionId?: string;
  slug?: string;
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

  // Backend title/ids — fill empty stubs (upgrade `ws:` id → Gamma numeric id).
  const q = typeof item.question === 'string' ? item.question.trim() : '';
  if (q && q !== (seed.question || '').trim()) {
    patch.question = q;
    changed = true;
  }
  const mid = typeof item.marketId === 'string' ? item.marketId.trim() : '';
  if (
    mid &&
    (isWsBidAskStubMarket(seed) || !(seed.id || '').trim() || String(seed.id).startsWith('ws:'))
  ) {
    patch.id = mid;
    changed = true;
  }
  const cond = typeof item.conditionId === 'string' ? item.conditionId.trim() : '';
  if (cond && cond !== (seed.conditionId || '').trim()) {
    patch.conditionId = cond;
    changed = true;
  }
  const es = typeof item.eventSlug === 'string' ? item.eventSlug.trim() : '';
  if (es && es !== (seed.eventSlug || '').trim()) {
    patch.eventSlug = es;
    changed = true;
  }
  const ed = typeof item.endDate === 'string' ? item.endDate.trim() : '';
  if (ed && ed !== (seed.endDate || '').trim()) {
    patch.endDate = ed;
    changed = true;
  }
  const slug = typeof item.slug === 'string' ? item.slug.trim() : '';
  if (slug && slug !== ((seed as { slug?: string }).slug || '').trim()) {
    (patch as { slug?: string }).slug = slug;
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
  // Transition: keep weather-map / drag rAF on the immediate lane.
  startTransition(() => {
    for (const listener of bidAskLookupGridFlushListeners) listener();
  });
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

  // Snapshot only — do NOT clear pending before store commit.
  // Old code deleted pending then applied setState inside startTransition; under load
  // the transition lagged seconds–minutes while getBidAskMarketRow fell back to the
  // still-stale store → bid/ask appeared frozen.
  const snapshot: Record<string, Market> = {};
  for (const id of ids) {
    snapshot[id] = pendingPatch[id]!;
  }

  // Sync merge into marketLookup so readers never see a pending-cleared/store-stale gap.
  useAppStore.setState((state) => {
    const lookup = state.marketLookup;
    let merged = lookup;
    let bumped = false;
    for (const id of ids) {
      let next = snapshot[id];
      if (!next) continue;
      const baseline = lookup[id];
      // Never replace a real Gamma row with a quote-only stub (kills titles → TPO shows token ints).
      if (baseline && !isWsBidAskStubMarket(baseline) && isWsBidAskStubMarket(next)) {
        next = { ...baseline, ...pickWsFieldsFromMarket(next) };
      }
      if (bidAskWsRowEqual(baseline, next)) continue;
      if (merged === lookup) merged = { ...lookup };
      merged[id] = next;
      bumped = true;
    }
    if (!bumped) return {};
    // Intentionally do NOT bump marketLookupEpoch — live grids use pending/patch
    // listeners; epoch bump would re-render every snapshot consumer every flush.
    return { marketLookup: merged };
  });

  // Drop only patches that were not superseded by a newer WS tick during the merge.
  for (const id of ids) {
    if (pendingPatch[id] === snapshot[id]) {
      delete pendingPatch[id];
    }
  }

  // Grid listeners can stay deprioritized; live readers already use pending/sync store.
  startTransition(() => {
    notifyBidAskMarketLookupGridFlushListeners();
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
  const candidates = [id];
  // Lookup / WS keys sometimes differ by BigInt decimal form (leading zeros).
  try {
    const norm = BigInt(id).toString();
    if (norm !== id) candidates.push(norm);
  } catch {
    /* not an int token */
  }
  for (const key of candidates) {
    const pending = pendingPatch[key];
    if (pending) return pending;
  }
  const lookup = useAppStore.getState().marketLookup;
  for (const key of candidates) {
    const row = lookup[key];
    if (row) return row;
  }
  return undefined;
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
  const seedMap = getOrBuildSeedIndex();
  const candidates = [id];
  // Bid/ask keys and Gamma clob ids sometimes differ by leading zeros / decimal form.
  try {
    const norm = BigInt(id).toString();
    if (norm !== id) candidates.push(norm);
  } catch {
    /* not an int token */
  }

  for (const key of candidates) {
    const seed = seedMap.get(key);
    if (!seed) continue;
    const pending = pendingPatch[key] ?? pendingPatch[id];
    const prevLookup = pending
      ? { ...state.marketLookup, [key]: pending, [id]: pending }
      : state.marketLookup;
    return cloneMarketForClobToken(seed, key, prevLookup);
  }

  for (const key of candidates) {
    const pending = pendingPatch[key];
    if (pending && !isWsBidAskStubMarket(pending)) return pending;
  }
  for (const key of candidates) {
    const row = state.marketLookup[key];
    if (row && !isWsBidAskStubMarket(row)) return row;
  }
  for (const key of candidates) {
    if (pendingPatch[key]) return pendingPatch[key];
    if (state.marketLookup[key]) return state.marketLookup[key];
  }
  return undefined;
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
    let s = seed.get(tid);
    if (!s) {
      try {
        s = seed.get(BigInt(tid).toString());
      } catch {
        s = undefined;
      }
    }
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
  // Notify live every chunk so UI is not frozen until the full dump drains.
  if (applyBidAskMarketPatches(chunk, { notifyLive: true })) {
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
  let touched = false;
  for (const item of items) {
    if (!item.assetId) continue;
    const id = item.assetId;
    const seed = resolveBidAskSeedMarket(id);
    if (!seed) continue;
    const next = mergeWsItemOntoMarket(seed, item);
    // Compare against pending+store (getBidAskMarketRow), not store-only — otherwise a
    // live pending tick can look "equal" to a wrong baseline and get discarded.
    const current = getBidAskMarketRow(id);
    if (bidAskWsRowEqual(current, next)) {
      continue;
    }
    pendingPatch[id] = next;
    // Also index normalized form so getBidAskMarketRow candidates hit the same row.
    try {
      const norm = BigInt(id).toString();
      if (norm !== id) pendingPatch[norm] = next;
    } catch {
      /* not an int token */
    }
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
  // Small live ticks always apply immediately — never queue behind a reconnect dump
  // (that backlog made bid/ask lag for minutes while chunks drained).
  if (items.length <= BIDASK_BATCH_CHUNK) {
    applyBidAskMarketPatches(items);
    return;
  }
  // Large dumps only: chunk across frames so the main thread stays responsive.
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
