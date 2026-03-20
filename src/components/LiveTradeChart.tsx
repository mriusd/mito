import { useEffect, useRef, useCallback, useState } from 'react';
import type { LiveTrade } from '../hooks/usePolymarketOB';

interface Candle {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

function toPrice(raw: number, isNo: boolean): number {
  return isNo ? 100 - raw : raw;
}

import { API_BASE, WS_BASE } from '../lib/env';

const INTERVAL_MS: Record<string, number> = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000 };

interface LiveTradeChartProps {
  trades: LiveTrade[];
  isNo: boolean;
  tokenId?: string;
  startTime?: number;
  endTime?: number;
  eventSlug?: string;
  chainlinkAsset?: string; // e.g. 'BTC' -> fetches chainlink_btcusd candles
  targetPrice?: number | null; // target price in USD, placed at 50% Y-axis
}

function defaultInterval(eventSlug?: string): string {
  if (eventSlug?.match(/up-or-down-on-/)) return '5m';
  return '1m';
}

export function LiveTradeChart({ trades, isNo, tokenId, startTime, endTime, eventSlug, chainlinkAsset, targetPrice }: LiveTradeChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const candleMapRef = useRef<Map<number, Candle>>(new Map());
  const chainlinkCandleMapRef = useRef<Map<number, Candle>>(new Map());
  const lastTradeCountRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [chainlinkReady, setChainlinkReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const chainlinkWsRef = useRef<WebSocket | null>(null);
  const [interval, setInterval_] = useState(() => defaultInterval(eventSlug));
  const [wsTick, setWsTick] = useState(0);
  const [chainlinkTick, setChainlinkTick] = useState(0);

  // Reset default interval when market changes
  useEffect(() => {
    setInterval_(defaultInterval(eventSlug));
  }, [eventSlug, tokenId]);

  const candleMs = INTERVAL_MS[interval] || 60000;

  // Reset candle map + fetch klines from Go backend + subscribe to WS
  useEffect(() => {
    candleMapRef.current = new Map();
    lastTradeCountRef.current = 0;
    setReady(false);

    // Cleanup previous WS
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (!tokenId) return;

    // Fetch initial candles from Go backend
    const st = startTime || (Date.now() - 24 * 60 * 60 * 1000);
    const et = endTime || (Date.now() + 60 * 60 * 1000);
    fetch(`/api/v3/klines?symbol=${tokenId}&interval=${interval}&startTime=${st}&endTime=${et}&limit=1500`)
      .then(r => r.json())
      .then((klines: any[][]) => {
        if (!Array.isArray(klines)) { setReady(true); return; }
        const map = candleMapRef.current;
        for (const k of klines) {
          const openTime = k[0] as number;
          const o = toPrice(parseFloat(k[1] as string) * 100, isNo);
          const h = toPrice(parseFloat(k[2] as string) * 100, isNo);
          const l = toPrice(parseFloat(k[3] as string) * 100, isNo);
          const c = toPrice(parseFloat(k[4] as string) * 100, isNo);
          const hi = Math.max(o, h, l, c);
          const lo = Math.min(o, h, l, c);
          map.set(openTime, { time: openTime, o, h: hi, l: lo, c });
        }
        setReady(true);
      })
      .catch(() => setReady(true));

    // Subscribe to WS for live kline updates
    const ws = new WebSocket(`${WS_BASE}/ws/chart`);
    wsRef.current = ws;
    let pingIv: ReturnType<typeof setInterval>;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'subscribeKlineStream',
        data: { symbol: tokenId, interval },
      }));
      pingIv = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'klineStreamUpdate') {
          const k = msg.data?.data?.k;
          if (!k) return;
          const map = candleMapRef.current;
          const openTime = k.t as number;
          const o = toPrice(parseFloat(k.o) * 100, isNo);
          const h = toPrice(parseFloat(k.h) * 100, isNo);
          const l = toPrice(parseFloat(k.l) * 100, isNo);
          const c = toPrice(parseFloat(k.c) * 100, isNo);
          const hi = Math.max(o, h, l, c);
          const lo = Math.min(o, h, l, c);
          map.set(openTime, { time: openTime, o, h: hi, l: lo, c });
          setWsTick(n => n + 1);
        }
      } catch {}
    };

    return () => {
      clearInterval(pingIv);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [tokenId, isNo, startTime, endTime, interval]);

  // Fetch Chainlink candles from Go backend + subscribe to WS for live updates
  useEffect(() => {
    chainlinkCandleMapRef.current = new Map();
    setChainlinkReady(false);

    if (chainlinkWsRef.current) {
      chainlinkWsRef.current.close();
      chainlinkWsRef.current = null;
    }

    if (!chainlinkAsset) return;

    const clSymbol = `chainlink_${chainlinkAsset.toLowerCase()}usd`;
    const st = startTime || (Date.now() - 24 * 60 * 60 * 1000);
    const et = endTime || (Date.now() + 60 * 60 * 1000);

    // Fetch initial candles from polycandles backend
    fetch(`${API_BASE}/api/v3/klines?symbol=${clSymbol}&interval=${interval}&startTime=${st}&endTime=${et}&limit=1500`)
      .then(r => r.json())
      .then((klines: any[][]) => {
        if (!Array.isArray(klines)) { setChainlinkReady(true); return; }
        const map = chainlinkCandleMapRef.current;
        for (const k of klines) {
          const openTime = k[0] as number;
          const o = parseFloat(k[1] as string);
          const h = parseFloat(k[2] as string);
          const l = parseFloat(k[3] as string);
          const c = parseFloat(k[4] as string);
          map.set(openTime, { time: openTime, o, h, l, c });
        }
        setChainlinkReady(true);
      })
      .catch(() => setChainlinkReady(true));

    // Subscribe to WS for live chainlink kline updates
    const ws = new WebSocket(`${WS_BASE}/ws/chart`);
    chainlinkWsRef.current = ws;
    let pingIv: ReturnType<typeof setInterval>;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'subscribeKlineStream',
        data: { symbol: clSymbol, interval },
      }));
      pingIv = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'klineStreamUpdate') {
          const k = msg.data?.data?.k;
          if (!k) return;
          const map = chainlinkCandleMapRef.current;
          const openTime = k.t as number;
          const o = parseFloat(k.o);
          const h = parseFloat(k.h);
          const l = parseFloat(k.l);
          const c = parseFloat(k.c);
          map.set(openTime, { time: openTime, o, h, l, c });
          setChainlinkTick(n => n + 1);
        }
      } catch {}
    };

    return () => {
      clearInterval(pingIv);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      chainlinkWsRef.current = null;
    };
  }, [chainlinkAsset, startTime, endTime, interval]);

  // Trigger redraw when new trades arrive (candle data comes from kline WS, not trades)
  useEffect(() => {
    if (!ready) return;
    lastTradeCountRef.current = trades.length;
  }, [trades, ready]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const candles = Array.from(candleMapRef.current.values()).sort((a, b) => a.time - b.time);

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
      const now = Date.now();
      const notStarted = startTime && now < startTime;
      ctx.fillText(notStarted ? 'Market not started yet' : 'Waiting for data...', W / 2, H / 2);
      return;
    }

    const chartLeft = 30;
    const chartRight = W - 4;
    const chartTop = 4;
    const chartBot = H - 14;

    // Fixed 0-100 Y-axis range
    const minP = 0;
    const maxP = 100;

    // Use full market duration for X-axis if startTime/endTime provided
    const minT = startTime || candles[0].time;
    const maxT = endTime || (candles[candles.length - 1].time + candleMs);
    const rangeT = maxT - minT || 1;
    const totalCandles = Math.ceil(rangeT / candleMs);

    const toX = (t: number) => chartLeft + ((t - minT) / rangeT) * (chartRight - chartLeft);
    const toY = (p: number) => chartBot - ((p - minP) / (maxP - minP)) * (chartBot - chartTop);

    // Grid lines + price labels
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let i = 0; i <= 3; i++) {
      const p = minP + (maxP - minP) * (i / 3);
      const y = toY(p);
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.toFixed(1) + '¢', chartLeft - 2, y);
    }

    // Time labels — evenly spaced across full duration
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    const labelCount = 4;
    for (let i = 0; i <= labelCount; i++) {
      const t = minT + rangeT * (i / labelCount);
      const d = new Date(t);
      ctx.fillText(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`, toX(t), chartBot + 2);
    }

    // Draw candles — width based on total market duration, not data count
    const candleW = Math.max(2, Math.min(12, ((chartRight - chartLeft) / Math.max(totalCandles, 1)) * 0.7));
    const bullColor = '#10b981';
    const bearColor = '#ef4444';

    for (const c of candles) {
      const cx = toX(c.time + candleMs / 2);
      const isBull = c.c >= c.o;
      const color = isBull ? bullColor : bearColor;

      // Wick
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.moveTo(cx, toY(c.h));
      ctx.lineTo(cx, toY(c.l));
      ctx.stroke();

      // Body
      const bodyTop = toY(Math.max(c.o, c.c));
      const bodyBot = toY(Math.min(c.o, c.c));
      const bodyH = Math.max(bodyBot - bodyTop, 1);
      ctx.fillStyle = color;
      ctx.fillRect(cx - candleW / 2, bodyTop, candleW, bodyH);
    }

    // Last price line
    const lastPrice = candles[candles.length - 1].c;
    const lastY = toY(lastPrice);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.moveTo(chartLeft, lastY);
    ctx.lineTo(chartRight, lastY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Last price label on right
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(lastPrice.toFixed(1) + '¢', chartRight, lastY - 6);

    // --- Chainlink price overlay (mapped onto 0-100¢ Y-axis, target = 50¢) ---
    const clCandles = Array.from(chainlinkCandleMapRef.current.values()).sort((a, b) => a.time - b.time);
    if (clCandles.length > 0 && targetPrice && targetPrice > 0) {
      // Find the max deviation from target to determine scale
      let maxDev = 0;
      for (const c of clCandles) {
        maxDev = Math.max(maxDev, Math.abs(c.h - targetPrice), Math.abs(c.l - targetPrice));
      }
      // Ensure a minimum spread so the line isn't flat
      if (maxDev === 0) maxDev = targetPrice * 0.001;

      // Map Chainlink USD price -> cents on the 0-100 scale
      // targetPrice -> 50¢, deviation scaled so maxDev maps to 50¢
      const clToCents = (p: number) => 50 + ((p - targetPrice) / maxDev) * 50;

      // Draw target price line (dashed, turquoise, at 50¢)
      const targetY = toY(50);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0,210,210,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(chartLeft, targetY);
      ctx.lineTo(chartRight, targetY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Chainlink price as a turquoise line connecting close prices
      ctx.beginPath();
      ctx.strokeStyle = '#00d2d2';
      ctx.lineWidth = 1.5;
      let started = false;
      for (const c of clCandles) {
        const cx = toX(c.time + candleMs / 2);
        const cy = toY(clToCents(c.c));
        if (!started) {
          ctx.moveTo(cx, cy);
          started = true;
        } else {
          ctx.lineTo(cx, cy);
        }
      }
      ctx.stroke();

      // Last Chainlink price label (turquoise)
      const clLast = clCandles[clCandles.length - 1].c;
      const clLastCents = clToCents(clLast);
      const clLastY = toY(clLastCents);
      ctx.fillStyle = '#00d2d2';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('$' + clLast.toFixed(clLast > 100 ? 0 : 2), chartLeft + 2, clLastY - 6);
    }
  }, [trades, isNo, ready, startTime, endTime, candleMs, wsTick, chainlinkReady, chainlinkTick, targetPrice]);

  useEffect(() => {
    draw();
  }, [draw]);

  if (!ready && trades.length === 0) return null;

  return (
    <div className="sidebar-section">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">Price Chart</span>
        <div className="flex gap-0.5">
          {(['1m', '5m', '15m', '1h'] as const).map((iv) => (
            <button
              key={iv}
              onClick={() => setInterval_(iv)}
              className={`px-1.5 py-0 text-[10px] rounded ${interval === iv ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
            >{iv}</button>
          ))}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 120, borderRadius: 6, background: '#1a1a2e' }}
      />
    </div>
  );
}
