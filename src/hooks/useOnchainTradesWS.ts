import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, WS_BASE } from '../lib/env';
import type { LiveTrade } from './usePolymarketOB';

const MAX_TRADES = 40;

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
  tokenId: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  fee: number;
  blockTime: number;
  txHash?: string;
  title?: string;
  slug?: string;
  eventSlug?: string;
}

export function useOnchainTradesWS(opts: OnchainTradesWSOpts) {
  const { marketId = null, tokenId = null, wallet = null } = opts;
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [walletPositions, setWalletPositions] = useState<WSPosition[]>([]);
  const [walletTrades, setWalletTrades] = useState<WSTrade[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef<string | null>(null);
  const marketRef = useRef<string | null>(null);
  const walletRef = useRef<string | null | undefined>(null);
  const effectSerialRef = useRef(0);

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
    }
  }, [wallet]);

  useEffect(() => {
    const mid = (marketId || '').trim();
    const tid = (tokenId || '').trim();
    tokenRef.current = tid || null;
    marketRef.current = mid ? canonicalConditionKey(mid) : null;
    walletRef.current = wallet;

    if (!mid && !tid) {
      cleanup();
      setTrades([]);
      setWalletPositions([]);
      setWalletTrades([]);
      return;
    }

    const serial = ++effectSerialRef.current;

    const loadFromAPI = () => {
      const m = marketRef.current?.trim() || '';
      const t = tokenRef.current?.trim() || '';
      if (!m && !t) return;
      const qs = new URLSearchParams();
      qs.set('limit', '30');
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
            if (size > 0 && price > 0) {
              mapped.push({
                side,
                size: String(size),
                price: String(price),
                timestamp: ts,
                txHash: f.txHash,
                logIndex: Number.isFinite(logIndex) ? logIndex : undefined,
              });
            }
          }
          setTrades(mapped.slice(0, MAX_TRADES));
        })
        .catch(() => {});
    };

    setTrades([]);
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
      if (!marketRef.current?.trim() && !tokenRef.current?.trim()) return;
      cleanup();
      const params = new URLSearchParams();
      const m = marketRef.current?.trim();
      const tok = tokenRef.current?.trim();
      if (m) {
        params.set('market_id', canonicalConditionKey(m));
        if (tok) params.set('token_id', tok);
      } else if (tok) {
        params.set('token_id', tok);
      }
      const url = `${WS_BASE}/ws/onchain-trades?${params.toString()}`;
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        stopPolling();
        void loadFromAPI();
        pingRef.current = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 30000);
        const w = walletRef.current;
        if (w && ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'subscribeWallet', wallet: w }));
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
              size?: number;
              price?: number;
              timestamp?: number;
              txHash?: string;
              logIndex?: number;
              maker?: string;
              taker?: string;
            };
            const wAddr = (walletRef.current || '').trim().toLowerCase();
            const makerLc = d.maker ? String(d.maker).toLowerCase() : '';
            const takerLc = d.taker ? String(d.taker).toLowerCase() : '';
            const mSub = marketRef.current?.trim() || '';
            const tradeMarket = String(d.marketId || '').trim();

            if (wAddr && d.tokenId && (makerLc === wAddr || takerLc === wAddr)) {
              if (!mSub || !tradeMarket || canonicalConditionKey(tradeMarket) === canonicalConditionKey(mSub)) {
                const side = (d.side === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
                const size = Number(d.size ?? 0);
                const price = Number(d.price ?? 0);
                const ts = Number(d.timestamp ?? Date.now());
                if (size > 0 && price > 0) {
                  const blockTimeSec = ts >= 1_000_000_000_000 ? Math.floor(ts / 1000) : Math.max(0, Math.floor(ts));
                  setWalletTrades((prev) => {
                    const row = {
                      tokenId: String(d.tokenId),
                      side,
                      size,
                      price,
                      fee: 0,
                      blockTime: blockTimeSec > 0 ? blockTimeSec : Math.floor(Date.now() / 1000),
                      txHash: d.txHash,
                    };
                    const key = `${String(d.txHash || '')}:${row.tokenId}`;
                    const filtered = prev.filter((x) => `${String(x.txHash || '')}:${x.tokenId}` !== key);
                    return [row, ...filtered].slice(0, 100);
                  });
                }
              }
            }

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
            if (!(size > 0 && price > 0)) return;
            const li = Number(d.logIndex ?? 0);
            const t: LiveTrade = {
              side,
              size: String(size),
              price: String(price),
              timestamp: ts,
              txHash: d.txHash,
              logIndex: Number.isFinite(li) && li >= 0 ? li : undefined,
              maker: d.maker ? String(d.maker).toLowerCase() : undefined,
              taker: d.taker ? String(d.taker).toLowerCase() : undefined,
            };
            setTrades((prev) => {
              const key = `${t.txHash || ''}:${t.logIndex ?? ''}`;
              const deduped = key ? prev.filter((x) => `${x.txHash || ''}:${x.logIndex ?? ''}` !== key) : prev;
              const merged = [t, ...deduped];
              merged.sort((a, b) => {
                const td = (b.timestamp ?? 0) - (a.timestamp ?? 0);
                if (td !== 0) return td;
                return (b.logIndex ?? 0) - (a.logIndex ?? 0);
              });
              return merged.slice(0, MAX_TRADES);
            });
          } else if (msg.type === 'walletPositions' && Array.isArray(msg.data)) {
            const positions = (msg.data as Array<{ tokenId?: string; size?: number; avgPrice?: number }>)
              .map((p) => ({
                tokenId: String(p.tokenId || ''),
                size: Number(p.size || 0),
                avgPrice: Number(p.avgPrice || 0),
              }))
              .filter((p) => p.tokenId && p.size > 0);
            setWalletPositions(positions);
          } else if (msg.type === 'walletTrades' && Array.isArray(msg.data)) {
            const wt = (msg.data as Array<{ tokenId?: string; side?: string; size?: number; price?: number; fee?: number; blockTime?: number; txHash?: string }>)
              .map((t) => ({
                tokenId: String(t.tokenId || ''),
                side: (String(t.side || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL',
                size: Number(t.size || 0),
                price: Number(t.price || 0),
                fee: Number(t.fee || 0),
                blockTime: Number(t.blockTime || 0),
                txHash: t.txHash,
              }))
              .filter((t) => t.tokenId && t.size > 0 && t.price > 0);
            setWalletTrades(wt);
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
        if (pingRef.current) {
          clearInterval(pingRef.current);
          pingRef.current = null;
        }
        if (disposed || (!marketRef.current?.trim() && !tokenRef.current?.trim())) return;
        if (attempt >= 2) startPollingFallback();
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        attempt += 1;
        reconnectRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      cleanup();
    };
  // wallet changes only re-send subscribeWallet (separate effect above)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId, tokenId, cleanup]);

  const refreshWallet = useCallback(() => {
    const ws = wsRef.current;
    const w = walletRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && w) {
      ws.send(JSON.stringify({ type: 'subscribeWallet', wallet: w }));
    }
  }, []);

  return { trades, walletPositions, walletTrades, refreshWallet };
}
