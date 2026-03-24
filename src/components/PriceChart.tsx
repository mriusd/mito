import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchPriceHistory } from '../api';
import { useAppStore } from '../stores/appStore';
import type { Market } from '../types';

interface Candle {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface ChartState {
  candles: Candle[];
  minP: number;
  maxP: number;
  minT: number;
  maxT: number;
  rangeT: number;
  chartLeft: number;
  chartRight: number;
  chartTop: number;
  chartBot: number;
  bullColor: string;
  bearColor: string;
  isNo: boolean;
  toX: (t: number) => number;
  toY: (p: number) => number;
  W: number;
  H: number;
  dpr: number;
  tokenIds: string[];
  candleInterval: number;
}

function buildCandles(points: { time: number; price: number }[], _targetCount: number, interval: number): Candle[] {
  if (points.length < 2) return [];
  if (!interval) interval = 3600000;
  const candles: Candle[] = [];
  let bucket: Candle | null = null;
  for (const pt of points) {
    const bucketStart = Math.floor(pt.time / interval) * interval;
    if (!bucket || bucket.time !== bucketStart) {
      if (bucket) candles.push(bucket);
      bucket = { time: bucketStart, o: pt.price, h: pt.price, l: pt.price, c: pt.price };
    } else {
      bucket.h = Math.max(bucket.h, pt.price);
      bucket.l = Math.min(bucket.l, pt.price);
      bucket.c = pt.price;
    }
  }
  if (bucket) candles.push(bucket);
  return candles;
}

function drawCandleChart(ctx: CanvasRenderingContext2D, s: ChartState) {
  ctx.clearRect(0, 0, s.W, s.H);

  // Grid lines and price labels
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.font = '9px monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  for (let i = 0; i <= 4; i++) {
    const p = s.minP + (s.maxP - s.minP) * (i / 4);
    const y = s.toY(p);
    ctx.beginPath();
    ctx.moveTo(s.chartLeft, y);
    ctx.lineTo(s.chartRight, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.toFixed(1) + '¢', s.chartLeft - 3, y);
  }

  // Time labels — max 3 ticks (start / mid / end) so labels don’t overlap in narrow sidebar
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const timeTicks = 3;
  const spanDays = s.rangeT / 86400000;
  for (let i = 0; i < timeTicks; i++) {
    const t = timeTicks <= 1 ? s.minT : s.minT + s.rangeT * (i / (timeTicks - 1));
    const d = new Date(t);
    let label: string;
    if (spanDays < 1.5) {
      label = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    } else if (spanDays < 14) {
      label = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    } else {
      label = `${d.getMonth() + 1}/${d.getDate()}`;
    }
    ctx.fillText(label, s.toX(t), s.chartBot + 3);
  }

  // Draw candles
  const candleW = Math.max(2, ((s.chartRight - s.chartLeft) / s.candles.length) * 0.7);
  for (const c of s.candles) {
    const cx = s.toX(c.time);
    const isBull = c.c >= c.o;
    const color = isBull ? s.bullColor : s.bearColor;

    // Wick
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.moveTo(cx, s.toY(c.h));
    ctx.lineTo(cx, s.toY(c.l));
    ctx.stroke();

    // Body
    const bodyTop = s.toY(Math.max(c.o, c.c));
    const bodyBot = s.toY(Math.min(c.o, c.c));
    const bodyH = Math.max(bodyBot - bodyTop, 1);
    ctx.fillStyle = color;
    ctx.fillRect(cx - candleW / 2, bodyTop, candleW, bodyH);
  }

  // Draw open order lines
  const orders = (window as any)._cachedOrders || [];
  const halfW = (s.chartRight - s.chartLeft) / 2;
  ctx.font = 'bold 9px monospace';
  for (const order of orders) {
    const tid = order.asset_id || order.token_id || '';
    if (!s.tokenIds.includes(tid)) continue;
    const outcome = s.tokenIds[0] === tid ? 'YES' : 'NO';
    let priceCents = parseFloat(order.price) * 100;
    if (s.isNo && outcome === 'YES') priceCents = 100 - priceCents;
    else if (!s.isNo && outcome === 'NO') priceCents = 100 - priceCents;
    if (priceCents < s.minP || priceCents > s.maxP) continue;
    const y = s.toY(priceCents);
    const isBuy = order.side === 'BUY';
    const clr = isBuy ? '#10b981' : '#ef4444';
    const lineX0 = s.chartRight - halfW;
    ctx.beginPath();
    ctx.strokeStyle = clr;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.moveTo(lineX0, y);
    ctx.lineTo(s.chartRight, y);
    ctx.stroke();
    ctx.setLineDash([]);
    const qty = parseFloat(order.original_size || order.size || 0).toFixed(0);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = clr;
    ctx.fillText(qty, s.chartRight - 2, y - 2);
  }

  // Draw open position lines
  const positions = (window as any)._cachedPositions || [];
  for (const pos of positions) {
    if (!s.tokenIds.includes(pos.asset)) continue;
    const outcome = s.tokenIds[0] === pos.asset ? 'YES' : 'NO';
    let avgCents = parseFloat(pos.avgPrice || 0) * 100;
    if (s.isNo && outcome === 'YES') avgCents = 100 - avgCents;
    else if (!s.isNo && outcome === 'NO') avgCents = 100 - avgCents;
    if (avgCents < s.minP || avgCents > s.maxP) continue;
    const y = s.toY(avgCents);
    ctx.beginPath();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.moveTo(s.chartLeft, y);
    ctx.lineTo(s.chartRight, y);
    ctx.stroke();
    ctx.setLineDash([]);
    const size = parseFloat(pos.size || 0).toFixed(0);
    const label = `${size} @${avgCents.toFixed(1)}`;
    const sizeColor = outcome === 'YES' ? '#10b981' : '#ef4444';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = sizeColor;
    ctx.fillText(label, s.chartLeft + 2, y - 2);
  }
}

interface PriceChartProps {
  market: Market;
  isNo: boolean;
}

export function PriceChart({ market, isNo }: PriceChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartStateRef = useRef<ChartState | null>(null);
  const baseImageRef = useRef<ImageData | null>(null);
  const drawIdRef = useRef(0);
  const [hasData, setHasData] = useState(true);
  const orders = useAppStore((s) => s.orders);
  const positions = useAppStore((s) => s.positions);

  // Store orders/positions on window for chart overlay access
  useEffect(() => {
    (window as any)._cachedOrders = orders;
  }, [orders]);
  useEffect(() => {
    (window as any)._cachedPositions = positions;
  }, [positions]);

  const tokenId = market.clobTokenIds?.[0] || '';

  const fetchAndDraw = useCallback(async () => {
    const drawId = ++drawIdRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !tokenId) { setHasData(false); return; }

    chartStateRef.current = null;
    baseImageRef.current = null;

    try {
      const data = await fetchPriceHistory(tokenId, 'max', '60');
      if (drawId !== drawIdRef.current) return;
      const history = data.history || [];
      if (!history.length) { setHasData(false); return; }

      const points = history.map(h => ({
        time: h.t * 1000,
        price: isNo ? (1 - h.p) * 100 : h.p * 100,
      })).filter(p => p.time > 0 && !isNaN(p.price)).sort((a, b) => a.time - b.time);

      if (points.length < 2) { setHasData(false); return; }

      // Wait a frame for layout
      await new Promise(r => requestAnimationFrame(r));
      if (drawId !== drawIdRef.current) return;

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

      const candleInterval = 3600000;
      const candles = buildCandles(points, 40, candleInterval);
      if (candles.length < 2) { setHasData(false); return; }

      setHasData(true);

      const minP = 0;
      const maxP = 99;
      const minT = candles[0].time;
      const maxT = candles[candles.length - 1].time;
      const rangeT = maxT - minT || 1;

      const chartLeft = 30;
      const chartRight = W - 8;
      const chartTop = 8;
      const chartBot = H - 18;
      const bullColor = isNo ? '#ef4444' : '#10b981';
      const bearColor = isNo ? '#10b981' : '#ef4444';

      const toX = (t: number) => chartLeft + ((t - minT) / rangeT) * (chartRight - chartLeft);
      const toY = (p: number) => chartBot - ((p - minP) / (maxP - minP)) * (chartBot - chartTop);

      const tokenIds = market.clobTokenIds || [];
      const state: ChartState = { candles, minP, maxP, minT, maxT, rangeT, chartLeft, chartRight, chartTop, chartBot, bullColor, bearColor, isNo, toX, toY, W, H, dpr, tokenIds, candleInterval };

      chartStateRef.current = state;
      drawCandleChart(ctx, state);
      baseImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      setHasData(false);
    }
  }, [tokenId, isNo, market.clobTokenIds]);

  useEffect(() => { fetchAndDraw(); }, [fetchAndDraw]);

  // Redraw when orders/positions change (for overlays)
  useEffect(() => {
    const canvas = canvasRef.current;
    const s = chartStateRef.current;
    if (!canvas || !s) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(s.dpr, s.dpr);
    drawCandleChart(ctx, s);
    baseImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, [orders, positions]);

  // Mouse hover for OHLC tooltip
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = chartStateRef.current;
    const base = baseImageRef.current;
    const canvas = canvasRef.current;
    if (!s || !base || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const _my = e.clientY - rect.top;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(base, 0, 0);

    if (mx < s.chartLeft || mx > s.chartRight) return;

    // Find nearest candle
    let nearest: Candle | null = null;
    let nearestDist = Infinity;
    for (const c of s.candles) {
      const cx = s.toX(c.time);
      const dist = Math.abs(cx - mx);
      if (dist < nearestDist) { nearestDist = dist; nearest = c; }
    }
    if (!nearest) return;

    ctx.scale(s.dpr, s.dpr);
    const cx = s.toX(nearest.time);

    // Vertical crosshair
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.moveTo(cx, s.chartTop);
    ctx.lineTo(cx, s.chartBot);
    ctx.stroke();
    ctx.setLineDash([]);

    // Highlight candle outline
    const isBull = nearest.c >= nearest.o;
    const color = isBull ? s.bullColor : s.bearColor;
    const candleW = Math.max(2, ((s.chartRight - s.chartLeft) / s.candles.length) * 0.7);
    const bodyTop = s.toY(Math.max(nearest.o, nearest.c));
    const bodyBot = s.toY(Math.min(nearest.o, nearest.c));
    const bodyH = Math.max(bodyBot - bodyTop, 1);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - candleW / 2 - 1, bodyTop - 1, candleW + 2, bodyH + 2);

    // OHLC Tooltip
    const d = new Date(nearest.time);
    const dateStr = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    const line1 = dateStr;
    const line2 = `O ${nearest.o.toFixed(1)}  H ${nearest.h.toFixed(1)}  L ${nearest.l.toFixed(1)}  C ${nearest.c.toFixed(1)}`;

    ctx.font = 'bold 11px monospace';
    const tw = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 12;
    const th = 32;
    let tx = cx - tw / 2;
    if (tx < s.chartLeft) tx = s.chartLeft;
    if (tx + tw > s.chartRight) tx = s.chartRight - tw;
    const ty = s.chartTop;

    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.beginPath();
    (ctx as any).roundRect(tx, ty, tw, th, 4);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(line1, tx + tw / 2, ty + 10);
    ctx.fillStyle = '#fff';
    ctx.fillText(line2, tx + tw / 2, ty + 23);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, []);

  const handleMouseLeave = useCallback(() => {
    const base = baseImageRef.current;
    const canvas = canvasRef.current;
    if (!base || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(base, 0, 0);
  }, []);

  if (!tokenId) return null;
  if (!hasData) return null;

  return (
    <div className="sidebar-section">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">Price History</span>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 110, borderRadius: 6, background: '#1a1a2e' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}
