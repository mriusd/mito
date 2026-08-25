import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../lib/env';
import { fetchBackend } from '../lib/fetchBackend';
import { subscribeChartKline } from '../lib/chartWsShared';
import {
  SIDEBAR_CHART_INTERVAL_MS,
  annualizedVolPctFromOHLC,
  sidebarChartIntervalFromContext,
  volBarsForCalc,
} from '../lib/chartVolatility';
import { safeCloseWebSocket } from '../lib/safeCloseWebSocket';

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
  // Mitobot: last N completed + current open bar; max(Parkinson H/L, close-close).
  const bars = volBarsForCalc([...map.values()], candleMs, volatilityLookbackCandles);
  return annualizedVolPctFromOHLC(bars, candleMs);
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
  /** Separate gens so Chainlink primary + Binance fallback don't cancel each other. */
  const primaryFetchGenRef = useRef(0);
  const fallbackFetchGenRef = useRef(0);
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

  // New market (or clear selection): drop σ immediately so UI never keeps the previous window's value.
  useEffect(() => {
    onVolRef.current?.(null);
  }, [recalcKey, asset]);

  useEffect(() => {
    if (!asset) {
      candleMapRef.current = new Map();
      setReady(false);
      onVolRef.current?.(null);
      return;
    }

    if (chainlinkCandles) return;

    // Refetch on every market (recalcKey) even when asset/interval are unchanged —
    // otherwise σ stays frozen on the first session's kline snapshot until page reload.
    const gen = ++primaryFetchGenRef.current;
    candleMapRef.current = new Map();
    setReady(false);
    onVolRef.current?.(null);

    safeCloseWebSocket(wsRef.current);
    wsRef.current = null;

    fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=100`)
      .then((r) => r.json())
      .then((klines: unknown[][]) => {
        if (gen !== primaryFetchGenRef.current) return;
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
      .catch(() => {
        if (gen === primaryFetchGenRef.current) setReady(true);
      });

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
      if (wsRef.current === ws) wsRef.current = null;
      safeCloseWebSocket(ws);
    };
  }, [asset, chainlinkCandles, binanceSymbol, binanceStreamSymbol, interval, recalcKey]);

  useEffect(() => {
    if (!asset || !chainlinkCandles) return;

    const gen = ++primaryFetchGenRef.current;
    candleMapRef.current = new Map();
    setReady(false);
    onVolRef.current?.(null);

    const clSymbol = chainlinkKlineSymbol(asset);
    let disposed = false;

    const params = new URLSearchParams({ symbol: clSymbol, interval, limit: '100' });
    void fetchBackend(`${API_BASE}/api/v3/klines?${params}`)
      .then((r) => r.json())
      .then((klines: unknown[][]) => {
        if (disposed || gen !== primaryFetchGenRef.current || !Array.isArray(klines)) {
          if (!disposed && gen === primaryFetchGenRef.current) setReady(true);
          return;
        }
        const map = candleMapRef.current;
        for (const k of klines) {
          const row = parseKlineRow(k);
          if (row) map.set(row.time, row);
        }
        setReady(true);
      })
      .catch(() => {
        if (!disposed && gen === primaryFetchGenRef.current) setReady(true);
      });

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
  }, [asset, chainlinkCandles, interval, recalcKey]);

  /** Binance klines fallback when Chainlink σ cannot be computed (sparse CL history). */
  useEffect(() => {
    if (!asset || !chainlinkCandles) {
      binanceFallbackMapRef.current = new Map();
      setBinanceFallbackReady(false);
      return;
    }

    const gen = ++fallbackFetchGenRef.current;
    binanceFallbackMapRef.current = new Map();
    setBinanceFallbackReady(false);

    safeCloseWebSocket(binanceFallbackWsRef.current);
    binanceFallbackWsRef.current = null;

    fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=100`)
      .then((r) => r.json())
      .then((klines: unknown[][]) => {
        if (gen !== fallbackFetchGenRef.current) return;
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
      .catch(() => {
        if (gen === fallbackFetchGenRef.current) setBinanceFallbackReady(true);
      });

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
      if (binanceFallbackWsRef.current === ws) binanceFallbackWsRef.current = null;
      safeCloseWebSocket(ws);
    };
  }, [asset, chainlinkCandles, binanceSymbol, binanceStreamSymbol, interval, recalcKey]);

  // Recompute when a candle bucket rolls even if the WS is quiet (esp. after market auto-switch).
  useEffect(() => {
    if (!asset) return;
    const period = Math.min(Math.max(5_000, Math.floor(candleMs / 6)), 15_000);
    const id = window.setInterval(() => setTick((n) => n + 1), period);
    return () => window.clearInterval(id);
  }, [asset, candleMs, recalcKey]);

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
