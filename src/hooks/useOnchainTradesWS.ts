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
  txHash?: string;
}

export interface WSPosition {
  tokenId: string;
  size: number;
  avgPrice: number;
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

export function useOnchainTradesWS(tokenId: string | null, wallet?: string | null) {
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [walletPositions, setWalletPositions] = useState<WSPosition[]>([]);
  const [walletTrades, setWalletTrades] = useState<WSTrade[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef = useRef<string | null>(null);
  const walletRef = useRef<string | null | undefined>(null);

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

  // When wallet changes while WS is already open, send subscribe/unsubscribe
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
    tokenRef.current = tokenId;
    walletRef.current = wallet;
    if (!tokenId) {
      cleanup();
      setTrades([]);
      setWalletPositions([]);
      setWalletTrades([]);
      return;
    }

    const loadFromAPI = () =>
      fetch(`${API_BASE}/api/onchain-fills?token_id=${encodeURIComponent(tokenId)}&limit=30`)
        .then((r) => r.json())
        .then((res) => {
        const fills = Array.isArray(res?.fills) ? (res.fills as OnchainFillRow[]) : [];
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
          const ts = Date.now() - Number(f.blockNumber ?? 0) % 1000;
          if (size > 0 && price > 0) {
            mapped.push({ side, size: String(size), price: String(price), timestamp: ts, txHash: f.txHash });
          }
        }
        mapped.sort((a, b) => b.timestamp - a.timestamp);
        setTrades(mapped.slice(0, MAX_TRADES));
      })
      .catch(() => {});

    const startPollingFallback = () => {
      if (pollRef.current) return;
      void loadFromAPI();
      pollRef.current = setInterval(() => {
        if (!tokenRef.current) return;
        void loadFromAPI();
      }, 2500);
    };

    setTrades([]);
    void loadFromAPI();

    let disposed = false;
    let ws: WebSocket | null = null;
    let attempt = 0;

    const connect = () => {
      if (disposed || !tokenRef.current) return;
      cleanup();
      const url = `${WS_BASE}/ws/onchain-trades?token_id=${encodeURIComponent(tokenRef.current)}&active_only=1`;
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        pingRef.current = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 30000);
        // Subscribe wallet for position/trade updates if available
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
              side?: string;
              size?: number;
              price?: number;
              timestamp?: number;
              txHash?: string;
              maker?: string;
              taker?: string;
            };
            if (!d.tokenId || d.tokenId !== tokenRef.current) return;
            const side = (d.side === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
            const size = Number(d.size ?? 0);
            const price = Number(d.price ?? 0);
            const ts = Number(d.timestamp ?? Date.now());
            if (!(size > 0 && price > 0)) return;
            const t: LiveTrade = {
              side,
              size: String(size),
              price: String(price),
              timestamp: ts,
              txHash: d.txHash,
              maker: d.maker ? String(d.maker).toLowerCase() : undefined,
              taker: d.taker ? String(d.taker).toLowerCase() : undefined,
            };
            setTrades((prev) => [t, ...prev].slice(0, MAX_TRADES));
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
        if (disposed || !tokenRef.current) return;
        if (attempt >= 2) {
          startPollingFallback();
          return;
        }
        const delay = Math.min(15000, 1000 * 2 ** Math.min(attempt, 4));
        attempt += 1;
        reconnectRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      cleanup();
    };
  // wallet changes are handled by the separate useEffect above
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenId, cleanup]);

  const refreshWallet = useCallback(() => {
    const ws = wsRef.current;
    const w = walletRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && w) {
      ws.send(JSON.stringify({ type: 'subscribeWallet', wallet: w }));
    }
  }, []);

  return { trades, walletPositions, walletTrades, refreshWallet };
}
