import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';

/** Grid store flush for bid/ask + lookup fields — sidebar uses `getBidAskMarketRow` (unthrottled). */
export const BID_ASK_LOOKUP_FLUSH_MS = 2000;
export const GRID_BID_ASK_THROTTLE_MS = BID_ASK_LOOKUP_FLUSH_MS;
/**
 * Coalesce live WS → grid flush listeners (useThrottledBidAskPair / grid cells).
 * Keep short — longer windows made bid/ask feel non-realtime. Click starvation is
 * handled by not using startTransition on this path (not by deferring quotes).
 */
export const GRID_BID_ASK_LIVE_COALESCE_MS = 100;

/** No-op retained for callers; interaction deferral was starving live quotes. */
export function noteUserInteractionForBidAsk(): void {
  /* intentionally empty — see GRID_BID_ASK_LIVE_COALESCE_MS comment */
}

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
/**
 * WS-only top of book. Gamma/marketLookup polls must never overwrite these — that was the
 * correct↔wrong bid/ask flicker (live WS vs stale Gamma bestBid on the same Market row).
 */
type LiveTopOfBook = { bestBid: number; bestAsk: number };
const liveTopOfBook = new Map<string, LiveTopOfBook>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let gridLiveCoalesceTimer: ReturnType<typeof setTimeout> | null = null;
/** Caps live notify delay — timer-only (no rAF; background tabs throttle rAF ~1/min). */
let liveNotifyTimeout: ReturnType<typeof setTimeout> | null = null;
const LIVE_NOTIFY_MAX_DELAY_MS = 50;
const bidAskLookupLiveListeners = new Set<() => void>();
const bidAskLookupGridFlushListeners = new Set<() => void>();
let bidAskGridFlushDigest = 0;

function tokenIdCandidates(tokenId: string): string[] {
  const id = String(tokenId || '').trim();
  if (!id) return [];
  const out = [id];
  try {
    const norm = BigInt(id).toString();
    if (norm !== id) out.push(norm);
  } catch {
    /* not an int token */
  }
  return out;
}

function getLiveTopOfBook(tokenId: string): LiveTopOfBook | undefined {
  for (const key of tokenIdCandidates(tokenId)) {
    const hit = liveTopOfBook.get(key);
    if (hit) return hit;
  }
  return undefined;
}

/** Record WS bestBid/bestAsk for all id forms. Returns true if sides changed. */
function setLiveTopOfBook(
  tokenId: string,
  bestBid: number | undefined,
  bestAsk: number | undefined,
): boolean {
  const keys = tokenIdCandidates(tokenId);
  if (keys.length === 0) return false;
  const prev = getLiveTopOfBook(tokenId);
  const next: LiveTopOfBook = {
    bestBid: bestBid !== undefined && Number.isFinite(bestBid) ? bestBid : (prev?.bestBid ?? 0),
    bestAsk: bestAsk !== undefined && Number.isFinite(bestAsk) ? bestAsk : (prev?.bestAsk ?? 0),
  };
  if (prev && prev.bestBid === next.bestBid && prev.bestAsk === next.bestAsk) return false;
  for (const k of keys) liveTopOfBook.set(k, next);
  return true;
}

function applyLiveTopOfBookToRow(row: Market, tokenId: string): Market {
  const tob = getLiveTopOfBook(tokenId);
  if (!tob) return row;
  if (row.bestBid === tob.bestBid && row.bestAsk === tob.bestAsk) return row;
  return { ...row, bestBid: tob.bestBid, bestAsk: tob.bestAsk };
}

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
  for (const listener of bidAskLookupLiveListeners) {
    try {
      listener();
    } catch (err) {
      console.warn('[bidAsk] live listener error:', err);
    }
  }
}

/**
 * Coalesce live React notifies on a short timer only.
 * Do NOT use requestAnimationFrame as the primary path — Chrome throttles rAF to
 * ~1/min in background (and under load), which made TPO bid/ask lag for minutes.
 */
function scheduleLiveNotify() {
  if (liveNotifyTimeout != null) return;
  liveNotifyTimeout = setTimeout(() => {
    liveNotifyTimeout = null;
    notifyBidAskMarketLookupLiveListeners();
  }, LIVE_NOTIFY_MAX_DELAY_MS);
}

function notifyBidAskMarketLookupGridFlushListeners() {
  bidAskGridFlushDigest += 1;
  // Sync notify after coalesce timer — do NOT startTransition here.
  for (const listener of bidAskLookupGridFlushListeners) {
    try {
      listener();
    } catch (err) {
      console.warn('[bidAsk] grid listener error:', err);
    }
  }
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

  // Live readers use pending/liveTopOfBook; grid listeners wake on digest bump.
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

/**
 * Stable snapshot cache for useSyncExternalStore consumers.
 * Returning a new object every getSnapshot() (even with same bid/ask) causes
 * infinite re-renders / React #185 and makes quotes look frozen after recovery.
 */
const getRowSnapCache = new Map<string, Market>();

/**
 * Latest market row for a CLOB token.
 * bestBid/bestAsk always prefer the WS-only top-of-book map when present — never let
 * Gamma poll values on marketLookup fight live books (that caused correct↔wrong flicker).
 */
export function getBidAskMarketRow(tokenId: string): Market | undefined {
  const id = String(tokenId || '').trim();
  if (!id) return undefined;
  const candidates = tokenIdCandidates(id);
  let base: Market | undefined;
  for (const key of candidates) {
    const pending = pendingPatch[key];
    if (pending) {
      base = pending;
      break;
    }
  }
  if (!base) {
    const lookup = useAppStore.getState().marketLookup;
    for (const key of candidates) {
      const row = lookup[key];
      if (row) {
        base = row;
        break;
      }
    }
  }
  const tob = getLiveTopOfBook(id);
  let next: Market | undefined;
  if (!base) {
    // WS quote arrived before Gamma row — still surface live top of book.
    if (!tob) {
      getRowSnapCache.delete(id);
      return undefined;
    }
    next = {
      id: `ws:${id}`,
      clobTokenIds: [id],
      question: '',
      endDate: '',
      conditionId: '',
      eventSlug: '',
      bestBid: tob.bestBid,
      bestAsk: tob.bestAsk,
    };
  } else {
    next = applyLiveTopOfBookToRow(base, id);
  }

  const cacheKey = candidates[0] || id;
  const prev = getRowSnapCache.get(cacheKey);
  if (prev && bidAskWsRowEqual(prev, next) && prev.bestBid === next.bestBid && prev.bestAsk === next.bestAsk) {
    return prev;
  }
  getRowSnapCache.set(cacheKey, next);
  // Alias normalized forms to same snap so dual-key readers share identity.
  for (const k of candidates) {
    if (k !== cacheKey) getRowSnapCache.set(k, next);
  }
  return next;
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
/** rAF id or setTimeout id — both cancelled via clearTimeout + cancelAnimationFrame. */
let bidAskChunkTimer: number | null = null;
let bidAskChunkDrainTouched = false;

function clearBidAskChunkTimer(): void {
  if (bidAskChunkTimer == null) return;
  cancelAnimationFrame(bidAskChunkTimer);
  clearTimeout(bidAskChunkTimer);
  bidAskChunkTimer = null;
}

function scheduleBidAskChunkContinue(): void {
  if (bidAskChunkTimer != null) return;
  bidAskChunkTimer = requestAnimationFrame(() => {
    bidAskChunkTimer = null;
    processBidAskChunk();
  });
}

function processBidAskChunk(): void {
  bidAskChunkTimer = null;
  if (bidAskChunkQueue.length === 0) return;
  const chunk = bidAskChunkQueue.splice(0, BIDASK_BATCH_CHUNK);
  const more = bidAskChunkQueue.length > 0;
  // Notify live every chunk so UI is not frozen until the full dump drains.
  if (applyBidAskMarketPatches(chunk, { notifyLive: true })) {
    bidAskChunkDrainTouched = true;
  }
  if (more) {
    scheduleBidAskChunkContinue();
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
    const id = String(item.assetId).trim();
    if (!id) continue;

    // WS top-of-book is authoritative for bid/ask display (isolated from Gamma).
    const tobChanged =
      item.bestBid !== undefined || item.bestAsk !== undefined
        ? setLiveTopOfBook(
            id,
            item.bestBid !== undefined ? Number(item.bestBid) || 0 : undefined,
            item.bestAsk !== undefined ? Number(item.bestAsk) || 0 : undefined,
          )
        : false;

    const seed = resolveBidAskSeedMarket(id);
    if (!seed) {
      if (tobChanged) touched = true;
      continue;
    }
    // Merge non-quote fields onto seed; then force bid/ask from live top-of-book.
    let next = mergeWsItemOntoMarket(seed, item);
    const tob = getLiveTopOfBook(id);
    if (tob) {
      next = { ...next, bestBid: tob.bestBid, bestAsk: tob.bestAsk };
    }

    // Compare quote sides + row identity for non-quote churn.
    const current = getBidAskMarketRow(id);
    const quoteSame =
      !!current &&
      current.bestBid === next.bestBid &&
      current.bestAsk === next.bestAsk &&
      !tobChanged;
    if (quoteSame && bidAskWsRowEqual(current, next)) {
      continue;
    }
    for (const key of tokenIdCandidates(id)) {
      pendingPatch[key] = next;
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
  if (bidAskChunkTimer == null) {
    scheduleBidAskChunkContinue();
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
  if (liveNotifyTimeout != null) {
    clearTimeout(liveNotifyTimeout);
    liveNotifyTimeout = null;
  }
  clearBidAskChunkTimer();
  bidAskChunkQueue = [];
  bidAskChunkDrainTouched = false;
  for (const k of Object.keys(pendingPatch)) delete pendingPatch[k];
  liveTopOfBook.clear();
  getRowSnapCache.clear();
}
