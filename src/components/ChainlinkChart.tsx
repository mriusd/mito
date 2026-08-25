import { useEffect, useRef, useState, useCallback } from 'react';
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

interface ChainlinkChartProps {
  asset: string; // e.g. 'BTC', 'ETH', 'SOL', 'XRP'
  /** Up/Down: slug + question + group title — picks candle resolution (e.g. 15m for 4h/24h). */
  intervalContext?: string;
  targetPrice?: number | null;
  /** 5m/15m Up/Down: polycandles Chainlink klines + WS; otherwise Binance spot. */
  chainlinkCandles?: boolean;
  /** Completed candles used for σ (excluding the in-progress bar). Default 5. */
  volatilityLookbackCandles?: number;
  /** Latest annualized σ% from the same candle window as the chart label (or null). */
  onAnnualizedVolPct?: (pct: number | null) => void;
}

function chainlinkKlineSymbol(asset: string): string {
  return `chainlink_${asset.toLowerCase()}usd`;
}

export function ChainlinkChart({
  asset,
  intervalContext,
  targetPrice,
  chainlinkCandles = false,
  volatilityLookbackCandles = 5,
  onAnnualizedVolPct,
}: ChainlinkChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const candleMapRef = useRef<Map<number, Candle>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef('');
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  const onVolRef = useRef(onAnnualizedVolPct);
  onVolRef.current = onAnnualizedVolPct;

  const interval = sidebarChartIntervalFromContext(intervalContext);
  const candleMs = SIDEBAR_CHART_INTERVAL_MS[interval] ?? 3600000;
  intervalRef.current = interval;
  const binanceSymbol = `${asset.toUpperCase()}USDT`;
  const binanceStreamSymbol = `${asset.toLowerCase()}usdt`;

  // Binance spot: REST + kline WS
  useEffect(() => {
    if (chainlinkCandles) return;

    candleMapRef.current = new Map();
    setReady(false);

    safeCloseWebSocket(wsRef.current);
    wsRef.current = null;

    fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=100`)
      .then(r => r.json())
      .then((klines: unknown[][]) => {
        if (!Array.isArray(klines)) {
          setReady(true);
          return;
        }
        const map = candleMapRef.current;
        for (const k of klines) {
          if (!Array.isArray(k) || k.length < 6) continue;
          const t = k[0] as number;
          map.set(t, {
            time: t,
            o: parseFloat(String(k[1])),
            h: parseFloat(String(k[2])),
            l: parseFloat(String(k[3])),
            c: parseFloat(String(k[4])),
          });
        }
        setReady(true);
      })
      .catch(() => setReady(true));

    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${binanceStreamSymbol}@kline_${interval}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { e?: string; k?: { t: number; o: string; h: string; l: string; c: string } };
        if (msg.e === 'kline' && msg.k) {
          const k = msg.k;
          const map = candleMapRef.current;
          const t = k.t as number;
          map.set(t, { time: t, o: parseFloat(k.o), h: parseFloat(k.h), l: parseFloat(k.l), c: parseFloat(k.c) });
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
  }, [chainlinkCandles, binanceSymbol, binanceStreamSymbol, interval, candleMs]);

  // Polycandles Chainlink klines (5m/15m Up/Down): REST + chart WS
  useEffect(() => {
    if (!chainlinkCandles) return;

    candleMapRef.current = new Map();
    setReady(false);

    const clSymbol = chainlinkKlineSymbol(asset);
    let disposed = false;

    const params = new URLSearchParams({ symbol: clSymbol, interval, limit: '100' });
    void fetchBackend(`${API_BASE}/api/v3/klines?${params}`)
      .then((r) => r.json())
      .then((klines: unknown[][]) => {
        if (disposed || !Array.isArray(klines)) {
          setReady(true);
          return;
        }
        const map = candleMapRef.current;
        for (const k of klines) {
          if (!Array.isArray(k) || k.length < 6) continue;
          const t = Number(k[0]);
          const o = parseFloat(String(k[1]));
          const h = parseFloat(String(k[2]));
          const l = parseFloat(String(k[3]));
          const c = parseFloat(String(k[4]));
          if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
          map.set(t, { time: t, o, h, l, c });
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
        const tOpen = Number(k.t);
        const o = parseFloat(k.o);
        const h = parseFloat(k.h);
        const l = parseFloat(k.l);
        const c = parseFloat(k.c);
        if (!Number.isFinite(tOpen) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return;
        if (disposed) return;
        const map = candleMapRef.current;
        map.set(tOpen, { time: tOpen, o, h, l, c });
        setTick((n) => n + 1);
      },
    });

    return () => {
      disposed = true;
      unsub();
    };
  }, [chainlinkCandles, asset, interval]);

  useEffect(() => {
    const map = candleMapRef.current;
    const bars = volBarsForCalc([...map.values()], candleMs, volatilityLookbackCandles);
    const pct = annualizedVolPctFromOHLC(bars, candleMs);
    onVolRef.current?.(pct);
  }, [ready, tick, candleMs, volatilityLookbackCandles]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const allCandles = Array.from(candleMapRef.current.values()).sort((a, b) => a.time - b.time);
    const candles = allCandles.slice(-10);

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;

    if (candles.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(chainlinkCandles ? 'Waiting for Chainlink data...' : 'Waiting for Binance data...', W / 2, H / 2);
      return;
    }

    // For 5m markets, use the previous 5m candle's close as target
    let effectiveTarget = targetPrice;
    if (interval === '5m' && allCandles.length >= 2) {
      const currentBucket = Math.floor(Date.now() / candleMs) * candleMs;
      const prevCandle = allCandles.filter(c => c.time < currentBucket).pop();
      if (prevCandle) {
        effectiveTarget = prevCandle.c;
      }
    }

    const chartLeft = 50;
    const chartRight = W - 8;
    const chartTop = 4;
    const chartBot = H - 14;

    // Compute price range
    let minP = Infinity, maxP = -Infinity;
    for (const c of candles) {
      minP = Math.min(minP, c.l);
      maxP = Math.max(maxP, c.h);
    }
    // Include target price in range
    if (effectiveTarget && effectiveTarget > 0) {
      minP = Math.min(minP, effectiveTarget);
      maxP = Math.max(maxP, effectiveTarget);
    }
    // Add 5% padding
    const pad = (maxP - minP) * 0.05 || 1;
    minP -= pad;
    maxP += pad;

    const toX = (i: number) => chartLeft + ((i + 0.5) / candles.length) * (chartRight - chartLeft);
    const toY = (p: number) => chartBot - ((p - minP) / (maxP - minP)) * (chartBot - chartTop);

    // Grid lines + price labels (right side)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '8px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    const decimals = maxP > 1000 ? 0 : maxP > 10 ? 2 : 4;
    for (let i = 0; i <= 3; i++) {
      const p = minP + (maxP - minP) * (i / 3);
      const y = toY(p);
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('$' + p.toFixed(decimals), chartLeft - 2, y);
    }

    // Time labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    const labelCount = 4;
    for (let i = 0; i <= labelCount; i++) {
      const idx = Math.floor((candles.length - 1) * (i / labelCount));
      if (idx < 0 || idx >= candles.length) continue;
      const d = new Date(candles[idx].time);
      ctx.fillText(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`, toX(idx), chartBot + 2);
    }

    // Draw candles
    const candleW = Math.max(2, Math.min(8, ((chartRight - chartLeft) / candles.length) * 0.7));
    const bullColor = chainlinkCandles ? '#60a5fa' : '#00d2d2';
    const bearColor = '#e91e90';

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const cx = toX(i);
      const isBull = c.c >= c.o;
      const color = isBull ? bullColor : bearColor;

      // Wick
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.moveTo(cx, toY(c.h));
      ctx.lineTo(cx, toY(c.l));
      ctx.stroke();

      // Body — ensure minimum 3px height so doji candles are visible
      const bodyTop = toY(Math.max(c.o, c.c));
      const bodyBot = toY(Math.min(c.o, c.c));
      const bodyH = Math.max(bodyBot - bodyTop, 3);
      ctx.fillStyle = color;
      ctx.fillRect(cx - candleW / 2, bodyTop - (bodyH - (bodyBot - bodyTop)) / 2, candleW, bodyH);
    }

    // Target price line
    if (effectiveTarget && effectiveTarget > 0) {
      const tY = toY(effectiveTarget);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,200,0,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.moveTo(chartLeft, tY);
      ctx.lineTo(chartRight, tY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,200,0,0.7)';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Target $' + effectiveTarget.toFixed(decimals), chartLeft - 2, tY - 1);
    }

    // Last price label
    const lastC = candles[candles.length - 1].c;
    const barsForSigma = volBarsForCalc(allCandles, candleMs, volatilityLookbackCandles);
    const sigmaAnnPct = annualizedVolPctFromOHLC(barsForSigma, candleMs);
    const lastY = toY(lastC);
    const accentRgb = chainlinkCandles ? '96,165,250' : '0,210,210';
    const accentHex = chainlinkCandles ? '#93c5fd' : '#00d2d2';
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${accentRgb},0.35)`;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.moveTo(chartLeft, lastY);
    ctx.lineTo(chartRight, lastY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = accentHex;
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('$' + lastC.toFixed(decimals), chartLeft - 2, lastY);

    // σ = max(Parkinson H/L, close-close) over last N completed + open bar (mitobot), bottom-left
    if (sigmaAnnPct != null && Number.isFinite(sigmaAnnPct)) {
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = 'rgba(255, 216, 120, 0.95)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`σ ${sigmaAnnPct.toFixed(1)}%`, chartLeft + 5, chartBot - 3);
    }
  }, [ready, tick, targetPrice, interval, candleMs, chainlinkCandles, volatilityLookbackCandles]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div className="sidebar-section">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400 flex items-center gap-1">
          {asset}{' '}
          {chainlinkCandles ? (
            <span
              className="px-0.5 rounded-sm text-[7px] font-bold bg-blue-600 text-white leading-tight"
              title="Polycandles Chainlink OHLC (synthetic chainlink_*usd)"
            >
              CHAINLINK
            </span>
          ) : (
            <span className="px-0.5 rounded-sm text-[8px] font-bold bg-yellow-400 text-black leading-tight">BINANCE</span>
          )}
          <span className="text-gray-500">{interval}</span>
        </span>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 110, borderRadius: 6, background: '#1a1a2e' }}
      />
    </div>
  );
}
