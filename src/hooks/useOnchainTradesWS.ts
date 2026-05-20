import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchOnchainMarketPositions, fetchOnchainMarketTrades } from '../api';
import { API_BASE, WS_BASE } from '../lib/env';
import { onchainFillKey, walletTradeKey } from '../lib/tradeKeys';
import type { LiveTrade } from './usePolymarketOB';

/** Cap sidebar / chart tape arrays — 3500 rows × lucide-SVG anchors held hundreds of MB of detached DOM after a few market switches. */
const MAX_TRADES = 400;
const WALLET_TRADES_CAP = 400;

interface OnchainFillRow {
  makerAmount?: number;
  takerAmount?: number;
  makerAssetId?: string;
  takerAssetId?: string;
  blockNumber?: number;
  blockTime?: number;
  logIndex?: number;
  txHash?: string;
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

function canonicalConditionKey(id: string): string {
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
  if (!key) {
    const merged = [stamped, ...prev];
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
  const merged = Array.from(byKey.values());
  merged.sort((a, b) => {
    const td = (b.timestamp ?? 0) - (a.timestamp ?? 0);
    if (td !== 0) return td;
    return (b.logIndex ?? 0) - (a.logIndex ?? 0);
  });
  return merged.slice(0, cap);
}

function pushPublicTapeBuffer(t: LiveTrade, marketCanon: string, tokenIdRaw: string) {
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
      if (tokenSub && !sameDecimalTokenId(__tok, tokenSub)) continue;
    } else if (tokenSub) {
      if (!sameDecimalTokenId(__tok, tokenSub)) continue;
    } else {
      continue;
    }
    out.push(rest);
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
  const byKey = new Map<string, LiveTrade>();
  for (const t of apiRows) {
    const stamped = stampLiveTradeId(t);
    const k = liveTradeDedupeKey(stamped);
    if (k) byKey.set(k, stamped);
  }
  for (const t of fromBuffer) {
    const stamped = stampLiveTradeId(t);
    const k = liveTradeDedupeKey(stamped);
    if (!k || byKey.has(k)) continue;
    byKey.set(k, stamped);
  }
  const merged = Array.from(byKey.values());
  merged.sort((a, b) => {
    const td = (b.timestamp ?? 0) - (a.timestamp ?? 0);
    if (td !== 0) return td;
    return (b.logIndex ?? 0) - (a.logIndex ?? 0);
  });
  return merged.slice(0, MAX_TRADES);
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
  title?: string;
  slug?: string;
  eventSlug?: string;
  marketId?: string;
  outcome?: string;
  endDate?: string;
  underlyingAsset?: string;
}

export interface WSTrade {
  /** Stable dedupe key — set once at ingest. */
  id?: string;
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
};

export type OnchainTradesWSShared = {
  subscribeWalletMarketTrades: (wallet: string, marketId: string, listener: WalletMarketTradesListener) => () => void;
  refreshWalletMarketTrades: (wallet: string, marketId: string) => void;
  wsConnected: boolean;
};

let onchainTradesWSShared: OnchainTradesWSShared | null = null;

export function getOnchainTradesWSShared(): OnchainTradesWSShared | null {
  return onchainTradesWSShared;
}

function walletMarketTradesKey(wallet: string, marketId: string): string {
  return `${wallet.trim().toLowerCase()}|${canonicalConditionKey(marketId)}`;
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

export function useOnchainTradesWS(opts: OnchainTradesWSOpts) {
  const { marketId = null, tokenId = null, wallet = null, scopedClobTokenIds = null } = opts;
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [walletPositions, setWalletPositions] = useState<WSPosition[]>([]);
  /** Full wallet snapshot from WS (never scoped to sidebar YES/NO) — for asset grid / HUD dots. */
  const [gridWalletPositions, setGridWalletPositions] = useState<WSPosition[]>([]);
  const [walletTrades, setWalletTrades] = useState<WSTrade[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [walletMarketConnectBump, setWalletMarketConnectBump] = useState(0);
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
  /** Coalesce bursty onchainTrade WS messages to one React update per frame. */
  const pendingTapeBatchRef = useRef<LiveTrade[]>([]);
  const tapeBatchRafRef = useRef<number | null>(null);

  // Fast market-scoped REST before WS snapshot (WS trades are last-100 global, often misses this market).
  useEffect(() => {
    const w = (wallet || '').trim().toLowerCase();
    const ids = (scopedClobTokenIds || []).map((x) => String(x || '').trim()).filter(Boolean);
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
        setWalletTrades(
          (tr.trades || []).map((t) => ({
            tokenId: String(t.tokenId || ''),
            side: normalizeLedgerAction(t.side),
            outcome: t.outcome ? String(t.outcome) : undefined,
            size: Number(t.size || 0),
            price: Number(t.price || 0),
            fee: Number(t.fee || 0),
            blockTime: Number(t.blockTime || 0),
            txHash: t.txHash,
            logIndex: Number.isFinite(t.logIndex) ? t.logIndex : undefined,
            title: t.title,
            slug: t.slug,
            eventSlug: t.eventSlug,
          })).filter((t) => !!t.tokenId || t.side === 'SPLIT' || t.side === 'MERGE' || t.side === 'REDEEM'),
        );
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
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (wallet) {
      ws.send(JSON.stringify({ type: 'subscribeWallet', wallet }));
    } else {
      ws.send(JSON.stringify({ type: 'unsubscribeWallet' }));
      setWalletPositions([]);
      setWalletTrades([]);
      setGridWalletPositions([]);
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
      setWalletPositions([]);
      setWalletTrades([]);
      setGridWalletPositions([]);
      return;
    }

    const serial = ++effectSerialRef.current;

    const cancelPendingTapeBatch = () => {
      if (tapeBatchRafRef.current != null) {
        cancelAnimationFrame(tapeBatchRafRef.current);
        tapeBatchRafRef.current = null;
      }
      pendingTapeBatchRef.current = [];
    };

    const flushTapeBatch = () => {
      tapeBatchRafRef.current = null;
      const batch = pendingTapeBatchRef.current;
      pendingTapeBatchRef.current = [];
      if (batch.length === 0) return;
      setTrades((prev) => {
        let cur = prev;
        for (const t of batch) {
          cur = prependDedupedSortedTape(cur, t, MAX_TRADES);
        }
        return cur;
      });
    };

    const scheduleTapeTrade = (trade: LiveTrade) => {
      pendingTapeBatchRef.current.push(trade);
      if (tapeBatchRafRef.current != null) return;
      tapeBatchRafRef.current = requestAnimationFrame(flushTapeBatch);
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
            }));
          }
          const mForMerge = m ? canonicalConditionKey(m) : null;
          const tForMerge = t || null;
          const fromBuf = filterPublicTapeBuffer(mForMerge, tForMerge);
          cancelPendingTapeBatch();
          setTrades(mergePublicLiveTapes(mapped.slice(0, MAX_TRADES), fromBuf));
        })
        .catch(() => {});
    };

    cancelPendingTapeBatch();
    const mCanonInit = mid ? canonicalConditionKey(mid) : null;
    setTrades(filterPublicTapeBuffer(mCanonInit, tid || null));
    void loadFromAPI();

    let disposed = false;
    let ws: WebSocket | null = null;
    let attempt = 0;

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
        const w = walletRef.current;
        if (w && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'subscribeWallet', wallet: w }));
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

          if (msg.type === 'onchainTrade' && msg.data) {
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
            };
            const mSub = marketRef.current?.trim() || '';
            const tradeMarket = String(d.marketId || '').trim();

            // Do not mirror onchainTrade into walletTrades — rows come from wallet_fill_ledger via
            // fetchOnchainMarketTrades prefetch + walletTrades WS snapshots (avoids phantom/extra rows vs WFL).

            if (!d.tokenId) return;
            if (mSub) {
              if (!tradeMarket || canonicalConditionKey(tradeMarket) !== canonicalConditionKey(mSub)) return;
              const subTok = tokenRef.current?.trim();
              if (subTok && !sameDecimalTokenId(d.tokenId, subTok)) return;
            } else {
              if (!sameDecimalTokenId(d.tokenId, tokenRef.current)) return;
            }

            const side = (d.side === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
            const size = Number(d.size ?? 0);
            const price = Number(d.price ?? 0);
            const ts = Number(d.timestamp ?? Date.now());
            const li = Number(d.logIndex ?? 0);
            const t = stampLiveTradeId({
              side,
              size: String(size),
              price: String(price),
              timestamp: ts,
              txHash: d.txHash,
              logIndex: Number.isFinite(li) && li >= 0 ? li : undefined,
              maker: d.maker ? String(d.maker).toLowerCase() : undefined,
              taker: d.taker ? String(d.taker).toLowerCase() : undefined,
            });
            const marketKeyForBuf = tradeMarket
              ? canonicalConditionKey(tradeMarket)
              : mSub
                ? canonicalConditionKey(mSub)
                : '';
            if (d.tokenId) {
              pushPublicTapeBuffer(t, marketKeyForBuf, String(d.tokenId));
            }
            scheduleTapeTrade(t);
          } else if (msg.type === 'walletPositions' && Array.isArray(msg.data)) {
            const msgWallet = String(msg.wallet || '').trim().toLowerCase();
            const mine = (walletRef.current || '').trim().toLowerCase();
            if (msgWallet && mine && msgWallet !== mine) return;
            const raw = (msg.data as Array<{ tokenId?: string; size?: number; avgPrice?: number }>)
              .map((p) => ({
                tokenId: String(p.tokenId || ''),
                size: Number(p.size || 0),
                avgPrice: Number(p.avgPrice || 0),
              }))
              .filter((p) => !!p.tokenId);
            setWalletPositions(raw);
            // Market-scoped WS sends walletGridPositions for full book; wallet-only URL uses one payload for both.
            if (!marketRef.current?.trim()) {
              setGridWalletPositions(raw);
            }
          } else if (msg.type === 'walletGridPositions' && Array.isArray(msg.data)) {
            const raw = (msg.data as Array<{ tokenId?: string; size?: number; avgPrice?: number }>)
              .map((p) => ({
                tokenId: String(p.tokenId || ''),
                size: Number(p.size || 0),
                avgPrice: Number(p.avgPrice || 0),
              }))
              .filter((p) => !!p.tokenId);
            setGridWalletPositions(raw);
          } else if (msg.type === 'walletTrades' && Array.isArray(msg.data)) {
            const msgWallet = String(msg.wallet || '').trim().toLowerCase();
            const mine = (walletRef.current || '').trim().toLowerCase();
            if (msgWallet && mine && msgWallet !== mine) return;
            const raw = (msg.data as Array<Record<string, unknown>>)
              .map((t) => mapRawWSTrade(t as Parameters<typeof mapRawWSTrade>[0]))
              .filter((t): t is WSTrade => t != null);
            setWalletTrades((prev) => {
              const byKey = new Map<string, WSTrade>();
              for (const t of prev) {
                const k = t.id || walletTradeKey(t.txHash, t.logIndex, normalizeClobTokenKey(t.tokenId), t.side);
                byKey.set(k, t.id ? t : { ...t, id: k });
              }
              for (const t of raw) byKey.set(t.id!, t);
              return Array.from(byKey.values())
                .sort((a, b) => b.blockTime - a.blockTime || (b.logIndex ?? 0) - (a.logIndex ?? 0))
                .slice(0, WALLET_TRADES_CAP);
            });
          } else if (msg.type === 'walletMarketTrades' && Array.isArray(msg.data)) {
            const w = String(msg.wallet || '').trim().toLowerCase();
            const m = canonicalConditionKey(String(msg.marketId || ''));
            const listeners = walletMarketListenersRef.current.get(walletMarketTradesKey(w, m));
            if (!listeners?.size) return;
            const rows = (msg.data as Array<Record<string, unknown>>)
              .map((t) => mapRawWSTrade(t as Parameters<typeof mapRawWSTrade>[0]))
              .filter((t): t is WSTrade => t != null);
            const tot = Number(msg.total ?? rows.length);
            listeners.forEach((l) => l.onSnapshot(rows, tot));
          } else if (msg.type === 'walletMarketTrade' && msg.data) {
            const w = String(msg.wallet || '').trim().toLowerCase();
            const m = canonicalConditionKey(String(msg.marketId || ''));
            const listeners = walletMarketListenersRef.current.get(walletMarketTradesKey(w, m));
            if (!listeners?.size) return;
            const row = mapRawWSTrade(msg.data as Parameters<typeof mapRawWSTrade>[0]);
            if (!row) return;
            listeners.forEach((l) => l.onTrade?.(row));
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
      sendSubscribeWalletMarket(w, m);
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        setWalletMarketConnectBump((n) => n + 1);
      }
      return () => {
        const cur = walletMarketListenersRef.current.get(k);
        cur?.delete(listener);
        if (cur && cur.size === 0) {
          walletMarketListenersRef.current.delete(k);
          const ws = wsRef.current;
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'unsubscribeWalletMarket', wallet: w }));
          }
        }
      };
    },
    [sendSubscribeWalletMarket],
  );

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
  }, []);

  useEffect(() => {
    onchainTradesWSShared = {
      subscribeWalletMarketTrades,
      refreshWalletMarketTrades,
      wsConnected,
    };
    return () => {
      onchainTradesWSShared = null;
    };
  }, [subscribeWalletMarketTrades, refreshWalletMarketTrades, wsConnected]);

  return {
    trades,
    walletPositions,
    gridWalletPositions,
    walletTrades,
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
  const [shared, setShared] = useState<OnchainTradesWSShared | null>(() => getOnchainTradesWSShared());

  useEffect(() => {
    const tick = () => setShared(getOnchainTradesWSShared());
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!enabled || !shared || !wallet?.trim() || !marketId?.trim()) {
      setTrades([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = shared.subscribeWalletMarketTrades(wallet, marketId, {
      onSnapshot: (rows, tot) => {
        setTrades(rows);
        setTotal(tot);
        setLoading(false);
      },
      onTrade: (t) => {
        setTrades((prev) => {
          const byKey = new Map<string, WSTrade>();
          const k0 = t.id || walletTradeKey(t.txHash, t.logIndex, normalizeClobTokenKey(t.tokenId), t.side);
          byKey.set(k0, t);
          for (const x of prev) {
            const k = x.id || walletTradeKey(x.txHash, x.logIndex, normalizeClobTokenKey(x.tokenId), x.side);
            if (k === k0) continue;
            byKey.set(k, x);
          }
          return Array.from(byKey.values())
            .sort((a, b) => b.blockTime - a.blockTime || (b.logIndex ?? 0) - (a.logIndex ?? 0))
            .slice(0, 500);
        });
      },
    });
    return unsub;
  }, [enabled, shared, wallet, marketId]);

  const refresh = useCallback(() => {
    if (!shared || !wallet?.trim() || !marketId?.trim()) return;
    setLoading(true);
    shared.refreshWalletMarketTrades(wallet, marketId);
  }, [shared, wallet, marketId]);

  return { trades, total, loading, refresh };
}
