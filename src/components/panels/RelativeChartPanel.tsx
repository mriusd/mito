import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
type AssetSym = (typeof ASSETS)[number];

const LINE_COLORS: Record<AssetSym, string> = {
  BTC: '#fb923c',
  ETH: '#60a5fa',
  SOL: '#c084fc',
  XRP: '#22d3ee',
};

/** % points from mean of other assets at last bar — must exceed to consider “away from pack”. */
const DIVERGE_MIN_GAP_PP = 0.32;
/** % points — one-bar change in that gap counts as “sudden”. */
const DIVERGE_SUDDEN_DELTA_PP = 0.22;
const FLASH_PERIOD_MS = 110;

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
type IntervalKey = (typeof INTERVALS)[number];

const TIME_WINDOWS = ['1h', '2h', '4h', '12h', '24h', '3d', '7d'] as const;
type TimeWindowKey = (typeof TIME_WINDOWS)[number];

const INTERVAL_MS: Record<IntervalKey, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

const WINDOW_MS: Record<TimeWindowKey, number> = {
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '3d': 3 * 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
};

const LS_INTERVAL = 'polybot:relative-chart:interval';
const LS_WINDOW = 'polybot:relative-chart:window';

function readStoredInterval(): IntervalKey {
  try {
    const v = localStorage.getItem(LS_INTERVAL);
    if (v && (INTERVALS as readonly string[]).includes(v)) return v as IntervalKey;
  } catch {
    /* ignore */
  }
  return '1m';
}

function readStoredWindow(): TimeWindowKey {
  try {
    const v = localStorage.getItem(LS_WINDOW);
    if (v && (TIME_WINDOWS as readonly string[]).includes(v)) return v as TimeWindowKey;
  } catch {
    /* ignore */
  }
  return '4h';
}

interface Candle {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

function emptyMaps(): Record<AssetSym, Map<number, Candle>> {
  return {
    BTC: new Map(),
    ETH: new Map(),
    SOL: new Map(),
    XRP: new Map(),
  };
}

function parseKlineRow(k: unknown[]): Candle {
  return {
    time: k[0] as number,
    o: parseFloat(String(k[1])),
    h: parseFloat(String(k[2])),
    l: parseFloat(String(k[3])),
    c: parseFloat(String(k[4])),
  };
}

/** Shared open times across all assets in [windowStart, ∞); % vs first close in that slice. */
function buildPctSeries(
  maps: Record<AssetSym, Map<number, Candle>>,
  windowStart: number,
): {
  times: number[];
  pct: Record<AssetSym, number[]>;
} | null {
  const keySets = ASSETS.map((a) => {
    const keys = [...maps[a].keys()].filter((t) => t >= windowStart);
    return new Set(keys);
  });
  let inter: Set<number> | null = null;
  for (const s of keySets) {
    if (s.size === 0) return null;
    if (inter === null) {
      inter = new Set(s);
    } else {
      const prev: Set<number> = inter;
      inter = new Set([...prev].filter((t) => s.has(t)));
    }
  }
  if (!inter || inter.size < 2) return null;
  const times = [...inter].sort((a, b) => a - b);
  const pct: Record<AssetSym, number[]> = {
    BTC: [],
    ETH: [],
    SOL: [],
    XRP: [],
  };
  for (const sym of ASSETS) {
    const m = maps[sym];
    const closes = times.map((t) => m.get(t)!.c);
    const base = closes[0];
    if (!base || base <= 0) return null;
    pct[sym] = closes.map((c) => ((c / base) - 1) * 100);
  }
  return { times, pct };
}

function othersMeanAt(pct: Record<AssetSym, number[]>, idx: number, exclude: AssetSym): number {
  let s = 0;
  let c = 0;
  for (const a of ASSETS) {
    if (a === exclude) continue;
    s += pct[a][idx];
    c++;
  }
  return c > 0 ? s / c : 0;
}

/** Asset is flashing if it’s meaningfully away from the other three and the gap jumped on the latest bar. */
function computeFlashingAssets(pct: Record<AssetSym, number[]>): Set<AssetSym> {
  const out = new Set<AssetSym>();
  const n = pct.BTC.length;
  if (n < 3) return out;
  const i = n - 1;
  const j = n - 2;
  for (const sym of ASSETS) {
    const gapNow = pct[sym][i] - othersMeanAt(pct, i, sym);
    const gapPrev = pct[sym][j] - othersMeanAt(pct, j, sym);
    if (Math.abs(gapNow) >= DIVERGE_MIN_GAP_PP && Math.abs(gapNow - gapPrev) >= DIVERGE_SUDDEN_DELTA_PP) {
      out.add(sym);
    }
  }
  return out;
}

async function fetchKlinesForWindow(
  symbol: string,
  interval: IntervalKey,
  windowMs: number,
): Promise<Candle[]> {
  const ivMs = INTERVAL_MS[interval];
  const targetCount = Math.min(20_000, Math.ceil(windowMs / ivMs) + 8);
  const windowStart = Date.now() - windowMs;
  const byTime = new Map<number, Candle>();
  let endTime: number | undefined;
  let iterations = 0;

  while (iterations++ < 40 && byTime.size < targetCount) {
    const q =
      endTime === undefined
        ? `symbol=${symbol}USDT&interval=${interval}&limit=1500`
        : `symbol=${symbol}USDT&interval=${interval}&endTime=${endTime}&limit=1500`;
    const res = await fetch(`https://api.binance.com/api/v3/klines?${q}`);
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows) || rows.length === 0) break;
    let oldest = Infinity;
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const c = parseKlineRow(row);
      oldest = Math.min(oldest, c.time);
      byTime.set(c.time, c);
    }
    if (oldest <= windowStart) break;
    endTime = oldest - 1;
  }

  return [...byTime.values()]
    .filter((c) => c.time >= windowStart)
    .sort((a, b) => a.time - b.time);
}

export function RelativeChartPanel() {
  const [interval, setInterval] = useState<IntervalKey>(() => readStoredInterval());
  const [timeWindow, setTimeWindow] = useState<TimeWindowKey>(() => readStoredWindow());
  const [status, setStatus] = useState<string>('Connecting…');
  const [isResolutionLoading, setIsResolutionLoading] = useState(true);
  const mapsRef = useRef(emptyMaps());
  const wsRef = useRef<WebSocket | null>(null);
  const loadGenRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pulseRafRef = useRef(0);
  const [drawTick, setDrawTick] = useState(0);

  const bumpDraw = useCallback(() => setDrawTick((n) => n + 1), []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_INTERVAL, interval);
    } catch {
      /* ignore */
    }
  }, [interval]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_WINDOW, timeWindow);
    } catch {
      /* ignore */
    }
  }, [timeWindow]);

  // Fetch history + Binance spot combined kline stream
  useEffect(() => {
    const loadGen = ++loadGenRef.current;
    mapsRef.current = emptyMaps();
    setIsResolutionLoading(true);
    setStatus('Loading…');
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }

    const winMs = WINDOW_MS[timeWindow];
    const fetches = ASSETS.map((sym) =>
      fetchKlinesForWindow(sym, interval, winMs)
        .then((candles) => {
          const m = mapsRef.current[sym];
          for (const c of candles) m.set(c.time, c);
        })
        .catch(() => {}),
    );

    Promise.all(fetches).then(() => {
      if (loadGen !== loadGenRef.current) return;
      setStatus('Live');
      setIsResolutionLoading(false);
      bumpDraw();
    });

    const streams = ASSETS.map((a) => `${a.toLowerCase()}usdt@kline_${interval}`).join('/');
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const outer = JSON.parse(ev.data as string) as { stream?: string; data?: unknown };
        const msg = (outer.data ?? outer) as {
          e?: string;
          s?: string;
          k?: { t: number; o: string; h: string; l: string; c: string };
        };
        if (msg.e !== 'kline' || !msg.k || !msg.s) return;
        const sym = msg.s.replace(/USDT$/i, '');
        if (!(ASSETS as readonly string[]).includes(sym)) return;
        const asset = sym as AssetSym;
        const k = msg.k;
        const c: Candle = {
          time: k.t,
          o: parseFloat(k.o),
          h: parseFloat(k.h),
          l: parseFloat(k.l),
          c: parseFloat(k.c),
        };
        mapsRef.current[asset].set(c.time, c);
        bumpDraw();
      } catch {
        /* ignore */
      }
    };

    ws.onerror = () => setStatus('WebSocket error');
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [interval, timeWindow, bumpDraw]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = containerRef.current;
    if (!canvas || !wrap) return;

    const windowStart = Date.now() - WINDOW_MS[timeWindow];
    const built = buildPctSeries(mapsRef.current, windowStart);
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    const wCss = Math.max(100, rect.width);
    const hCss = Math.max(120, rect.height);
    canvas.width = wCss * dpr;
    canvas.height = hCss * dpr;
    canvas.style.width = `${wCss}px`;
    canvas.style.height = `${hCss}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    const W = wCss;
    const H = hCss;
    const padL = 44;
    const padR = 8;
    const padT = 6;
    const padB = 18;
    const chartL = padL;
    const chartR = W - padR;
    const chartT = padT;
    const chartB = H - padB;

    if (!built) {
      if (pulseRafRef.current) {
        cancelAnimationFrame(pulseRafRef.current);
        pulseRafRef.current = 0;
      }
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Waiting for Binance klines…', W / 2, H / 2);
      return;
    }

    const { times, pct } = built;
    const flashing = computeFlashingAssets(pct);
    if (flashing.size > 0) {
      if (!pulseRafRef.current) {
        const step = () => {
          pulseRafRef.current = requestAnimationFrame(step);
          bumpDraw();
        };
        pulseRafRef.current = requestAnimationFrame(step);
      }
    } else if (pulseRafRef.current) {
      cancelAnimationFrame(pulseRafRef.current);
      pulseRafRef.current = 0;
    }

    const flashPulse = 0.5 + 0.5 * Math.sin(Date.now() / FLASH_PERIOD_MS);
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const sym of ASSETS) {
      for (const v of pct[sym]) {
        yMin = Math.min(yMin, v);
        yMax = Math.max(yMax, v);
      }
    }
    const padY = Math.max(0.15, (yMax - yMin) * 0.08) || 0.5;
    yMin -= padY;
    yMax += padY;

    const toX = (i: number) =>
      chartL + (i / Math.max(1, times.length - 1)) * (chartR - chartL);
    const toY = (v: number) =>
      chartB - ((v - yMin) / (yMax - yMin)) * (chartB - chartT);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '9px monospace';
    for (let g = 0; g <= 4; g++) {
      const v = yMin + ((yMax - yMin) * g) / 4;
      const y = toY(v);
      ctx.beginPath();
      ctx.moveTo(chartL, y);
      ctx.lineTo(chartR, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${v >= 0 ? '+' : ''}${v.toFixed(2)}%`, chartL - 4, y);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(chartL, toY(0));
    ctx.lineTo(chartR, toY(0));
    ctx.stroke();

    for (const sym of ASSETS) {
      const ys = pct[sym];
      const isFlash = flashing.has(sym);
      ctx.strokeStyle = LINE_COLORS[sym];
      ctx.globalAlpha = isFlash ? 0.35 + 0.65 * flashPulse : 1;
      ctx.lineWidth = isFlash ? 1.5 + 2.25 * flashPulse : 1.5;
      ctx.beginPath();
      for (let i = 0; i < ys.length; i++) {
        const x = toX(i);
        const y = toY(ys[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelN = Math.min(5, times.length);
    const spanDays = (times[times.length - 1] - times[0]) / (24 * 60 * 60 * 1000);
    const showTime = spanDays < 2;
    for (let g = 0; g < labelN; g++) {
      const i = Math.round((g * (times.length - 1)) / Math.max(1, labelN - 1));
      const d = new Date(times[i]);
      const datePart = `${d.getMonth() + 1}/${d.getDate()}`;
      const timePart = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      ctx.fillText(showTime ? `${datePart} ${timePart}` : datePart, toX(i), chartB + 3);
    }
  }, [timeWindow, bumpDraw]);

  useLayoutEffect(() => {
    draw();
  }, [draw, drawTick, interval, timeWindow]);

  useEffect(() => {
    return () => {
      if (pulseRafRef.current) {
        cancelAnimationFrame(pulseRafRef.current);
        pulseRafRef.current = 0;
      }
    };
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(() => bumpDraw());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [bumpDraw]);

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0 h-full">
      <div className="panel-header flex items-center gap-2 mb-2 flex-wrap cursor-grab shrink-0">
        <h3 className="text-sm font-bold text-cyan-300">Relative Chart</h3>
        <span className="text-[9px] text-gray-500 ml-1">% change vs window open (Binance spot)</span>
        <span className="text-[9px] text-gray-500 ml-auto">{status}</span>
      </div>
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 shrink-0 cursor-default"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <label className="flex items-center gap-1.5 min-w-0">
          <span className="text-[9px] text-gray-500 shrink-0">Resolution</span>
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as IntervalKey)}
            className="max-w-full rounded border border-cyan-700/50 bg-gray-900/90 py-0.5 pl-1.5 pr-6 text-[10px] font-semibold text-cyan-100 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
            aria-label="Chart resolution"
          >
            {INTERVALS.map((iv) => (
              <option key={iv} value={iv}>
                {iv}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 min-w-0">
          <span className="text-[9px] text-gray-500 shrink-0">Window</span>
          <select
            value={timeWindow}
            onChange={(e) => setTimeWindow(e.target.value as TimeWindowKey)}
            className="max-w-full rounded border border-violet-700/50 bg-gray-900/90 py-0.5 pl-1.5 pr-6 text-[10px] font-semibold text-violet-100 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            aria-label="Chart time window"
          >
            {TIME_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-3 mb-1 shrink-0 text-[10px] cursor-default" onPointerDown={(e) => e.stopPropagation()}>
        {ASSETS.map((sym) => (
          <span key={sym} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: LINE_COLORS[sym] }} />
            <span style={{ color: LINE_COLORS[sym] }} className="font-bold">
              {sym}
            </span>
          </span>
        ))}
      </div>
      <div ref={containerRef} className="flex-1 min-h-[160px] min-w-0 relative">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
        {isResolutionLoading && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded bg-gray-950/75 backdrop-blur-[2px]"
            aria-busy="true"
            aria-live="polite"
          >
            <div
              className="h-9 w-9 rounded-full border-2 border-cyan-500/25 border-t-cyan-400 animate-spin"
              role="presentation"
            />
            <span className="text-[10px] font-medium tracking-wide text-gray-400">Loading chart…</span>
          </div>
        )}
      </div>
    </div>
  );
}
