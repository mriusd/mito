import { useEffect, useRef, useCallback, useState } from 'react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import { API_BASE, WS_BASE } from '../lib/env';
import { resolveLiveTradeChartWindow } from '../lib/walletInfoChartMarket';

interface Candle {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function toPrice(raw: number, isNo: boolean): number {
  return isNo ? 100 - raw : raw;
}

const INTERVAL_MS: Record<string, number> = { '5s': 5000, '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
const CHART_INTERVALS = ['5s', '1m', '5m', '15m'] as const;
type ChartInterval = (typeof CHART_INTERVALS)[number];
const LIVE_TRADE_CHART_INTERVAL_LS_KEY = 'polybot-live-trade-chart-interval';

function readStoredChartInterval(): ChartInterval | null {
  try {
    const v = localStorage.getItem(LIVE_TRADE_CHART_INTERVAL_LS_KEY);
    if (v && (CHART_INTERVALS as readonly string[]).includes(v)) return v as ChartInterval;
  } catch {
    /* ignore */
  }
  return null;
}

function persistChartInterval(iv: ChartInterval) {
  try {
    localStorage.setItem(LIVE_TRADE_CHART_INTERVAL_LS_KEY, iv);
  } catch {
    /* ignore */
  }
}

export type ChartTradeMarker = {
  timeMs: number;
  priceCents: number;
  side: 'BUY' | 'SELL';
};

interface LiveTradeChartProps {
  trades: LiveTrade[];
  isNo: boolean;
  tokenId?: string;
  startTime?: number;
  endTime?: number;
  /** Slug + question + group title — default candle resolution for longer Up/Down windows */
  intervalContext?: string;
  /** When set, wins over intervalContext parsing (e.g. sidebar Up/Down duration → kline size). */
  defaultIntervalOverride?: string;
  chainlinkAsset?: string; // e.g. 'BTC' -> fetches chainlink_btcusd candles
  targetPrice?: number | null; // target price in USD, placed at 50% Y-axis
  /** Hide dashed last-outcome-price line and spot (Binance/Chainlink) overlay — sidebar right chart */
  hidePriceLines?: boolean;
  /** Wallet fills — tiny buy/sell ticks to the right of candles. */
  tradeMarkers?: ChartTradeMarker[];
  /** Resolution picker UI — sidebar right uses dropdown. */
  intervalSelector?: 'buttons' | 'dropdown';
}

function defaultInterval(context?: string): string {
  if (!context) return '1m';
  const s = context.toLowerCase();
  if (s.match(/updown-4h/) || s.match(/\b4[- ]?h\b/)) return '15m';
  if (s.match(/up-or-down-on-/) || s.match(/\b24[- ]?h\b/)) return '15m';
  if (s.match(/updown-1h/) || s.match(/(?:^|[^0-9])1[- ]?h\b/) || s.match(/\b1[- ]?hour\b/)) return '5m';
  return '1m';
}

export function LiveTradeChart({
  trades,
  isNo,
  tokenId,
  startTime,
  endTime,
  intervalContext,
  defaultIntervalOverride,
  chainlinkAsset,
  targetPrice,
  hidePriceLines,
  tradeMarkers,
  intervalSelector = 'buttons',
}: LiveTradeChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const candleMapRef = useRef<Map<number, Candle>>(new Map());
  const chainlinkCandleMapRef = useRef<Map<number, Candle>>(new Map());
  const lastTradeCountRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [chainlinkReady, setChainlinkReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const chainlinkWsRef = useRef<WebSocket | null>(null);
  const resolvedDefaultInterval = defaultIntervalOverride || defaultInterval(intervalContext);
  const [interval, setInterval_] = useState<ChartInterval>(
    () => readStoredChartInterval() ?? (resolvedDefaultInterval as ChartInterval),
  );
  const [wsTick, setWsTick] = useState(0);
  const [chainlinkTick, setChainlinkTick] = useState(0);

  const setChartInterval = useCallback((iv: ChartInterval) => {
    setInterval_(iv);
    persistChartInterval(iv);
  }, []);

  const candleMs = INTERVAL_MS[interval] || 60000;

  // Reset candle map + fetch klines from Go backend + subscribe to WS (reconnect + tab visibility)
  useEffect(() => {
    candleMapRef.current = new Map();
    lastTradeCountRef.current = 0;
    setReady(false);

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }

    if (!tokenId) return;

    let cancelled = false;
    let reconnectTimeout: number | null = null;
    let pingIv: number | null = null;
    let reconnectAttempt = 0;

    const { startMs: st, endMs: et } = resolveLiveTradeChartWindow(tokenId, startTime, endTime);

    const applyKlines = (klines: any[][]) => {
      if (!Array.isArray(klines)) return;
      const map = candleMapRef.current;
      for (const k of klines) {
        const openTime = k[0] as number;
        const o = toPrice(parseFloat(k[1] as string) * 100, isNo);
        const h = toPrice(parseFloat(k[2] as string) * 100, isNo);
        const l = toPrice(parseFloat(k[3] as string) * 100, isNo);
        const c = toPrice(parseFloat(k[4] as string) * 100, isNo);
        const v = parseFloat(k[5] as string) || 0;
        const hi = Math.max(o, h, l, c);
        const lo = Math.min(o, h, l, c);
        map.set(openTime, { time: openTime, o, h: hi, l: lo, c, v });
      }
    };

    const klineQuery = `symbol=${encodeURIComponent(tokenId)}&interval=${interval}&startTime=${st}&endTime=${et}&limit=900`;

    const loadKlines = () => {
      const applyHistory = () =>
        fetch(`${API_BASE}/api/v3/klines/history?${klineQuery}`)
          .then((r) => r.json())
          .then((hist: any[][]) => {
            if (cancelled) return;
            if (Array.isArray(hist) && hist.length > 0) applyKlines(hist);
          });

      return fetch(`${API_BASE}/api/v3/klines?${klineQuery}`)
        .then((r) => r.json())
        .then((klines: any[][]) => {
          if (cancelled) return;
          if (Array.isArray(klines) && klines.length > 0) {
            applyKlines(klines);
            return;
          }
          return applyHistory();
        })
        .catch(() => {
          if (cancelled) return;
          return applyHistory();
        })
        .finally(() => {
          if (!cancelled) setReady(true);
        });
    };

    void loadKlines();

    const clearPing = () => {
      if (pingIv != null) {
        clearInterval(pingIv);
        pingIv = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = Math.min(30_000, 800 * Math.pow(2, reconnectAttempt));
      reconnectAttempt = Math.min(reconnectAttempt + 1, 10);
      reconnectTimeout = window.setTimeout(() => {
        reconnectTimeout = null;
        connectWs();
      }, delay);
    };

    const connectWs = () => {
      if (cancelled || !tokenId) return;

      clearPing();
      const prev = wsRef.current;
      if (prev && (prev.readyState === WebSocket.OPEN || prev.readyState === WebSocket.CONNECTING)) {
        try {
          prev.close();
        } catch {
          /* ignore */
        }
      }
      wsRef.current = null;

      const ws = new WebSocket(`${WS_BASE}/ws/chart`);
      wsRef.current = ws;
      const isLiveSocket = () => wsRef.current === ws;

      ws.onopen = () => {
        if (cancelled || !isLiveSocket()) return;
        const wasReconnect = reconnectAttempt > 0;
        reconnectAttempt = 0;
        ws.send(
          JSON.stringify({
            type: 'subscribeKlineStream',
            data: { symbol: tokenId, interval },
          }),
        );
        pingIv = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30_000);
        if (wasReconnect) {
          void loadKlines().then(() => {
            if (!cancelled) setWsTick((n) => n + 1);
          });
        }
      };

      ws.onmessage = (event) => {
        if (!isLiveSocket()) return;
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
            const v = parseFloat(k.v) || 0;
            const hi = Math.max(o, h, l, c);
            const lo = Math.min(o, h, l, c);
            map.set(openTime, { time: openTime, o, h: hi, l: lo, c, v });
            setWsTick((n) => n + 1);
          }
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        if (!isLiveSocket()) return;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        // Ignore close events from stale sockets we intentionally replaced.
        if (!isLiveSocket()) return;
        clearPing();
        wsRef.current = null;
        if (!cancelled) scheduleReconnect();
      };
    };

    const onVisibility = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      const w = wsRef.current;
      if (w && w.readyState === WebSocket.OPEN) return;
      reconnectAttempt = 0;
      if (reconnectTimeout != null) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      void loadKlines().then(() => {
        if (!cancelled) setWsTick((n) => n + 1);
      });
      connectWs();
    };

    connectWs();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (reconnectTimeout != null) clearTimeout(reconnectTimeout);
      clearPing();
      const w = wsRef.current;
      if (w && (w.readyState === WebSocket.OPEN || w.readyState === WebSocket.CONNECTING)) {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }
      wsRef.current = null;
    };
  }, [tokenId, isNo, startTime, endTime, interval]);

  // Fetch Binance klines + subscribe to Binance WS for live price overlay
  useEffect(() => {
    chainlinkCandleMapRef.current = new Map();
    setChainlinkReady(false);

    if (chainlinkWsRef.current) {
      chainlinkWsRef.current.close();
      chainlinkWsRef.current = null;
    }

    if (!chainlinkAsset || hidePriceLines) {
      setChainlinkReady(true);
      return;
    }

    const binanceSymbol = `${chainlinkAsset.toUpperCase()}USDT`;
    const binanceStream = `${chainlinkAsset.toLowerCase()}usdt`;

    // Fetch initial candles from Binance spot REST
    fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=500`)
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
          map.set(openTime, { time: openTime, o, h, l, c, v: 0 });
        }
        setChainlinkReady(true);
      })
      .catch(() => setChainlinkReady(true));

    // Subscribe to Binance spot kline WS for live updates
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${binanceStream}@kline_${interval}`);
    chainlinkWsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.e === 'kline' && msg.k) {
          const k = msg.k;
          const map = chainlinkCandleMapRef.current;
          const openTime = k.t as number;
          map.set(openTime, { time: openTime, o: parseFloat(k.o), h: parseFloat(k.h), l: parseFloat(k.l), c: parseFloat(k.c), v: 0 });
          setChainlinkTick(n => n + 1);
        }
      } catch {}
    };

    ws.onclose = () => {};
    ws.onerror = () => {};

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      chainlinkWsRef.current = null;
    };
  }, [chainlinkAsset, hidePriceLines, startTime, endTime, interval]);

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

    const chartLeft = 36;
    const chartRight = W - 4;
    const chartTop = 4;
    /** hh:mm sits in bottom band — 0¢ is drawn flush above it */
    const timeBand = 13;
    const gapZeroAboveTimeLabels = 2;
    const chartBot = H - timeBand - gapZeroAboveTimeLabels;
    /** Volume grows downward past chartBot through time-band (below candle pane) */
    const volFloor = H - 2;

    // Fixed 0-100 Y-axis range
    const minP = 0;
    const maxP = 100;

    // X-axis spans market window (startTime/endTime) like sidebar right chart
    const minT = startTime || candles[0].time;
    const maxT = endTime || candles[candles.length - 1].time + candleMs;
    const rangeT = maxT - minT || 1;
    const totalCandles = Math.ceil(rangeT / candleMs);

    const toX = (t: number) => chartLeft + ((t - minT) / rangeT) * (chartRight - chartLeft);
    const toY = (p: number) => chartBot - ((p - minP) / (maxP - minP)) * (chartBot - chartTop);

    // Grid lines + price labels (every 10¢ on 0–100¢ axis)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let cents = 0; cents <= 100; cents += 10) {
      const y = toY(cents);
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${cents}¢`, chartLeft - 2, y);
    }

    /** Time labels sit below chartBot in bottom band (drawn last for z-order) */
    const timeLabelY = chartBot + gapZeroAboveTimeLabels;

    // Candle widths — before volume (volume drawn behind candles)
    const candleW = Math.max(2, Math.min(12, ((chartRight - chartLeft) / Math.max(totalCandles, 1)) * 0.7));

    // Volume bars — span into candle pane + full overflow through time band to bottom
    const volBleedUp = Math.min(40, Math.floor((chartBot - chartTop) * 0.38));
    const volCeil = chartBot - volBleedUp;
    const volSpanPx = Math.max(8, volFloor - volCeil);
    let maxVol = 0;
    for (const c of candles) {
      if (c.v > maxVol) maxVol = c.v;
    }
    if (maxVol > 0) {
      for (const c of candles) {
        if (c.v <= 0) continue;
        const cx = toX(c.time + candleMs / 2);
        const isBull = c.c >= c.o;
        const barH = Math.max(1, (c.v / maxVol) * volSpanPx);
        ctx.fillStyle = isBull ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)';
        ctx.fillRect(cx - candleW / 2, volFloor - barH, candleW, barH);
      }
    }

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

    if (tradeMarkers && tradeMarkers.length > 0) {
      const tickW = 5;
      const tickGap = 1;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      for (const m of tradeMarkers) {
        if (m.timeMs < minT - candleMs || m.timeMs > maxT + candleMs) continue;
        const bucketOpen = minT + Math.floor((m.timeMs - minT) / candleMs) * candleMs;
        const candleCx = toX(bucketOpen + candleMs / 2);
        const tickX0 = candleCx + candleW / 2 + tickGap;
        const y = toY(Math.max(0, Math.min(100, m.priceCents)));
        ctx.strokeStyle = m.side === 'BUY' ? '#2563eb' : '#facc15';
        ctx.beginPath();
        ctx.moveTo(tickX0, y);
        ctx.lineTo(tickX0 + tickW, y);
        ctx.stroke();
      }
    }

    const lastPrice = candles[candles.length - 1].c;
    const lastY = toY(lastPrice);
    if (!hidePriceLines) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.moveTo(chartLeft, lastY);
      ctx.lineTo(chartRight, lastY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Latest candle close (no horizontal line when hidePriceLines — label only)
    const labelY = Math.max(chartTop + 8, Math.min(chartBot - 8, lastY));
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(lastPrice.toFixed(1) + '¢', chartRight - 2, labelY);

    // --- Chainlink / Binance price overlay (mapped onto 0-100¢ Y-axis, target = 50¢) ---
    // X-axis is only [minT, maxT] (market window). Binance fetch keeps ~500 candles of history;
    // plotting all of them maps pre-window times to x << chartLeft, so the segment from the last
    // off-screen point to the first on-screen point draws a bogus diagonal across the chart.
    const clAll = Array.from(chainlinkCandleMapRef.current.values()).sort((a, b) => a.time - b.time);
    const clCandles = clAll.filter(
      (c) => c.time < maxT + candleMs && c.time + candleMs > minT
    );
    if (!hidePriceLines && clCandles.length > 0 && targetPrice && targetPrice > 0) {
      // Scale from deviation from target (include closes so spikes stay in range)
      let maxDev = 0;
      for (const c of clCandles) {
        maxDev = Math.max(
          maxDev,
          Math.abs(c.h - targetPrice),
          Math.abs(c.l - targetPrice),
          Math.abs(c.c - targetPrice)
        );
      }
      if (maxDev === 0) maxDev = targetPrice * 0.001;

      const clToCents = (p: number) => {
        const v = 50 + ((p - targetPrice) / maxDev) * 50;
        return Math.max(0, Math.min(100, v));
      };

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

      ctx.strokeStyle = '#00d2d2';
      ctx.lineWidth = 1.5;
      if (clCandles.length === 1) {
        const c = clCandles[0];
        const cx = toX(c.time + candleMs / 2);
        const cy = toY(clToCents(c.c));
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#00d2d2';
        ctx.fill();
      } else {
        ctx.beginPath();
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
      }

      const clLast = clCandles[clCandles.length - 1].c;
      const clLastCents = clToCents(clLast);
      const clLastY = toY(clLastCents);
      ctx.fillStyle = '#00d2d2';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('$' + clLast.toFixed(clLast > 100 ? 0 : 2), chartLeft + 2, clLastY - 6);
    }

    // Time labels — on top so volume overflow through band stays readable where not covered
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    const labelCount = 4;
    const fmtTime = (t: number) => {
      const d = new Date(t);
      const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      if (interval === '5s') return `${hm}:${String(d.getSeconds()).padStart(2, '0')}`;
      return hm;
    };
    for (let i = 0; i <= labelCount; i++) {
      const t = minT + rangeT * (i / labelCount);
      ctx.fillText(fmtTime(t), toX(t), timeLabelY);
    }
  }, [trades, isNo, ready, startTime, endTime, candleMs, wsTick, chainlinkReady, chainlinkTick, targetPrice, hidePriceLines, tradeMarkers, interval]);

  useEffect(() => {
    draw();
  }, [draw]);

  if (!tokenId) return null;

  return (
    <div className="sidebar-section">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">Price</span>
        {intervalSelector === 'dropdown' ? (
          <select
            value={interval}
            onChange={(e) => setChartInterval(e.target.value as ChartInterval)}
            className="min-w-[3.5rem] w-16 shrink-0 rounded border border-gray-600 bg-gray-800 py-0 pl-1.5 pr-6 text-[10px] font-medium text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
            aria-label="Chart resolution"
          >
            {CHART_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>
                {iv}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex gap-0.5">
            {CHART_INTERVALS.map((iv) => (
              <button
                key={iv}
                onClick={() => setChartInterval(iv)}
                className={`px-1.5 py-0 text-[10px] rounded ${interval === iv ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
              >{iv}</button>
            ))}
          </div>
        )}
      </div>
      {tradeMarkers != null ? (
        <div className="mb-0.5 flex items-center gap-2.5 text-[9px] text-gray-500">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-2.5 shrink-0 rounded-full bg-[#2563eb]" aria-hidden />
            buy
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-0.5 w-2.5 shrink-0 rounded-full bg-[#facc15]" aria-hidden />
            sell
          </span>
        </div>
      ) : null}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 110, borderRadius: 6, background: '#1a1a2e' }}
      />
    </div>
  );
}
