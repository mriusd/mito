import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../lib/env';
import { subscribeChartKline } from '../lib/chartWsShared';
import {
  SIDEBAR_CHART_INTERVAL_MS,
  annualizedVolPctFromClosePrices,
  sidebarChartIntervalFromContext,
} from '../lib/chartVolatility';

interface Candle {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

function chainlinkKlineSymbol(asset: string): string {
  return `chainlink_${asset.toLowerCase()}usd`;
}

function parseKlineRow(k: unknown[]): Candle | null {
  if (!Array.isArray(k) || k.length < 6) return null;
  const t = Number(k[0]);
  const o = parseFloat(String(k[1]));
  const h = parseFloat(String(k[2]));
  const l = parseFloat(String(k[3]));
  const c = parseFloat(String(k[4]));
  if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) {
    return null;
  }
  return { time: t, o, h, l, c };
}

export type UseSidebarChartVolatilityParams = {
  asset: string | null | undefined;
  intervalContext?: string;
  chainlinkCandles?: boolean;
  volatilityLookbackCandles?: number;
  /** Bump when sidebar market changes — forces σ recompute from cached klines (same asset). */
  recalcKey?: string;
  onAnnualizedVolPct?: (pct: number | null) => void;
};

function computeAnnualizedVolFromMap(
  map: Map<number, Candle>,
  candleMs: number,
  volatilityLookbackCandles: number,
): number | null {
  const allCandles = [...map.values()].sort((a, b) => a.time - b.time);
  const bucketNow = Math.floor(Date.now() / candleMs) * candleMs;
  const lb = Math.max(3, Math.min(500, Math.round(volatilityLookbackCandles)));
  const closed = allCandles.filter((c) => c.time < bucketNow).slice(-lb);
  return annualizedVolPctFromClosePrices(
    closed.map((c) => c.c),
    candleMs,
  );
}

/** Headless sidebar σ from Binance or polycandles Chainlink klines (same window as former left chart). */
export function useSidebarChartVolatility({
  asset,
  intervalContext,
  chainlinkCandles = false,
  volatilityLookbackCandles = 5,
  recalcKey = '',
  onAnnualizedVolPct,
}: UseSidebarChartVolatilityParams): void {
  const candleMapRef = useRef<Map<number, Candle>>(new Map());
  const binanceFallbackMapRef = useRef<Map<number, Candle>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const binanceFallbackWsRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef('');
  const [ready, setReady] = useState(false);
  const [binanceFallbackReady, setBinanceFallbackReady] = useState(false);
  const [tick, setTick] = useState(0);
  const [binanceFallbackTick, setBinanceFallbackTick] = useState(0);
  const onVolRef = useRef(onAnnualizedVolPct);
  onVolRef.current = onAnnualizedVolPct;

  const interval = sidebarChartIntervalFromContext(intervalContext);
  const candleMs = SIDEBAR_CHART_INTERVAL_MS[interval] ?? 3600000;
  intervalRef.current = interval;
  const binanceSymbol = asset ? `${asset.toUpperCase()}USDT` : '';
  const binanceStreamSymbol = asset ? `${asset.toLowerCase()}usdt` : '';

  useEffect(() => {
    if (!asset) {
      candleMapRef.current = new Map();
      setReady(false);
      onVolRef.current?.(null);
      return;
    }

    if (chainlinkCandles) return;

    candleMapRef.current = new Map();
    setReady(false);

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=100`)
      .then((r) => r.json())
      .then((klines: unknown[][]) => {
        if (!Array.isArray(klines)) {
          setReady(true);
          return;
        }
        const map = candleMapRef.current;
        for (const k of klines) {
          const row = parseKlineRow(k);
          if (row) map.set(row.time, row);
        }
        setReady(true);
      })
      .catch(() => setReady(true));

    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${binanceStreamSymbol}@kline_${interval}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          e?: string;
          k?: { t: number; o: string; h: string; l: string; c: string };
        };
        if (msg.e === 'kline' && msg.k) {
          const k = msg.k;
          const map = candleMapRef.current;
          map.set(k.t, {
            time: k.t,
            o: parseFloat(k.o),
            h: parseFloat(k.h),
            l: parseFloat(k.l),
            c: parseFloat(k.c),
          });
          setTick((n) => n + 1);
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {};
    ws.onerror = () => {};

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      wsRef.current = null;
    };
  }, [asset, chainlinkCandles, binanceSymbol, binanceStreamSymbol, interval]);

  useEffect(() => {
    if (!asset || !chainlinkCandles) return;

    candleMapRef.current = new Map();
    setReady(false);

    const clSymbol = chainlinkKlineSymbol(asset);
    let disposed = false;

    const params = new URLSearchParams({ symbol: clSymbol, interval, limit: '100' });
    void fetch(`${API_BASE}/api/v3/klines?${params}`)
      .then((r) => r.json())
      .then((klines: unknown[][]) => {
        if (disposed || !Array.isArray(klines)) {
          setReady(true);
          return;
        }
        const map = candleMapRef.current;
        for (const k of klines) {
          const row = parseKlineRow(k);
          if (row) map.set(row.time, row);
        }
        setReady(true);
      })
      .catch(() => setReady(true));

    const unsub = subscribeChartKline(clSymbol, interval, {
      onMessage: (msg) => {
        if (msg.type !== 'klineStreamUpdate') return;
        const k = msg.data?.data?.k as
          | { t: number; o: string; h: string; l: string; c: string; s?: string; i?: string }
          | undefined;
        if (!k) return;
        if (k.s !== clSymbol || k.i !== intervalRef.current) return;
        const row = parseKlineRow([k.t, k.o, k.h, k.l, k.c]);
        if (!row || disposed) return;
        candleMapRef.current.set(row.time, row);
        setTick((n) => n + 1);
      },
    });

    return () => {
      disposed = true;
      unsub();
    };
  }, [asset, chainlinkCandles, interval]);

  /** Binance klines fallback when Chainlink σ cannot be computed (sparse CL history). */
  useEffect(() => {
    if (!asset || !chainlinkCandles) {
      binanceFallbackMapRef.current = new Map();
      setBinanceFallbackReady(false);
      return;
    }

    binanceFallbackMapRef.current = new Map();
    setBinanceFallbackReady(false);

    if (binanceFallbackWsRef.current) {
      binanceFallbackWsRef.current.close();
      binanceFallbackWsRef.current = null;
    }

    fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=100`)
      .then((r) => r.json())
      .then((klines: unknown[][]) => {
        if (!Array.isArray(klines)) {
          setBinanceFallbackReady(true);
          return;
        }
        const map = binanceFallbackMapRef.current;
        for (const k of klines) {
          const row = parseKlineRow(k);
          if (row) map.set(row.time, row);
        }
        setBinanceFallbackReady(true);
      })
      .catch(() => setBinanceFallbackReady(true));

    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${binanceStreamSymbol}@kline_${interval}`);
    binanceFallbackWsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          e?: string;
          k?: { t: number; o: string; h: string; l: string; c: string };
        };
        if (msg.e === 'kline' && msg.k) {
          const k = msg.k;
          binanceFallbackMapRef.current.set(k.t, {
            time: k.t,
            o: parseFloat(k.o),
            h: parseFloat(k.h),
            l: parseFloat(k.l),
            c: parseFloat(k.c),
          });
          setBinanceFallbackTick((n) => n + 1);
        }
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {};
    ws.onerror = () => {};

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      binanceFallbackWsRef.current = null;
    };
  }, [asset, chainlinkCandles, binanceSymbol, binanceStreamSymbol, interval]);

  useEffect(() => {
    if (!asset) {
      onVolRef.current?.(null);
      return;
    }

    let pct = computeAnnualizedVolFromMap(candleMapRef.current, candleMs, volatilityLookbackCandles);
    if (pct == null && chainlinkCandles) {
      pct = computeAnnualizedVolFromMap(binanceFallbackMapRef.current, candleMs, volatilityLookbackCandles);
    }
    onVolRef.current?.(pct);
  }, [
    asset,
    ready,
    tick,
    binanceFallbackReady,
    binanceFallbackTick,
    candleMs,
    volatilityLookbackCandles,
    chainlinkCandles,
    recalcKey,
  ]);
}
