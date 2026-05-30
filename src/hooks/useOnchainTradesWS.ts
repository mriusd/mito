import { useCallback, useEffect, useRef, useState } from 'react';
import { setSidebarOnchainLiveTrades } from '../lib/sidebarOnchainTradesStore';
import { fetchOnchainMarketPositions, fetchOnchainMarketTrades } from '../api';
import type { WalletPosition } from '../api';
import { API_BASE, WS_BASE } from '../lib/env';
import { dedupeWalletTradesByLedgerLeg, onchainFillKey, walletTradeKey } from '../lib/tradeKeys';
import type { LiveTrade } from './usePolymarketOB';

/** Cap sidebar / chart tape arrays — 3500 rows × lucide-SVG anchors held hundreds of MB of detached DOM after a few market switches. */
const MAX_TRADES = 400;
const WALLET_TRADES_CAP = 400;
const WALLET_MARKET_TRADES_CAP = 500;
/** Mempool pending rows — unbounded retention blew multi-GB heaps overnight. */
const PENDING_TTL_MS = 12 * 60 * 1000;
const MAX_PENDING_PER_SCOPE = 40;
const MAX_PENDING_TAPE_ROWS = 25;
const PENDING_SWEEP_MS = 60_000;

interface OnchainFillRow {
  makerAmount?: number;
  takerAmount?: number;
  makerAssetId?: string;
  takerAssetId?: string;
  blockNumber?: number;
  blockTime?: number;
  logIndex?: number;
  txHash?: string;
  tokenId?: string;
}

/** Polymarket condition id (hex) — preferred for live tape: all YES+NO fills on this market. */
export type OnchainTradesWSOpts = {
  marketId?: string | null;
  /** Fallback when condition id missing — single outcome CLOB token id */
  tokenId?: string | null;
  wallet?: string | null;
  /** YES+NO CLOB ids for selected market: scopes wallet snapshot + fast REST prefetch (WS last-100 is global). */
  scopedClobTokenIds?: string[] | null;
};

export function canonicalConditionKey(id: string): string {
  let h = id.trim().toLowerCase();
  if (!h) return '';
  if (!h.startsWith('0x')) h = `0x${h}`;
  const body = h.slice(2);
  if (!/^[0-9a-f]+$/.test(body) || body.length > 64) return h;
  if (body.length < 64) return `0x${body.padStart(64, '0')}`;
  return h;
}

function normalizeClobTokenKey(id: string | null | undefined): string {
  const s = String(id ?? '').trim();
  if (!s) return '';
  try {
    return BigInt(s).toString();
  } catch {
    return s;
  }
}

function sameDecimalTokenId(a: string | null | undefined, b: string | null | undefined): boolean {
  const sa = String(a ?? '').trim();
  const sb = String(b ?? '').trim();
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  try {
    return BigInt(sa) === BigInt(sb);
  } catch {
    return false;
  }
}

/** Survives market switches: seed sidebar tape from WS rows already received this session. */
const ONCHAIN_PUBLIC_TAPE_BUFFER_CAP = 500;

type BufferedPublicTapeRow = LiveTrade & { __m: string; __tok: string };
const onchainPublicTapeBuffer: BufferedPublicTapeRow[] = [];

function stampLiveTradeId(t: LiveTrade): LiveTrade {
  if (t.id) return t;
  const id = onchainFillKey(t.txHash, t.logIndex);
  return id ? { ...t, id } : t;
}

function liveTradeDedupeKey(t: Pick<LiveTrade, 'id' | 'txHash' | 'logIndex'>): string {
  return t.id || onchainFillKey(t.txHash, t.logIndex);
}

function prependDedupedSortedTape(prev: LiveTrade[], t: LiveTrade, cap: number): LiveTrade[] {
  const stamped = stampLiveTradeId(t);
  const key = liveTradeDedupeKey(stamped);
  // Confirmed (non-pending) row supersedes any pending row with same txHash.
  const incomingTx = stamped.pending ? '' : (stamped.txHash || '').toLowerCase();
  const filterPendingForTx = (rows: LiveTrade[]) => {
    if (!incomingTx) return rows;
    return rows.filter((x) => !(x.pending && (x.txHash || '').toLowerCase() === incomingTx));
  };
  if (!key) {
    const merged = filterPendingForTx([stamped, ...prev]);
    merged.sort((a, b) => {
      const td = (b.timestamp ?? 0) - (a.timestamp ?? 0);
      if (td !== 0) return td;
      return (b.logIndex ?? 0) - (a.logIndex ?? 0);
    });
    return merged.slice(0, cap);
  }
  const byKey = new Map<string, LiveTrade>();
  byKey.set(key, stamped);
  for (const x of prev) {
    const k = liveTradeDedupeKey(x);
    if (!k || k === key) continue;
    byKey.set(k, x.id ? x : stampLiveTradeId(x));
  }
  const merged = filterPendingForTx(Array.from(byKey.values()));
  merged.sort((a, b) => {
    const td = (b.timestamp ?? 0) - (a.timestamp ?? 0);
    if (td !== 0) return td;
    return (b.logIndex ?? 0) - (a.logIndex ?? 0);
  });
  return finalizeLiveTapeRows(merged, cap);
}

function dropPendingByTx(prev: LiveTrade[], txHashes: Set<string>): LiveTrade[] {
  if (txHashes.size === 0) return prev;
  return prev.filter((x) => !(x.pending && txHashes.has((x.txHash || '').toLowerCase())));
}

function dropPendingFromPublicTapeBuffer(txHashes: Set<string>): void {
  if (txHashes.size === 0) return;
  for (let i = onchainPublicTapeBuffer.length - 1; i >= 0; i--) {
    const row = onchainPublicTapeBuffer[i];
    if (!row.pending) continue;
    const tx = (row.txHash || '').toLowerCase();
    if (tx && txHashes.has(tx)) {
      onchainPublicTapeBuffer.splice(i, 1);
    }
  }
}

function stripSupersededPendingTape(rows: LiveTrade[]): LiveTrade[] {
  const confirmedTxs = new Set(
    rows.filter((r) => !r.pending).map((r) => (r.txHash || '').toLowerCase()).filter(Boolean),
  );
  if (confirmedTxs.size === 0) return rows;
  return rows.filter((r) => !(r.pending && confirmedTxs.has((r.txHash || '').toLowerCase())));
}

function pendingLiveTradeAgeMs(t: LiveTrade): number {
  const ts = Number(t.timestamp ?? 0);
  if (Number.isFinite(ts) && ts > 0) return Date.now() - ts;
  return 0;
}

function pendingWSTradeAgeMs(t: WSTrade): number {
  const bt = Number(t.blockTime ?? 0);
  if (Number.isFinite(bt) && bt > 0) {
    const ms = bt > 1e12 ? bt : bt * 1000;
    return Date.now() - ms;
  }
  return 0;
}

function pruneStalePendingLiveTape(rows: LiveTrade[]): LiveTrade[] {
  return rows.filter((r) => !r.pending || pendingLiveTradeAgeMs(r) <= PENDING_TTL_MS);
}

function capPendingLiveTapeRows(rows: LiveTrade[], maxPending: number): LiveTrade[] {
  if (maxPending <= 0) return rows.filter((r) => !r.pending);
  let pendingCount = 0;
  const out: LiveTrade[] = [];
  for (const r of rows) {
    if (r.pending) {
      if (pendingCount >= maxPending) continue;
      pendingCount += 1;
    }
    out.push(r);
  }
  return out;
}

function finalizeLiveTapeRows(rows: LiveTrade[], cap: number): LiveTrade[] {
  return capPendingLiveTapeRows(pruneStalePendingLiveTape(stripSupersededPendingTape(rows)), MAX_PENDING_TAPE_ROWS).slice(
    0,
    cap,
  );
}

function pushPublicTapeBuffer(t: LiveTrade, marketCanon: string, tokenIdRaw: string) {
  if (t.pending) return;
  const __m = (marketCanon || '').trim();
  const __tok = normalizeClobTokenKey(tokenIdRaw);
  if (!__m && !__tok) return;
  onchainPublicTapeBuffer.unshift({ ...t, __m, __tok });
  if (onchainPublicTapeBuffer.length > ONCHAIN_PUBLIC_TAPE_BUFFER_CAP) {
    onchainPublicTapeBuffer.length = ONCHAIN_PUBLIC_TAPE_BUFFER_CAP;
  }
}

function filterPublicTapeBuffer(mCanon: string | null, tokenSub: string | null): LiveTrade[] {
  if (!mCanon && !tokenSub) return [];
  const out: LiveTrade[] = [];
  for (const row of onchainPublicTapeBuffer) {
    const { __m, __tok, ...rest } = row;
    if (mCanon) {
      if (!__m || canonicalConditionKey(__m) !== mCanon) continue;
    } else if (tokenSub) {
      if (!sameDecimalTokenId(__tok, tokenSub)) continue;
    } else {
      continue;
    }
    if (rest.pending) continue;
    out.push(rest.tokenId ? rest : __tok ? { ...rest, tokenId: __tok } : rest);
  }
  const seen = new Set<string>();
  const deduped: LiveTrade[] = [];
  for (const t of out) {
    const k = liveTradeDedupeKey(t);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(t.id ? t : stampLiveTradeId(t));
  }
  deduped.sort((a, b) => {
    const td = (b.timestamp ?? 0) - (a.timestamp ?? 0);
    if (td !== 0) return td;
    return (b.logIndex ?? 0) - (a.logIndex ?? 0);
  });
  return deduped.slice(0, MAX_TRADES);
}

function mergePublicLiveTapes(apiRows: LiveTrade[], fromBuffer: LiveTrade[]): LiveTrade[] {
  const confirmedTxs = new Set(
    apiRows.map((r) => (r.txHash || '').toLowerCase()).filter(Boolean),
  );
  const byKey = new Map<string, LiveTrade>();
  for (const t of apiRows) {
    const stamped = stampLiveTradeId(t);
    const k = liveTradeDedupeKey(stamped);
    if (k) byKey.set(k, stamped);
  }
  for (const t of fromBuffer) {
    const tx = (t.txHash || '').toLowerCase();
    if (t.pending && tx && confirmedTxs.has(tx)) continue;
    const row = t.id ? t : stampLiveTradeId(t);
    const k = liveTradeDedupeKey(row);
    if (!k || byKey.has(k)) continue;
    byKey.set(k, row);
  }
  const merged = Array.from(byKey.values());
  merged.sort((a, b) => {
    const td = (b.timestamp ?? 0) - (a.timestamp ?? 0);
    if (td !== 0) return td;
    return (b.logIndex ?? 0) - (a.logIndex ?? 0);
  });
  return stripSupersededPendingTape(merged).slice(0, MAX_TRADES);
}

/** Wall-clock ms from API blockTime, or a spread relative to `now` from block height when blockTime is missing. */
function tradeTimestampMs(f: OnchainFillRow, maxBlock: number, nowMs: number): number {
  const bt = Number(f.blockTime ?? 0);
  let ms: number;
  if (bt > 0) {
    ms = bt >= 1_000_000_000_000 ? bt : bt * 1000;
  } else {
    const bn = Number(f.blockNumber ?? 0);
    const li = Number(f.logIndex ?? 0);
    if (bn > 0 && maxBlock > 0) {
      ms = nowMs - (maxBlock - bn) * 2100 - li;
    } else {
      ms = nowMs;
    }
  }
  return Math.min(ms, nowMs);
}

export interface WSPosition {
  tokenId: string;
  size: number;
  avgPrice: number;
  feesPaid?: number;
  title?: string;
  slug?: string;
  eventSlug?: string;
  marketId?: string;
  outcome?: string;
  endDate?: string;
  underlyingAsset?: string;
}

function mapRawWSPosition(p: Record<string, unknown>): WSPosition | null {
  const tokenId = String(p.tokenId || '');
  const size = Number(p.size || 0);
  if (!tokenId || size <= 0) return null;
  return {
    tokenId,
    size,
    avgPrice: Number(p.avgPrice || 0),
    feesPaid: p.feesPaid != null ? Number(p.feesPaid) : undefined,
    title: typeof p.title === 'string' ? p.title : undefined,
    slug: typeof p.slug === 'string' ? p.slug : undefined,
    eventSlug: typeof p.eventSlug === 'string' ? p.eventSlug : undefined,
    marketId: typeof p.marketId === 'string' ? p.marketId : undefined,
    outcome: typeof p.outcome === 'string' ? p.outcome : undefined,
    endDate: typeof p.endDate === 'string' ? p.endDate : undefined,
    underlyingAsset: typeof p.underlyingAsset === 'string' ? p.underlyingAsset : undefined,
  };
}

function mergeWalletPositionsSnapshot(
  prev: WSPosition[],
  incoming: WSPosition[],
  scopedTokenIds: string[] | null | undefined,
): WSPosition[] {
  const scoped = new Set(
    (scopedTokenIds || []).map((x) => normalizeClobTokenKey(x)).filter(Boolean),
  );
  const live = incoming.filter((p) => !!p.tokenId && p.size > 0);
  if (scoped.size === 0) return live;

  const byTok = new Map<string, WSPosition>();
  for (const p of prev) {
    const k = normalizeClobTokenKey(p.tokenId);
    if (!k || scoped.has(k) || p.size <= 0) continue;
    byTok.set(k, p);
  }
  for (const p of live) {
    const k = normalizeClobTokenKey(p.tokenId);
    if (!k || !scoped.has(k)) continue;
    const prev = byTok.get(k);
    if (prev) {
      let avgPrice = p.avgPrice;
      // Do not keep stale avg when size changed — backend may send avgPrice=0 until ledger row catches up.
      if (avgPrice <= 0 && Math.abs(p.size - prev.size) <= 1e-6) {
        avgPrice = prev.avgPrice;
      }
      byTok.set(k, { ...p, avgPrice });
    } else {
      byTok.set(k, p);
    }
  }
  return [...byTok.values()];
}

export interface WSTrade {
  /** Stable dedupe key — set once at ingest. */
  id?: string;
  /** Mempool overlay — superseded by ledger row with same txHash. */
  pending?: boolean;
  /** true = LIMIT/approx price from calldata fast path; replaced by trace broadcast. */
  priceApproximate?: boolean;
  tokenId: string;
  side: 'BUY' | 'SELL' | 'SPLIT' | 'MERGE' | 'REDEEM';
  outcome?: string;
  size: number;
  price: number;
  fee: number;
  deltaUsd?: number;
  isTaker?: boolean;
  blockTime: number;
  txHash?: string;
  /** Same tx can have multiple OrderFilled logs — required for dedupe. */
  logIndex?: number;
  title?: string;
  slug?: string;
  eventSlug?: string;
}

export type WalletMarketTradesListener = {
  onSnapshot: (trades: WSTrade[], total: number) => void;
  onTrade?: (trade: WSTrade) => void;
  onPendingDrop?: (txHashes: Set<string>) => void;
};

export type OnchainTradesWSShared = {
  subscribeWalletMarketTrades: (wallet: string, marketId: string, listener: WalletMarketTradesListener) => () => void;
  refreshWalletMarketTrades: (wallet: string, marketId: string) => void;
  wsConnected: boolean;
};

let onchainTradesWSShared: OnchainTradesWSShared | null = null;
let onchainTradesWSProviderCount = 0;

/** Stable object identity — wallet-info listeners must not resubscribe when hook callbacks rotate. */
const onchainTradesWSSharedStable: OnchainTradesWSShared = {
  subscribeWalletMarketTrades: () => () => {},
  refreshWalletMarketTrades: () => {},
  wsConnected: false,
};

export function getOnchainTradesWSShared(): OnchainTradesWSShared | null {
  return onchainTradesWSShared;
}

function walletMarketTradesKey(wallet: string, marketId: string): string {
  return `${wallet.trim().toLowerCase()}|${canonicalConditionKey(marketId)}`;
}

const walletMarketPendingByScope = new Map<string, Map<string, WSTrade>>();
/** Scopes with ≥1 wallet-market listener — pending retained only while watched. */
const walletMarketListenerScopeKeys = new Set<string>();
let walletMarketPendingRevision = 0;
const walletMarketPendingStoreListeners = new Set<() => void>();

function bumpWalletMarketPendingStore(): void {
  walletMarketPendingRevision += 1;
  for (const fn of walletMarketPendingStoreListeners) fn();
}

export function subscribeWalletMarketPendingStore(onStoreChange: () => void): () => void {
  walletMarketPendingStoreListeners.add(onStoreChange);
  return () => walletMarketPendingStoreListeners.delete(onStoreChange);
}

export function getWalletMarketPendingStoreRevision(): number {
  return walletMarketPendingRevision;
}

export function getWalletMarketPendingTrades(wallet: string, marketId: string): WSTrade[] {
  const scope = walletMarketPendingByScope.get(walletMarketTradesKey(wallet, marketId));
  if (!scope) return [];
  return [...scope.values()];
}

function pruneWalletMarketPendingMap(byTx: Map<string, WSTrade>): void {
  for (const [tx, row] of byTx) {
    if (pendingWSTradeAgeMs(row) > PENDING_TTL_MS) byTx.delete(tx);
  }
  if (byTx.size <= MAX_PENDING_PER_SCOPE) return;
  const sorted = [...byTx.entries()].sort((a, b) => (a[1].blockTime ?? 0) - (b[1].blockTime ?? 0));
  while (byTx.size > MAX_PENDING_PER_SCOPE) {
    const drop = sorted.shift();
    if (!drop) break;
    byTx.delete(drop[0]);
  }
}

function sweepWalletMarketPendingStore(): void {
  let changed = false;
  for (const [sk, byTx] of walletMarketPendingByScope.entries()) {
    if (!walletMarketListenerScopeKeys.has(sk)) {
      walletMarketPendingByScope.delete(sk);
      changed = true;
      continue;
    }
    const before = byTx.size;
    pruneWalletMarketPendingMap(byTx);
    if (byTx.size === 0) {
      walletMarketPendingByScope.delete(sk);
      changed = true;
    } else if (byTx.size !== before) {
      changed = true;
    }
  }
  if (changed) bumpWalletMarketPendingStore();
}

function upsertWalletMarketPendingScope(wallet: string, marketId: string, row: WSTrade): void {
  const tx = (row.txHash || '').toLowerCase();
  if (!tx) return;
  const sk = walletMarketTradesKey(wallet, marketId);
  if (!walletMarketListenerScopeKeys.has(sk)) return;
  let byTx = walletMarketPendingByScope.get(sk);
  if (!byTx) {
    byTx = new Map();
    walletMarketPendingByScope.set(sk, byTx);
  }
  byTx.set(tx, row);
  pruneWalletMarketPendingMap(byTx);
  if (byTx.size === 0) walletMarketPendingByScope.delete(sk);
  bumpWalletMarketPendingStore();
}

function dropWalletMarketPendingByTx(txHashes: Set<string>): void {
  if (txHashes.size === 0) return;
  let changed = false;
  for (const [sk, byTx] of walletMarketPendingByScope.entries()) {
    for (const tx of txHashes) {
      if (byTx.delete(tx)) changed = true;
    }
    if (byTx.size === 0) walletMarketPendingByScope.delete(sk);
  }
  if (changed) bumpWalletMarketPendingStore();
}

function mapRawWSTrade(t: {
  tokenId?: string;
  side?: string;
  outcome?: string;
  size?: number;
  price?: number;
  fee?: number;
  deltaUsd?: number;
  isTaker?: boolean;
  blockTime?: number;
  txHash?: string;
  logIndex?: number;
  title?: string;
  slug?: string;
  eventSlug?: string;
}): WSTrade | null {
  const tokenId = String(t.tokenId || '');
  const side = normalizeLedgerAction(t.side);
  const logIndex = Number.isFinite(Number(t.logIndex)) ? Number(t.logIndex) : undefined;
  const txHash = t.txHash;
  if (!tokenId && side !== 'SPLIT' && side !== 'MERGE') return null;
  const row: WSTrade = {
    tokenId,
    side,
    outcome: t.outcome ? String(t.outcome) : undefined,
    size: Number(t.size || 0),
    price: Number(t.price || 0),
    fee: Number(t.fee || 0),
    deltaUsd: Number(t.deltaUsd ?? 0),
    isTaker: t.isTaker === true,
    blockTime: Number(t.blockTime || 0),
    txHash,
    logIndex,
    title: t.title,
    slug: t.slug,
    eventSlug: t.eventSlug,
  };
  row.id = walletTradeKey(txHash, logIndex, normalizeClobTokenKey(tokenId), side);
  return row;
}

function normalizeLedgerAction(s: string | undefined): WSTrade['side'] {
  const u = String(s || '').toUpperCase().trim();
  if (u === 'SELL') return 'SELL';
  if (u === 'SPLIT') return 'SPLIT';
  if (u === 'MERGE') return 'MERGE';
  if (u === 'REDEEM') return 'REDEEM';
  if (u === 'BUY') return 'BUY';
  return 'BUY';
}

function mapFetchedTradesToDedupedRows(
  raw: Array<Parameters<typeof mapRawWSTrade>[0]>,
  cap = WALLET_MARKET_TRADES_CAP,
): WSTrade[] {
  const rows = raw
    .map((t) => mapRawWSTrade(t as Parameters<typeof mapRawWSTrade>[0]))
    .filter((t): t is WSTrade => t != null);
  const stamped = rows.map((t) => {
    const k = t.id || walletTradeKey(t.txHash, t.logIndex, normalizeClobTokenKey(t.tokenId), t.side);
    return t.id ? t : { ...t, id: k };
  });
  return dedupeWalletTradesByLedgerLeg(stamped, (t) =>
    t.id || walletTradeKey(t.txHash, t.logIndex, normalizeClobTokenKey(t.tokenId), t.side),
  ).slice(0, cap);
}

function walletMarketTradeRowKey(t: WSTrade): string {
  return t.id || walletTradeKey(t.txHash, t.logIndex, normalizeClobTokenKey(t.tokenId), t.side);
}

function dropPendingWalletMarketByTx(prev: WSTrade[], txHashes: Set<string>): WSTrade[] {
  if (txHashes.size === 0) return prev;
  return prev.filter((t) => !(t.pending && txHashes.has((t.txHash || '').toLowerCase())));
}

function sortWalletMarketTradeRows(rows: WSTrade[]): WSTrade[] {
  return [...rows].sort((a, b) => {
    const ap = a.pending ? 1 : 0;
    const bp = b.pending ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const tb = (b.blockTime ?? 0) - (a.blockTime ?? 0);
    if (tb !== 0) return tb;
    return (b.logIndex ?? 0) - (a.logIndex ?? 0);
  });
}

function mergeWalletMarketSnapshotWithPending(
  prev: WSTrade[],
  snapshot: WSTrade[],
  cap = WALLET_MARKET_TRADES_CAP,
): WSTrade[] {
  const pending = prev.filter((t) => t.pending);
  if (pending.length === 0) return snapshot.slice(0, cap);
  const confirmedTxs = new Set(snapshot.map((t) => (t.txHash || '').toLowerCase()).filter(Boolean));
  const keepPending = pending.filter((p) => !confirmedTxs.has((p.txHash || '').toLowerCase()));
  if (keepPending.length === 0) return snapshot.slice(0, cap);
  return sortWalletMarketTradeRows(
    dedupeWalletTradesByLedgerLeg([...keepPending, ...snapshot], walletMarketTradeRowKey),
  ).slice(0, cap);
}

function mapPendingOnchainToWSTrade(
  d: {
    tokenId?: string;
    side?: string;
    size?: number;
    price?: number;
    timestamp?: number;
    txHash?: string;
    maker?: string;
    taker?: string;
    wallet?: string;
    isTaker?: boolean;
    priceApproximate?: boolean;
  },
  wallet: string,
): WSTrade | null {
  const wk = wallet.trim().toLowerCase();
  if (!wk) return null;
  const msgWallet = String(d.wallet || d.taker || d.maker || '').toLowerCase();
  if (msgWallet && msgWallet !== wk) return null;
  const tokenId = String(d.tokenId || '').trim();
  if (!tokenId) return null;
  const side = d.side === 'SELL' ? ('SELL' as const) : ('BUY' as const);
  const tx = String(d.txHash || '').trim();
  const tsRaw = Number(d.timestamp ?? Date.now());
  const blockTime = tsRaw > 1e12 ? Math.floor(tsRaw / 1000) : Math.floor(tsRaw);
  return {
    id: `pending:${tx.toLowerCase()}:${normalizeClobTokenKey(tokenId)}:${side}`,
    pending: true,
    priceApproximate: !!d.priceApproximate,
    tokenId,
    side,
    size: Number(d.size ?? 0),
    price: Number(d.price ?? 0),
    fee: 0,
    blockTime,
    txHash: tx,
    isTaker: d.isTaker === true,
  };
}

function prependWalletMarketTradeRow(
  prev: WSTrade[],
  trade: WSTrade,
  cap = WALLET_MARKET_TRADES_CAP,
): { rows: WSTrade[]; added: boolean } {
  const k = walletMarketTradeRowKey(trade);
  const tx = (trade.txHash || '').toLowerCase();
  let base = prev;
  if (!trade.pending && tx) {
    base = prev.filter((t) => !(t.pending && (t.txHash || '').toLowerCase() === tx));
  }
  if (base.some((t) => walletMarketTradeRowKey(t) === k)) {
    return { rows: base, added: false };
  }
  const row = trade.id ? trade : { ...trade, id: k };
  const rows = sortWalletMarketTradeRows(
    dedupeWalletTradesByLedgerLeg([row, ...base], walletMarketTradeRowKey),
  ).slice(0, cap);
  return { rows, added: true };
}

export function useOnchainTradesWS(opts: OnchainTradesWSOpts) {
  const { marketId = null, tokenId = null, wallet = null, scopedClobTokenIds = null } = opts;
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [walletPositions, setWalletPositions] = useState<WSPosition[]>([]);
  /** Full wallet snapshot from WS (never scoped to sidebar YES/NO) — for asset grid / HUD dots. */
  const [gridWalletPositions, setGridWalletPositions] = useState<WSPosition[]>([]);
  const [walletTrades, setWalletTrades] = useState<WSTrade[]>([]);
  /** Per-market history rows (GET /api/wallet-positions shape) for History panel. */
  const [walletHistory, setWalletHistory] = useState<WalletPosition[]>([]);
  /** Market-scoped WFL rows for sidebar My Trades (same source as wallet info dialog). */
  const [walletMarketTrades, setWalletMarketTrades] = useState<WSTrade[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [walletMarketConnectBump, setWalletMarketConnectBump] = useState(0);

  const walletMarketRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const primaryWalletMarketKeyRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const walletMarketListenersRef = useRef<Map<string, Set<WalletMarketTradesListener>>>(new Map());
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef<string | null>(null);
  const marketRef = useRef<string | null>(null);
  const walletRef = useRef<string | null | undefined>(null);
  const prefetchSerialRef = useRef(0);
  const effectSerialRef = useRef(0);
  const scopedClobTokenIdsRef = useRef<string[] | null>(scopedClobTokenIds);
  scopedClobTokenIdsRef.current = scopedClobTokenIds;
  /** Coalesce bursty onchainTrade WS messages to one React update per frame. */
  const pendingTapeBatchRef = useRef<LiveTrade[]>([]);
  const tapeBatchRafRef = useRef<number | null>(null);

  // Fast market-scoped REST before WS snapshot (WS trades are last-100 global, often misses this market).
  useEffect(() => {
    const w = (wallet || '').trim().toLowerCase();
    const ids = (scopedClobTokenIds || []).map((x) => String(x || '').trim()).filter(Boolean);
    setWalletPositions([]);
    setWalletTrades([]);
    setWalletMarketTrades([]);
    setWalletHistory([]);
    if (!w || ids.length === 0) return;
    const serial = ++prefetchSerialRef.current;
    let cancelled = false;
    void (async () => {
      try {
        const [pr, tr] = await Promise.all([
          fetchOnchainMarketPositions({ token_ids: ids, wallet: w }),
          fetchOnchainMarketTrades({ token_ids: ids, wallet: w, limit: 1500 }),
        ]);
        if (cancelled || serial !== prefetchSerialRef.current) return;
        setWalletPositions(
          (pr.positions || []).map((p) => ({
            tokenId: String(p.tokenId || ''),
            size: Number(p.size || 0),
            avgPrice: Number(p.avgPrice || 0),
            title: p.title,
            slug: p.slug,
            eventSlug: p.eventSlug,
            marketId: p.marketId,
            outcome: p.outcome,
            endDate: p.endDate,
            underlyingAsset: p.underlyingAsset,
          })).filter((p) => !!p.tokenId),
        );
        const deduped = mapFetchedTradesToDedupedRows(tr.trades || [], WALLET_TRADES_CAP);
        setWalletTrades(deduped);
        setWalletMarketTrades(deduped.slice(0, WALLET_MARKET_TRADES_CAP));
      } catch {
        /* keep prior state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, scopedClobTokenIds?.join('|') ?? '']);

  const cleanup = useCallback(() => {
    if (pingRef.current) {
      clearInterval(pingRef.current);
      pingRef.current = null;
    }
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    walletRef.current = wallet;
    setWalletPositions([]);
    setWalletTrades([]);
    setWalletMarketTrades([]);
    setGridWalletPositions([]);
    setWalletHistory([]);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const w = (wallet || '').trim().toLowerCase();
    if (w) {
      ws.send(JSON.stringify({ type: 'subscribeWallet', wallet: w }));
    } else {
      ws.send(JSON.stringify({ type: 'unsubscribeWallet' }));
    }
  }, [wallet]);

  useEffect(() => {
    const mid = (marketId || '').trim();
    const tid = (tokenId || '').trim();
    const wAddr = (wallet || '').trim().toLowerCase();
    tokenRef.current = tid || null;
    marketRef.current = mid ? canonicalConditionKey(mid) : null;
    walletRef.current = wallet;

    const hasWalletMarketSubs = walletMarketListenersRef.current.size > 0;
    if (!mid && !tid && !wAddr && !hasWalletMarketSubs) {
      cleanup();
      if (tapeBatchRafRef.current != null) {
        cancelAnimationFrame(tapeBatchRafRef.current);
        tapeBatchRafRef.current = null;
      }
      pendingTapeBatchRef.current = [];
      setTrades([]);
      setSidebarOnchainLiveTrades([]);
      setWalletPositions([]);
      setWalletTrades([]);
      setWalletMarketTrades([]);
      setGridWalletPositions([]);
      setWalletHistory([]);
      return;
    }

    const serial = ++effectSerialRef.current;

    const drainPendingTapeBatch = (): LiveTrade[] => {
      if (tapeBatchRafRef.current != null) {
        cancelAnimationFrame(tapeBatchRafRef.current);
        tapeBatchRafRef.current = null;
      }
      const batch = pendingTapeBatchRef.current;
      pendingTapeBatchRef.current = [];
      return batch;
    };

    const applyTapeTradesNow = (incoming: LiveTrade[]) => {
      if (incoming.length === 0) return;
      setTrades((prev) => {
        let cur = prev;
        for (const t of incoming) {
          cur = prependDedupedSortedTape(cur, t, MAX_TRADES);
        }
        cur = finalizeLiveTapeRows(cur, MAX_TRADES);
        setSidebarOnchainLiveTrades(cur);
        return cur;
      });
    };

    const flushTapeBatch = () => {
      applyTapeTradesNow(drainPendingTapeBatch());
    };

    const scheduleTapeTrade = (trade: LiveTrade) => {
      pendingTapeBatchRef.current.push(trade);
      if (tapeBatchRafRef.current != null) return;
      tapeBatchRafRef.current = requestAnimationFrame(flushTapeBatch);
    };

    const notifyPendingWalletMarketTrade = (d: {
      tokenId?: string;
      marketId?: string;
      side?: string;
      size?: number;
      price?: number;
      timestamp?: number;
      txHash?: string;
      maker?: string;
      taker?: string;
      wallet?: string;
      priceApproximate?: boolean;
    }) => {
      if (!d.tokenId) return;
      const tradeMarket = canonicalConditionKey(String(d.marketId || ''));
      if (!tradeMarket) return;
      const ledgerWallet = String(d.wallet || d.taker || d.maker || '').toLowerCase();
      if (!ledgerWallet) return;
      const row = mapPendingOnchainToWSTrade(d, ledgerWallet);
      if (!row) return;
      upsertWalletMarketPendingScope(ledgerWallet, tradeMarket, row);
      walletMarketListenersRef.current
        .get(walletMarketTradesKey(ledgerWallet, tradeMarket))
        ?.forEach((l) => l.onTrade?.(row));
    };

    const dropPendingWalletMarketForAllListeners = (txHashes: Set<string>) => {
      if (txHashes.size === 0) return;
      dropWalletMarketPendingByTx(txHashes);
      for (const listeners of walletMarketListenersRef.current.values()) {
        listeners.forEach((l) => l.onPendingDrop?.(txHashes));
      }
      setWalletMarketTrades((prev) => dropPendingWalletMarketByTx(prev, txHashes));
    };

    const loadFromAPI = () => {
      const m = marketRef.current?.trim() || '';
      const t = tokenRef.current?.trim() || '';
      if (!m && !t) return;
      const qs = new URLSearchParams();
      qs.set('limit', '400');
      if (m) qs.set('market_id', canonicalConditionKey(m));
      if (t) qs.set('token_id', t);
      void fetch(`${API_BASE}/api/onchain-fills?${qs.toString()}`)
        .then((r) => r.json())
        .then((res) => {
          if (serial !== effectSerialRef.current) return;
          const fills = Array.isArray(res?.fills) ? (res.fills as OnchainFillRow[]) : [];
          // Sort by block number desc, then log index desc (strictly monotonic, unlike blockTime
          // which can have wall-clock vs block-timestamp inconsistencies across deploys).
          fills.sort((a, b) => {
            const bn = (Number(b.blockNumber ?? 0)) - (Number(a.blockNumber ?? 0));
            if (bn !== 0) return bn;
            return (Number(b.logIndex ?? 0)) - (Number(a.logIndex ?? 0));
          });
          const maxBlock = fills.length > 0 ? Number(fills[0].blockNumber ?? 0) : 0;
          const nowMs = Date.now();
          const mapped: LiveTrade[] = [];
          for (const f of fills) {
            const makerAmt = Number(f.makerAmount ?? 0);
            const takerAmt = Number(f.takerAmount ?? 0);
            const makerAsset = String(f.makerAssetId ?? '');
            const takerAsset = String(f.takerAssetId ?? '');
            const makerIsUSDC = makerAsset === '0';
            const takerIsUSDC = takerAsset === '0';
            const size = makerIsUSDC ? takerAmt : makerAmt;
            const price = makerIsUSDC
              ? (takerAmt > 0 ? makerAmt / takerAmt : 0)
              : (makerAmt > 0 ? takerAmt / makerAmt : 0);
            const side = (makerIsUSDC ? 'BUY' : takerIsUSDC ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
            const ts = tradeTimestampMs(f, maxBlock, nowMs);
            const logIndex = Number(f.logIndex ?? 0);
            const p = Number.isFinite(price) ? price : 0;
            const txHash = f.txHash;
            const li = Number.isFinite(logIndex) ? logIndex : undefined;
            mapped.push(stampLiveTradeId({
              side,
              size: String(Number.isFinite(size) ? size : 0),
              price: String(p),
              timestamp: ts,
              txHash,
              logIndex: li,
              tokenId: String(f.tokenId || '').trim() || undefined,
            }));
          }
          const batched = drainPendingTapeBatch();
          setTrades((prev) => {
            let cur = prev;
            for (const t of batched) {
              cur = prependDedupedSortedTape(cur, t, MAX_TRADES);
            }
            const pendingRows = cur.filter((x) => x.pending);
            const confirmedTxs = new Set(mapped.map((r) => (r.txHash || '').toLowerCase()).filter(Boolean));
            const keepPending = pendingRows.filter((x) => !confirmedTxs.has((x.txHash || '').toLowerCase()));
            const confirmed = mapped.slice(0, MAX_TRADES);
            if (keepPending.length === 0) {
              setSidebarOnchainLiveTrades(confirmed);
              return confirmed;
            }
            const out = finalizeLiveTapeRows([...keepPending, ...confirmed], MAX_TRADES);
            setSidebarOnchainLiveTrades(out);
            return out;
          });
        })
        .catch(() => {});
    };

    const mCanonInit = mid ? canonicalConditionKey(mid) : null;
    const seeded = filterPublicTapeBuffer(mCanonInit, mCanonInit ? null : tid || null);
    setTrades(seeded);
    setSidebarOnchainLiveTrades(seeded);
    void loadFromAPI();

    let disposed = false;
    let ws: WebSocket | null = null;
    let attempt = 0;
    const pendingSweepRef = setInterval(() => {
      if (disposed) return;
      sweepWalletMarketPendingStore();
      setTrades((prev) => {
        const next = finalizeLiveTapeRows(prev, MAX_TRADES);
        if (next.length === prev.length && next.every((r, i) => r === prev[i])) return prev;
        setSidebarOnchainLiveTrades(next);
        return next;
      });
    }, PENDING_SWEEP_MS);

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    const startPollingFallback = () => {
      if (pollRef.current) return;
      void loadFromAPI();
      pollRef.current = setInterval(() => {
        if (!marketRef.current?.trim() && !tokenRef.current?.trim()) return;
        void loadFromAPI();
      }, 2500);
    };

    const connect = () => {
      if (disposed) return;
      const mConn = marketRef.current?.trim();
      const tConn = tokenRef.current?.trim();
      const wConn = (walletRef.current || '').trim().toLowerCase();
      const wmSubs = walletMarketListenersRef.current.size > 0;
      if (!mConn && !tConn && !wConn && !wmSubs) return;
      cleanup();
      const params = new URLSearchParams();
      const m = marketRef.current?.trim();
      const tok = tokenRef.current?.trim();
      const wq = (walletRef.current || '').trim().toLowerCase();
      if (m) {
        params.set('market_id', canonicalConditionKey(m));
        if (tok) params.set('token_id', tok);
      } else if (tok) {
        params.set('token_id', tok);
      } else if (wq) {
        params.set('wallet', wq);
      }
      const url =
        params.toString().length > 0
          ? `${WS_BASE}/ws/onchain-trades?${params.toString()}`
          : `${WS_BASE}/ws/onchain-trades`;
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setWsConnected(true);
        stopPolling();
        void loadFromAPI();
        pingRef.current = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 30000);
        const w = (walletRef.current || '').trim().toLowerCase();
        const m = marketRef.current?.trim() || '';
        if (w && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'subscribeWallet', wallet: w }));
          if (m) {
            ws.send(JSON.stringify({ type: 'subscribeWalletMarket', wallet: w, marketId: m }));
          }
        }
        for (const k of walletMarketListenersRef.current.keys()) {
          const [wk, mk] = k.split('|');
          if (wk && mk) {
            ws?.send(JSON.stringify({ type: 'subscribeWalletMarket', wallet: wk, marketId: mk }));
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (!msg?.type) return;

          if ((msg.type === 'onchainTrade' || msg.type === 'pendingTrade') && msg.data) {
            const isPending = msg.type === 'pendingTrade';
            const d = msg.data as {
              tokenId?: string;
              marketId?: string;
              side?: string;
              makerAssetId?: string;
              takerAssetId?: string;
              size?: number;
              price?: number;
              timestamp?: number;
              txHash?: string;
              logIndex?: number;
              maker?: string;
              taker?: string;
              wallet?: string;
              priceApproximate?: boolean;
            };
            const mSub = marketRef.current?.trim() || '';
            const tradeMarket = String(d.marketId || '').trim();

            if (!d.tokenId) return;
            if (mSub) {
              const subM = canonicalConditionKey(mSub);
              if (tradeMarket) {
                if (canonicalConditionKey(tradeMarket) !== subM) return;
              } else {
                const scoped = scopedClobTokenIdsRef.current || [];
                if (
                  scoped.length > 0 &&
                  !scoped.some((id) => sameDecimalTokenId(d.tokenId, id))
                ) {
                  return;
                }
              }
            } else {
              if (!sameDecimalTokenId(d.tokenId, tokenRef.current)) return;
            }

            if (isPending) {
              notifyPendingWalletMarketTrade({
                ...d,
                marketId: d.marketId || tradeMarket || mSub || undefined,
              });
              return;
            }

            const side = (d.side === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
            const size = Number(d.size ?? 0);
            const price = Number(d.price ?? 0);
            const ts = Number(d.timestamp ?? Date.now());
            const li = Number(d.logIndex ?? 0);
            const trade = stampLiveTradeId({
              side,
              size: String(size),
              price: String(price),
              timestamp: ts,
              txHash: d.txHash,
              logIndex: Number.isFinite(li) && li >= 0 ? li : undefined,
              maker: d.maker ? String(d.maker).toLowerCase() : undefined,
              taker: d.taker ? String(d.taker).toLowerCase() : undefined,
              wallet: d.wallet ? String(d.wallet).toLowerCase() : undefined,
              tokenId: String(d.tokenId || '').trim() || undefined,
            });
            const marketKeyForBuf = tradeMarket
              ? canonicalConditionKey(tradeMarket)
              : mSub
                ? canonicalConditionKey(mSub)
                : '';
            if (d.tokenId && marketKeyForBuf) {
              if (trade.txHash) {
                dropPendingFromPublicTapeBuffer(new Set([(trade.txHash || '').toLowerCase()]));
              }
              pushPublicTapeBuffer(trade, marketKeyForBuf, String(d.tokenId));
            }
            scheduleTapeTrade(trade);
          } else if (msg.type === 'pendingTradeDrop' && Array.isArray(msg.txHashes)) {
            const set = new Set<string>();
            for (const h of msg.txHashes as unknown[]) {
              const s = String(h || '').toLowerCase().trim();
              if (s) set.add(s);
            }
            if (set.size === 0) return;
            dropPendingFromPublicTapeBuffer(set);
            pendingTapeBatchRef.current = pendingTapeBatchRef.current.filter(
              (x) => !(x.pending && set.has((x.txHash || '').toLowerCase())),
            );
            dropPendingWalletMarketForAllListeners(set);
            setTrades((prev) => {
              const next = dropPendingByTx(prev, set);
              setSidebarOnchainLiveTrades(next);
              return next;
            });
          } else if (msg.type === 'walletPositions' && Array.isArray(msg.data)) {
            const msgWallet = String(msg.wallet || '').trim().toLowerCase();
            const mine = (walletRef.current || '').trim().toLowerCase();
            if (msgWallet && mine && msgWallet !== mine) return;
            const raw = (msg.data as Array<Record<string, unknown>>)
              .map((p) => mapRawWSPosition(p))
              .filter((p): p is WSPosition => p != null);
            setWalletPositions((prev) =>
              mergeWalletPositionsSnapshot(prev, raw, scopedClobTokenIdsRef.current),
            );
            // Market-scoped WS sends walletGridPositions for full book; wallet-only URL uses one payload for both.
            if (!marketRef.current?.trim()) {
              setGridWalletPositions(raw);
            }
          } else if (msg.type === 'walletGridPositions' && Array.isArray(msg.data)) {
            const raw = (msg.data as Array<Record<string, unknown>>)
              .map((p) => mapRawWSPosition(p))
              .filter((p): p is WSPosition => p != null);
            setGridWalletPositions(raw);
          } else if (msg.type === 'walletTrades' && Array.isArray(msg.data)) {
            const msgWallet = String(msg.wallet || '').trim().toLowerCase();
            const mine = (walletRef.current || '').trim().toLowerCase();
            if (msgWallet && mine && msgWallet !== mine) return;
            const raw = (msg.data as Array<Record<string, unknown>>)
              .map((t) => mapRawWSTrade(t as Parameters<typeof mapRawWSTrade>[0]))
              .filter((t): t is WSTrade => t != null);
            const stamped = raw.map((t) => {
              const k = t.id || walletTradeKey(t.txHash, t.logIndex, normalizeClobTokenKey(t.tokenId), t.side);
              return t.id ? t : { ...t, id: k };
            });
            const deduped = dedupeWalletTradesByLedgerLeg(stamped, (t) =>
              t.id || walletTradeKey(t.txHash, t.logIndex, normalizeClobTokenKey(t.tokenId), t.side),
            ).slice(0, WALLET_TRADES_CAP);
            setWalletTrades(deduped);
            const pw = (walletRef.current || '').trim().toLowerCase();
            const pm = marketRef.current ? canonicalConditionKey(marketRef.current) : '';
            if (pw && pm && msgWallet === pw) {
              const scopedIds = new Set(
                (scopedClobTokenIdsRef.current || [])
                  .map((x) => normalizeClobTokenKey(x))
                  .filter(Boolean),
              );
              if (scopedIds.size > 0) {
                const marketRows = deduped.filter((t) => scopedIds.has(normalizeClobTokenKey(t.tokenId)));
                setWalletMarketTrades(marketRows.slice(0, WALLET_MARKET_TRADES_CAP));
              }
            }
          } else if (msg.type === 'walletHistory' && Array.isArray(msg.data)) {
            const msgWallet = String(msg.wallet || '').trim().toLowerCase();
            const mine = (walletRef.current || '').trim().toLowerCase();
            if (msgWallet && mine && msgWallet !== mine) return;
            setWalletHistory(msg.data as WalletPosition[]);
          } else if (msg.type === 'walletMarketTrades' && Array.isArray(msg.data)) {
            const w = String(msg.wallet || '').trim().toLowerCase();
            const m = canonicalConditionKey(String(msg.marketId || ''));
            const rows = mapFetchedTradesToDedupedRows(msg.data as Array<Parameters<typeof mapRawWSTrade>[0]>);
            const tot = Number(msg.total ?? rows.length);
            const pw = (walletRef.current || '').trim().toLowerCase();
            const pm = marketRef.current ? canonicalConditionKey(marketRef.current) : '';
            if (pw && pm && w === pw && m === pm) {
              setWalletMarketTrades((prev) => mergeWalletMarketSnapshotWithPending(prev, rows));
            }
            const listeners = walletMarketListenersRef.current.get(walletMarketTradesKey(w, m));
            listeners?.forEach((l) => l.onSnapshot(rows, tot));
          } else if (msg.type === 'walletMarketTrade' && msg.data) {
            const w = String(msg.wallet || '').trim().toLowerCase();
            const m = canonicalConditionKey(String(msg.marketId || ''));
            if (!w || !m) return;
            const row = mapRawWSTrade(msg.data as Parameters<typeof mapRawWSTrade>[0]);
            if (row) {
              const listeners = walletMarketListenersRef.current.get(walletMarketTradesKey(w, m));
              listeners?.forEach((l) => l.onTrade?.(row));
              const tx = (row.txHash || '').toLowerCase();
              if (tx) dropWalletMarketPendingByTx(new Set([tx]));
              const pw = (walletRef.current || '').trim().toLowerCase();
              const pm = marketRef.current ? canonicalConditionKey(marketRef.current) : '';
              if (pw && pm && w === pw && m === pm) {
                setWalletMarketTrades((prev) => prependWalletMarketTradeRow(prev, row).rows);
              }
            }
          }
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (pingRef.current) {
          clearInterval(pingRef.current);
          pingRef.current = null;
        }
        if (
          disposed ||
          (!marketRef.current?.trim() &&
            !tokenRef.current?.trim() &&
            !(walletRef.current || '').trim().toLowerCase() &&
            walletMarketListenersRef.current.size === 0)
        ) {
          return;
        }
        if (attempt >= 2) startPollingFallback();
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        attempt += 1;
        reconnectRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearInterval(pendingSweepRef);
      if (walletMarketRefreshTimerRef.current) {
        clearTimeout(walletMarketRefreshTimerRef.current);
        walletMarketRefreshTimerRef.current = null;
      }
      if (tapeBatchRafRef.current != null) {
        cancelAnimationFrame(tapeBatchRafRef.current);
        tapeBatchRafRef.current = null;
      }
      pendingTapeBatchRef.current = [];
      cleanup();
    };
  }, [marketId, tokenId, wallet, walletMarketConnectBump, cleanup]);

  const sendSubscribeWalletMarket = useCallback((wallet: string, marketId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const w = wallet.trim().toLowerCase();
    const m = canonicalConditionKey(marketId);
    if (!w || !m) return;
    ws.send(JSON.stringify({ type: 'subscribeWalletMarket', wallet: w, marketId: m }));
  }, []);

  useEffect(() => {
    const w = (wallet || '').trim().toLowerCase();
    const m = marketId ? canonicalConditionKey(marketId) : '';
    primaryWalletMarketKeyRef.current = w && m ? walletMarketTradesKey(w, m) : null;
    if (!w || !m) {
      setWalletMarketTrades([]);
      return;
    }
    setWalletMarketTrades([]);
    sendSubscribeWalletMarket(w, m);
  }, [wallet, marketId, wsConnected, sendSubscribeWalletMarket]);

  const subscribeWalletMarketTrades = useCallback(
    (wallet: string, marketId: string, listener: WalletMarketTradesListener) => {
      const w = wallet.trim().toLowerCase();
      const m = canonicalConditionKey(marketId);
      if (!w || !m) return () => {};
      const k = walletMarketTradesKey(w, m);
      let set = walletMarketListenersRef.current.get(k);
      if (!set) {
        set = new Set();
        walletMarketListenersRef.current.set(k, set);
      }
      set.add(listener);
      walletMarketListenerScopeKeys.add(k);
      sendSubscribeWalletMarket(w, m);
      for (const row of getWalletMarketPendingTrades(w, m)) {
        listener.onTrade?.(row);
      }
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setWalletMarketConnectBump((n) => n + 1);
      }
      return () => {
        const cur = walletMarketListenersRef.current.get(k);
        cur?.delete(listener);
        if (cur && cur.size === 0) {
          walletMarketListenersRef.current.delete(k);
          walletMarketListenerScopeKeys.delete(k);
          walletMarketPendingByScope.delete(k);
          bumpWalletMarketPendingStore();
          if (primaryWalletMarketKeyRef.current !== k) {
            const ws = wsRef.current;
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'unsubscribeWalletMarket', wallet: w }));
            }
          }
        }
      };
    },
    [sendSubscribeWalletMarket],
  );

  const refetchWalletFromApi = useCallback(async () => {
    const w = (walletRef.current || '').trim().toLowerCase();
    const ids = (scopedClobTokenIdsRef.current || []).map((x) => String(x || '').trim()).filter(Boolean);
    if (!w || ids.length === 0) return;
    try {
      const [pr, tr] = await Promise.all([
        fetchOnchainMarketPositions({ token_ids: ids, wallet: w }),
        fetchOnchainMarketTrades({ token_ids: ids, wallet: w, limit: 1500 }),
      ]);
      const mappedPositions = (pr.positions || [])
        .map((p) => ({
          tokenId: String(p.tokenId || ''),
          size: Number(p.size || 0),
          avgPrice: Number(p.avgPrice || 0),
          feesPaid: p.feesPaid != null ? Number(p.feesPaid) : undefined,
          title: p.title,
          slug: p.slug,
          eventSlug: p.eventSlug,
          marketId: p.marketId,
          outcome: p.outcome,
          endDate: p.endDate,
          underlyingAsset: p.underlyingAsset,
        }))
        .filter((p) => !!p.tokenId);
      setWalletPositions((prev) => mergeWalletPositionsSnapshot(prev, mappedPositions, scopedClobTokenIdsRef.current));
      const deduped = mapFetchedTradesToDedupedRows(tr.trades || [], WALLET_TRADES_CAP);
      setWalletTrades(deduped);
      setWalletMarketTrades(deduped.slice(0, WALLET_MARKET_TRADES_CAP));
    } catch {
      /* keep prior state */
    }
  }, []);

  const refreshWalletMarketTrades = useCallback(
    (wallet: string, marketId: string) => {
      sendSubscribeWalletMarket(wallet, marketId);
    },
    [sendSubscribeWalletMarket],
  );

  const refreshWallet = useCallback(() => {
    const ws = wsRef.current;
    const w = walletRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && w) {
      ws.send(JSON.stringify({ type: 'subscribeWallet', wallet: w }));
    }
    void refetchWalletFromApi();
  }, [refetchWalletFromApi]);

  useEffect(() => {
    onchainTradesWSProviderCount += 1;
    onchainTradesWSSharedStable.subscribeWalletMarketTrades = subscribeWalletMarketTrades;
    onchainTradesWSSharedStable.refreshWalletMarketTrades = refreshWalletMarketTrades;
    onchainTradesWSSharedStable.wsConnected = wsConnected;
    onchainTradesWSShared = onchainTradesWSSharedStable;
    return () => {
      onchainTradesWSProviderCount -= 1;
      if (onchainTradesWSProviderCount <= 0) {
        onchainTradesWSProviderCount = 0;
        onchainTradesWSSharedStable.subscribeWalletMarketTrades = () => () => {};
        onchainTradesWSSharedStable.refreshWalletMarketTrades = () => {};
        onchainTradesWSSharedStable.wsConnected = false;
        onchainTradesWSShared = null;
        walletMarketListenerScopeKeys.clear();
        walletMarketPendingByScope.clear();
        bumpWalletMarketPendingStore();
      }
    };
  }, [subscribeWalletMarketTrades, refreshWalletMarketTrades, wsConnected]);

  return {
    trades,
    walletPositions,
    gridWalletPositions,
    walletTrades,
    walletHistory,
    walletMarketTrades,
    refreshWallet,
    subscribeWalletMarketTrades,
    refreshWalletMarketTrades,
    wsConnected,
  };
}

/** Wallet info dialog: WFL rows for one wallet+market via shared /ws/onchain-trades (no extra socket). */
export function useWalletMarketTradesWS(
  wallet: string | null,
  marketId: string | null,
  enabled: boolean,
): { trades: WSTrade[]; total: number; loading: boolean; refresh: () => void } {
  const [trades, setTrades] = useState<WSTrade[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sharedReady, setSharedReady] = useState(() => getOnchainTradesWSShared() != null);
  const scopeKeyRef = useRef('');
  const tradesLenRef = useRef(0);
  tradesLenRef.current = trades.length;

  useEffect(() => {
    const sync = () => setSharedReady(getOnchainTradesWSShared() != null);
    sync();
    const id = window.setInterval(sync, 200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const w = (wallet || '').trim().toLowerCase();
    const m = (marketId || '').trim();
    const key = w && m ? walletMarketTradesKey(w, m) : '';

    if (!enabled || !key) {
      scopeKeyRef.current = '';
      setTrades([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    if (!sharedReady) {
      if (scopeKeyRef.current !== key) {
        scopeKeyRef.current = key;
        setTrades([]);
        setTotal(0);
      }
      setLoading(true);
      return;
    }

    const shared = getOnchainTradesWSShared();
    if (!shared) {
      setLoading(true);
      return;
    }

    const sameScope = scopeKeyRef.current === key;
    scopeKeyRef.current = key;
    if (!sameScope) {
      setTrades([]);
      setTotal(0);
      setLoading(true);
    } else if (tradesLenRef.current === 0) {
      setLoading(true);
    }

    let cancelled = false;
    const unsub = shared.subscribeWalletMarketTrades(wallet!, marketId!, {
      onSnapshot: (rows, tot) => {
        if (cancelled) return;
        setTrades((prev) => mergeWalletMarketSnapshotWithPending(prev, rows));
        setTotal(tot);
        setLoading(false);
      },
      onTrade: (trade) => {
        if (cancelled) return;
        setTrades((prev) => {
          const { rows, added } = prependWalletMarketTradeRow(prev, trade);
          if (added) setTotal((tot) => tot + 1);
          return rows;
        });
        setLoading(false);
      },
      onPendingDrop: (txHashes) => {
        if (cancelled) return;
        setTrades((prev) => dropPendingWalletMarketByTx(prev, txHashes));
      },
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [enabled, sharedReady, wallet, marketId]);

  const refresh = useCallback(() => {
    const shared = getOnchainTradesWSShared();
    if (!shared || !wallet?.trim() || !marketId?.trim()) return;
    if (tradesLenRef.current === 0) setLoading(true);
    shared.refreshWalletMarketTrades(wallet, marketId);
  }, [wallet, marketId]);

  return { trades, total, loading, refresh };
}

/** Mount when Sidebar hook is absent — mobile, market view, wallet info modal without sidebar WS. */
export function OnchainTradesWSBridge({
  wallet,
  marketId,
  scopedClobTokenIds = null,
  active = true,
}: {
  wallet: string;
  marketId: string;
  scopedClobTokenIds?: string[] | null;
  active?: boolean;
}) {
  const walletLc = active && wallet.trim() ? wallet.trim().toLowerCase() : null;
  const market = active && marketId.trim() ? marketId.trim() : null;
  useOnchainTradesWS({
    wallet: walletLc,
    marketId: market,
    scopedClobTokenIds,
  });
  return null;
}
