import { useEffect, useRef, useState, useCallback } from 'react';

interface Candle {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface ChainlinkChartProps {
  asset: string;        // e.g. 'BTC', 'ETH', 'SOL', 'XRP'
  eventSlug?: string;   // used to determine timeframe
  targetPrice?: number | null;
}

// Determine kline interval from market slug
function getIntervalFromSlug(slug?: string): string {
  if (!slug) return '1h';
  const s = slug.toLowerCase();
  if (s.match(/updown-5m/) || s.match(/5[- ]?min/)) return '5m';
  if (s.match(/updown-15m/) || s.match(/15[- ]?min/)) return '15m';
  if (s.match(/up-or-down-on-/) || s.match(/24[- ]?h/)) return '1h';
  return '1h';
}

const GO_BASE = window.location.protocol === 'https:' ? '' : `http://${window.location.hostname}:3099`;
const WS_BASE = window.location.protocol === 'https:' ? `wss://${window.location.host}` : `ws://${window.location.hostname}:3099`;

const INTERVAL_MS: Record<string, number> = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000 };

export function ChainlinkChart({ asset, eventSlug, targetPrice }: ChainlinkChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const candleMapRef = useRef<Map<number, Candle>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  const interval = getIntervalFromSlug(eventSlug);
  const candleMs = INTERVAL_MS[interval] || 3600000;
  const clSymbol = `chainlink_${asset.toLowerCase()}usd`;

  // Fetch initial candles + subscribe WS
  useEffect(() => {
    candleMapRef.current = new Map();
    setReady(false);

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Fetch last 100 candles
    const endTime = Date.now();
    const startTime = endTime - 100 * candleMs;
    fetch(`${GO_BASE}/api/v3/klines?symbol=${clSymbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=100`)
      .then(r => r.json())
      .then((klines: any[][]) => {
        if (!Array.isArray(klines)) { setReady(true); return; }
        const map = candleMapRef.current;
        for (const k of klines) {
          const t = k[0] as number;
          map.set(t, {
            time: t,
            o: parseFloat(k[1] as string),
            h: parseFloat(k[2] as string),
            l: parseFloat(k[3] as string),
            c: parseFloat(k[4] as string),
          });
        }
        setReady(true);
      })
      .catch(() => setReady(true));

    // WS subscription
    const ws = new WebSocket(`${WS_BASE}/ws/chart`);
    wsRef.current = ws;
    let pingIv: ReturnType<typeof setInterval>;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribeKlineStream', data: { symbol: clSymbol, interval } }));
      pingIv = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 30000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'klineStreamUpdate') {
          const k = msg.data?.data?.k;
          if (!k) return;
          // Only process updates for our subscribed interval
          if (k.i !== interval) return;
          const map = candleMapRef.current;
          const t = k.t as number;
          // Backend sends full candle OHLC from memory — replace directly
          map.set(t, { time: t, o: parseFloat(k.o), h: parseFloat(k.h), l: parseFloat(k.l), c: parseFloat(k.c) });
          setTick(n => n + 1);
        }
      } catch {}
    };

    return () => {
      clearInterval(pingIv);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      wsRef.current = null;
    };
  }, [clSymbol, interval, candleMs]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const allCandles = Array.from(candleMapRef.current.values()).sort((a, b) => a.time - b.time);
    const candles = allCandles.slice(-25);

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
      ctx.fillText('Waiting for Chainlink data...', W / 2, H / 2);
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
    const bullColor = '#00d2d2';  // turquoise for up candles
    const bearColor = '#e91e90';  // pink for down candles

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
    const lastY = toY(lastC);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,210,210,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.moveTo(chartLeft, lastY);
    ctx.lineTo(chartRight, lastY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#00d2d2';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('$' + lastC.toFixed(decimals), chartLeft - 2, lastY);
  }, [ready, tick, targetPrice, interval, candleMs]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div className="sidebar-section">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">
          <span style={{ color: '#00d2d2' }}>◆</span> {asset} Chainlink
          <span className="text-gray-500 ml-1">{interval}</span>
        </span>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 100, borderRadius: 6, background: '#1a1a2e' }}
      />
    </div>
  );
}
