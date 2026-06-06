import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  FUNDING_ASSETS,
  fetchFundingSnapshot,
  fmtFundingRate,
  fundingSubscribePayload,
  fundingWsUrl,
  parseFundingSnapshot,
  type FundingAsset,
  type FundingPoint,
} from '../../lib/binanceFundingFeed';

const LINE_COLORS: Record<FundingAsset, string> = {
  BTC: '#fb923c',
  ETH: '#60a5fa',
  SOL: '#c084fc',
  XRP: '#22d3ee',
};

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
type IntervalKey = (typeof INTERVALS)[number];

const TIME_WINDOWS = ['1h', '2h', '4h', '12h', '24h', '3d', '7d'] as const;
type TimeWindowKey = (typeof TIME_WINDOWS)[number];

const WINDOW_MS: Record<TimeWindowKey, number> = {
  '1h': 60 * 60_000,
  '2h': 2 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '3d': 3 * 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
};

const LS_INTERVAL = 'polybot:funding-rate:interval';
const LS_WINDOW = 'polybot:funding-rate:window';

function readStoredInterval(): IntervalKey {
  try {
    const v = localStorage.getItem(LS_INTERVAL);
    if (v && (INTERVALS as readonly string[]).includes(v)) return v as IntervalKey;
  } catch {
    /* ignore */
  }
  return '1m';
}

function fundingRateTextClass(r: number | undefined): string {
  if (r == null || !Number.isFinite(r) || r === 0) return 'text-gray-400';
  return r > 0 ? 'text-emerald-400' : 'text-red-400';
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

function emptyMaps(): Record<FundingAsset, Map<number, number>> {
  return { BTC: new Map(), ETH: new Map(), SOL: new Map(), XRP: new Map() };
}

function applySnapshot(
  maps: Record<FundingAsset, Map<number, number>>,
  assets: Partial<Record<FundingAsset, { points: FundingPoint[] }>>,
  windowStart: number,
) {
  for (const sym of FUNDING_ASSETS) maps[sym].clear();
  for (const sym of FUNDING_ASSETS) {
    const pts = assets[sym]?.points ?? [];
    for (const p of pts) {
      if (p.t >= windowStart) maps[sym].set(p.t, p.r);
    }
  }
}

function buildSeries(
  maps: Record<FundingAsset, Map<number, number>>,
  windowStart: number,
): { times: number[]; rates: Record<FundingAsset, number[]> } | null {
  const timeSet = new Set<number>();
  for (const sym of FUNDING_ASSETS) {
    for (const t of maps[sym].keys()) {
      if (t >= windowStart) timeSet.add(t);
    }
  }
  if (timeSet.size < 2) return null;
  const times = [...timeSet].sort((a, b) => a - b);
  const rates: Record<FundingAsset, number[]> = { BTC: [], ETH: [], SOL: [], XRP: [] };
  for (const sym of FUNDING_ASSETS) {
    let last = 0;
    for (const t of times) {
      if (maps[sym].has(t)) last = maps[sym].get(t)!;
      rates[sym].push(last);
    }
  }
  return { times, rates };
}

export function FundingRatePanel() {
  const [interval, setInterval] = useState<IntervalKey>(() => readStoredInterval());
  const [timeWindow, setTimeWindow] = useState<TimeWindowKey>(() => readStoredWindow());
  const [status, setStatus] = useState('Connecting…');
  const [isLoading, setIsLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const mapsRef = useRef(emptyMaps());
  const wsRef = useRef<WebSocket | null>(null);
  const loadGenRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drawTick, setDrawTick] = useState(0);
  const [latestRates, setLatestRates] = useState<Partial<Record<FundingAsset, number>>>({});

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

  useEffect(() => {
    const loadGen = ++loadGenRef.current;
    mapsRef.current = emptyMaps();
    setIsLoading(true);
    setStatus('Loading…');
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }

    const endTime = Date.now();
    const windowStart = endTime - WINDOW_MS[timeWindow];

    fetchFundingSnapshot(interval, windowStart, endTime)
      .then((snap) => {
        if (loadGen !== loadGenRef.current || !snap) return;
        applySnapshot(mapsRef.current, snap.assets, windowStart);
        const nextRates: Partial<Record<FundingAsset, number>> = {};
        for (const sym of FUNDING_ASSETS) {
          nextRates[sym] = snap.assets[sym]?.rate ?? 0;
        }
        setLatestRates(nextRates);
        setStatus('Live');
        setIsLoading(false);
        bumpDraw();
      })
      .catch(() => {
        if (loadGen === loadGenRef.current) setStatus('Load failed');
      });

    const ws = new WebSocket(fundingWsUrl(interval, timeWindow));
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(fundingSubscribePayload(interval, timeWindow));
    };

    ws.onmessage = (ev) => {
      try {
        const outer = JSON.parse(ev.data as string) as { type?: string; data?: unknown };
        if (outer.type !== 'binanceFunding') return;
        const snap = parseFundingSnapshot(outer.data);
        if (!snap || loadGen !== loadGenRef.current) return;
        const wsWindowStart = Date.now() - WINDOW_MS[timeWindow];
        applySnapshot(mapsRef.current, snap.assets, wsWindowStart);
        setLatestRates((prev) => {
          const next = { ...prev };
          for (const sym of FUNDING_ASSETS) {
            if (snap.assets[sym]?.rate != null) next[sym] = snap.assets[sym]!.rate;
          }
          return next;
        });
        bumpDraw();
      } catch {
        /* ignore */
      }
    };

    ws.onerror = () => setStatus('WebSocket error');
    ws.onclose = () => {
      setConnected(false);
      if (wsRef.current === ws) wsRef.current = null;
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [interval, timeWindow, bumpDraw]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = containerRef.current;
    if (!canvas || !wrap) return;

    const windowStart = Date.now() - WINDOW_MS[timeWindow];
    const built = buildSeries(mapsRef.current, windowStart);
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
    const padL = 52;
    const padR = 8;
    const padT = 6;
    const padB = 18;
    const chartL = padL;
    const chartR = W - padR;
    const chartT = padT;
    const chartB = H - padB;

    if (!built) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Waiting for funding data…', W / 2, H / 2);
      return;
    }

    const { times, rates } = built;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const sym of FUNDING_ASSETS) {
      for (const v of rates[sym]) {
        const pct = v * 100;
        yMin = Math.min(yMin, pct);
        yMax = Math.max(yMax, pct);
      }
    }
    const padY = Math.max(0.002, (yMax - yMin) * 0.1) || 0.01;
    yMin -= padY;
    yMax += padY;

    const toX = (i: number) => chartL + (i / Math.max(1, times.length - 1)) * (chartR - chartL);
    const toY = (v: number) => chartB - ((v - yMin) / (yMax - yMin)) * (chartB - chartT);

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
      ctx.fillText(`${v >= 0 ? '+' : ''}${v.toFixed(4)}%`, chartL - 4, y);
    }

    if (yMin < 0 && yMax > 0) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
      ctx.beginPath();
      ctx.moveTo(chartL, toY(0));
      ctx.lineTo(chartR, toY(0));
      ctx.stroke();
    }

    for (const sym of FUNDING_ASSETS) {
      const ys = rates[sym].map((r) => r * 100);
      ctx.strokeStyle = LINE_COLORS[sym];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < ys.length; i++) {
        const x = toX(i);
        const y = toY(ys[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
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
    const ro = new ResizeObserver(() => bumpDraw());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [bumpDraw]);

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0 h-full">
      <div className="panel-header flex items-center gap-2 mb-2 flex-wrap cursor-grab shrink-0">
        <h3 className="text-sm font-bold text-amber-300">Funding Rate</h3>
        <span className="text-[9px] text-gray-500 ml-1">Binance perp · 1m sample</span>
        <span className={`text-[8px] ml-auto ${connected ? 'text-green-500' : 'text-gray-600'}`}>
          {connected ? 'mito' : '…'}
        </span>
        <span className="text-[9px] text-gray-500">{status}</span>
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
            className="max-w-full rounded border border-amber-700/50 bg-gray-900/90 py-0.5 pl-1.5 pr-6 text-[10px] font-semibold text-amber-100 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
            aria-label="Funding chart resolution"
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
            aria-label="Funding chart window"
          >
            {TIME_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-1 shrink-0 text-[9px] cursor-default" onPointerDown={(e) => e.stopPropagation()}>
        {FUNDING_ASSETS.map((sym) => (
          <span key={sym} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: LINE_COLORS[sym] }} />
            <span style={{ color: LINE_COLORS[sym] }} className="font-bold">
              {sym}
            </span>
            <span className={`tabular-nums font-medium ${fundingRateTextClass(latestRates[sym])}`}>
              {fmtFundingRate(latestRates[sym] ?? 0)}
            </span>
          </span>
        ))}
      </div>
      <div ref={containerRef} className="flex-1 min-h-[160px] min-w-0 relative">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
        {isLoading && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded bg-gray-950/75 backdrop-blur-[2px]"
            aria-busy="true"
          >
            <div className="h-9 w-9 rounded-full border-2 border-amber-500/25 border-t-amber-400 animate-spin" />
            <span className="text-[10px] font-medium tracking-wide text-gray-400">Loading chart…</span>
          </div>
        )}
      </div>
    </div>
  );
}
