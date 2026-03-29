import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { AssetName, Market } from '../../types';
import { ASSET_COLORS } from '../../types';
import { assetToSymbol, formatPrice } from '../../utils/format';

const ALL_ASSETS: AssetName[] = ['BTC', 'ETH', 'SOL', 'XRP'];

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
type KlineInterval = (typeof INTERVALS)[number];

const TIME_WINDOWS = ['1h', '4h', '12h', '24h', '3d', '7d'] as const;
type TimeWindowKey = (typeof TIME_WINDOWS)[number];

const INTERVAL_MS: Record<KlineInterval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

const WINDOW_MS: Record<TimeWindowKey, number> = {
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '12h': 12 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '3d': 3 * 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
};

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

function parseKlines(raw: unknown[]): Candle[] {
  const out: Candle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const t = Number(row[0]);
    const o = parseFloat(String(row[1]));
    const h = parseFloat(String(row[2]));
    const l = parseFloat(String(row[3]));
    const c = parseFloat(String(row[4]));
    if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    out.push({ t, o, h, l, c });
  }
  return out;
}

interface SRLine {
  price: number;
  probUp: number;
  label: string;
}

const SR_TIMEFRAMES = ['5m', '15m', '1h', '24h'] as const;

function srLineColor(probUp: number): string {
  if (probUp > 0.55) return '#22c55e';
  if (probUp < 0.45) return '#ef4444';
  return '#6b7280';
}

function drawCandles(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  candles: Candle[],
  interval: KlineInterval,
  srLines: SRLine[],
) {
  ctx.fillStyle = '#0f1419';
  ctx.fillRect(0, 0, w, h);

  const padL = 52;
  const padR = 8;
  const padT = 8;
  const padB = 22;
  const cw = w - padL - padR;
  const ch = h - padT - padB;
  if (candles.length === 0 || cw <= 0 || ch <= 0) return;

  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    lo = Math.min(lo, c.l, c.o, c.c);
    hi = Math.max(hi, c.h, c.o, c.c);
  }
  for (const sr of srLines) {
    lo = Math.min(lo, sr.price);
    hi = Math.max(hi, sr.price);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    const mid = Number.isFinite(lo) ? lo : 0;
    lo = mid * 0.999;
    hi = mid * 1.001;
  }
  const span = hi - lo;
  const padP = Math.max(span * 0.06, span * 1e-6);
  lo -= padP;
  hi += padP;

  const yPx = (p: number) => {
    if (hi <= lo) return padT + ch / 2;
    const t = (hi - p) / (hi - lo);
    return padT + t * ch;
  };
  const n = candles.length;
  const slot = cw / n;
  const bodyW = Math.max(1, Math.min(slot * 0.72, 12));

  // grid
  ctx.strokeStyle = 'rgba(75,85,99,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (i / 4) * ch;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + cw, y);
    ctx.stroke();
    const price = hi - (i / 4) * (hi - lo);
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(price < 1 ? price.toFixed(4) : price.toFixed(price >= 1000 ? 0 : 2), padL - 4, y);
  }

  const yTop = padT;
  const yBot = padT + ch;
  const clampY = (y: number) => Math.min(yBot, Math.max(yTop, y));

  ctx.save();
  ctx.beginPath();
  ctx.rect(padL, padT, cw, ch);
  ctx.clip();

  // S/R lines (drawn behind candles)
  for (const sr of srLines) {
    const y = yPx(sr.price);
    if (y < yTop - 1 || y > yBot + 1) continue;
    const color = srLineColor(sr.probUp);
    const dashByTf: Record<string, number[]> = {
      '5m':  [2, 3],
      '15m': [4, 5],
      '1h':  [8, 6],
      '24h': [14, 8],
    };
    ctx.setLineDash(dashByTf[sr.label] || [6, 4]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + cw, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const probPct = Math.round(sr.probUp * 100);
    const tag = `${sr.label} ${probPct}%`;
    ctx.font = 'bold 9px ui-sans-serif, system-ui, sans-serif';
    const tw = ctx.measureText(tag).width;
    const tagX = padL + 4;
    const tagY = y;
    ctx.fillStyle = 'rgba(15,20,25,0.8)';
    ctx.fillRect(tagX - 3, tagY - 7, tw + 6, 13);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, tagX, tagY);
  }

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const cx = padL + i * slot + slot / 2;
    const yH = clampY(yPx(c.h));
    const yL = clampY(yPx(c.l));
    const yO = clampY(yPx(c.o));
    const yC = clampY(yPx(c.c));
    const top = Math.min(yO, yC);
    const bot = Math.max(yO, yC);
    const bull = c.c >= c.o;
    const wick = bull ? '#4ade80' : '#f87171';
    const fill = bull ? '#22c55e' : '#ef4444';
    ctx.strokeStyle = wick;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, yH);
    ctx.lineTo(cx, yL);
    ctx.stroke();
    const bh = Math.max(1, bot - top);
    ctx.fillStyle = fill;
    ctx.fillRect(cx - bodyW / 2, top, bodyW, bh);
    if (bh <= 1) {
      ctx.fillRect(cx - bodyW / 2, Math.max(yTop, top - 0.5), bodyW, 1);
    }
  }

  ctx.restore();

  // x labels (first, mid, last)
  ctx.fillStyle = '#6b7280';
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const fmtT = (ms: number) => {
    const d = new Date(ms);
    if (interval === '1d' || interval === '4h' || interval === '1h') {
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:00`;
    }
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const labels = [
    { i: 0, t: candles[0].t },
    { i: Math.floor(n / 2), t: candles[Math.floor(n / 2)].t },
    { i: n - 1, t: candles[n - 1].t },
  ];
  for (const { i, t } of labels) {
    const cx = padL + i * slot + slot / 2;
    ctx.fillText(fmtT(t), cx, h - padB + 4);
  }
}

interface BinanceChartPanelProps {
  panelId: string;
  initialAsset: AssetName;
}

export function BinanceChartPanel({ panelId, initialAsset }: BinanceChartPanelProps) {
  const [asset, setAsset] = useState<AssetName>(() => {
    const saved = localStorage.getItem(`polybot-binance-chart-asset-${panelId}`);
    if (saved && ALL_ASSETS.includes(saved as AssetName)) return saved as AssetName;
    return initialAsset;
  });
  const [timeframe, setTimeframe] = useState<KlineInterval>(() => {
    const saved = localStorage.getItem(`polybot-binance-interval-${panelId}`) as KlineInterval | null;
    if (saved && INTERVALS.includes(saved)) return saved;
    return '15m';
  });
  const [timeWindow, setTimeWindow] = useState<TimeWindowKey>(() => {
    const saved = localStorage.getItem(`polybot-binance-window-${panelId}`) as TimeWindowKey | null;
    if (saved && (TIME_WINDOWS as readonly string[]).includes(saved)) return saved;
    return '24h';
  });
  const [assetDropdownOpen, setAssetDropdownOpen] = useState(false);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const priceData = useAppStore((s) => s.priceData);
  useAppStore((s) => s.bidAskTick);
  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const marketLookup = useAppStore((s) => s.marketLookup);
  const sym = assetToSymbol(asset);
  const livePrice = priceData[sym]?.price ?? 0;

  const srLines = useMemo<SRLine[]>(() => {
    const assetMarkets = upOrDownMarkets[asset];
    if (!assetMarkets) return [];
    const now = Date.now();
    const lines: SRLine[] = [];
    for (const tf of SR_TIMEFRAMES) {
      const markets: Market[] = (assetMarkets[tf] || [])
        .filter((m: Market) => !m.closed && m.endDate && new Date(m.endDate).getTime() > now)
        .sort((a: Market, b: Market) => {
          const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
          const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
          return ta - tb;
        });
      const market = markets[0];
      if (!market) continue;
      const tokenId = market.clobTokenIds?.[0] || '';
      const strike = market.priceToBeat ?? (tokenId ? marketLookup[tokenId]?.priceToBeat : undefined);
      if (strike == null || !Number.isFinite(strike)) continue;
      const live = tokenId ? marketLookup[tokenId] : null;
      const bid = live?.bestBid ?? market.bestBid;
      const ask = live?.bestAsk ?? market.bestAsk;
      let probUp = 0.5;
      if (bid != null && ask != null && Number.isFinite(bid) && Number.isFinite(ask)) {
        probUp = (bid + ask) / 2;
      } else if (bid != null && Number.isFinite(bid)) {
        probUp = bid;
      } else if (ask != null && Number.isFinite(ask)) {
        probUp = ask;
      }
      lines.push({ price: strike, probUp, label: tf });
    }
    return lines;
  }, [asset, upOrDownMarkets, marketLookup]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fetchKlines = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const windowMs = WINDOW_MS[timeWindow];
      const ivMs = INTERVAL_MS[timeframe];
      const targetCount = Math.min(5000, Math.ceil(windowMs / ivMs) + 8);
      const windowStart = Date.now() - windowMs;
      const byTime = new Map<number, Candle>();
      let endTime: number | undefined;
      let iterations = 0;

      while (iterations++ < 20 && byTime.size < targetCount) {
        const params = new URLSearchParams({
          symbol: sym,
          interval: timeframe,
          limit: '1000',
        });
        if (endTime !== undefined) params.set('endTime', String(endTime));
        const res = await fetch(`https://api.binance.com/api/v3/klines?${params}`);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) break;
        let oldest = Infinity;
        for (const row of rows) {
          if (!Array.isArray(row) || row.length < 6) continue;
          const t = Number(row[0]);
          const o = parseFloat(String(row[1]));
          const h = parseFloat(String(row[2]));
          const l = parseFloat(String(row[3]));
          const c = parseFloat(String(row[4]));
          if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
          oldest = Math.min(oldest, t);
          byTime.set(t, { t, o, h, l, c });
        }
        if (oldest <= windowStart) break;
        endTime = oldest - 1;
      }

      const filtered = [...byTime.values()]
        .filter((c) => c.t >= windowStart)
        .sort((a, b) => a.t - b.t);
      setCandles(filtered);
    } catch (e) {
      setCandles([]);
      setLoadErr(e instanceof Error ? e.message : 'Failed to load klines');
    } finally {
      setLoading(false);
    }
  }, [sym, timeframe, timeWindow]);

  useEffect(() => {
    void fetchKlines();
  }, [fetchKlines]);

  useEffect(() => {
    const t = setInterval(() => void fetchKlines(), 60_000);
    return () => clearInterval(t);
  }, [fetchKlines]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!assetDropdownOpen) return;
      const el = wrapRef.current?.querySelector('.binance-asset-dropdown-root');
      if (el && !el.contains(e.target as Node)) setAssetDropdownOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [assetDropdownOpen]);

  useEffect(() => {
    const container = chartRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const paint = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      if (w < 4 || h < 4) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCandles(ctx, w, h, candles, timeframe, srLines);
    };

    paint();
    const ro = new ResizeObserver(() => paint());
    ro.observe(container);
    return () => ro.disconnect();
  }, [candles, timeframe, srLines]);

  const titleColor = ASSET_COLORS[asset] || 'text-white';

  return (
    <div ref={wrapRef} className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0 h-full">
      <div className="panel-header shrink-0 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 cursor-grab">
        <h3 className={`text-sm font-bold flex items-center gap-1 flex-wrap min-w-0 flex-1 ${titleColor}`}>
          <span className="relative binance-asset-dropdown-root no-drag inline-flex items-center cursor-pointer select-none" onClick={() => setAssetDropdownOpen(v => !v)}>
            {asset}:{' '}
            <span className="font-bold text-white">
              {livePrice > 0 ? formatPrice(livePrice, asset) : '--'}
            </span>
            <svg className="w-3 h-3 ml-0.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {assetDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[80px]">
                {ALL_ASSETS.map(a => (
                  <div
                    key={a}
                    className={`px-3 py-1 text-xs font-bold hover:bg-gray-700 cursor-pointer ${a === asset ? 'text-white bg-gray-700' : 'text-gray-300'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAsset(a);
                      localStorage.setItem(`polybot-binance-chart-asset-${panelId}`, a);
                      setAssetDropdownOpen(false);
                    }}
                  >
                    {a}
                  </div>
                ))}
              </div>
            )}
          </span>
        </h3>
        <div
          className="flex items-center gap-1.5 shrink-0 no-drag cursor-default"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <select
            value={timeframe}
            onChange={(e) => {
              const iv = e.target.value as KlineInterval;
              setTimeframe(iv);
              localStorage.setItem(`polybot-binance-interval-${panelId}`, iv);
            }}
            className="w-[4.75rem] rounded border border-cyan-700/50 bg-gray-900/90 py-0.5 pl-1 pr-5 text-[10px] font-semibold text-cyan-100 shadow-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
            aria-label="Chart resolution"
          >
            {INTERVALS.map((iv) => (
              <option key={iv} value={iv}>
                {iv}
              </option>
            ))}
          </select>
          <select
            value={timeWindow}
            onChange={(e) => {
              const v = e.target.value as TimeWindowKey;
              setTimeWindow(v);
              localStorage.setItem(`polybot-binance-window-${panelId}`, v);
            }}
            className="w-[4.25rem] rounded border border-violet-700/50 bg-gray-900/90 py-0.5 pl-1 pr-5 text-[10px] font-semibold text-violet-100 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/40"
            aria-label="Chart time window"
          >
            {TIME_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div ref={chartRef} className="flex-1 min-h-0 min-w-0 relative rounded border border-gray-700/80 bg-gray-950/60 overflow-hidden">
        {loadErr && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-gray-950/80 text-[11px] text-red-300 px-2 text-center">
            {loadErr}
          </div>
        )}
        {loading && candles.length === 0 && !loadErr && (
          <div className="absolute inset-0 flex items-center justify-center z-10 text-[11px] text-gray-500">Loading…</div>
        )}
        <canvas ref={canvasRef} className="block w-full h-full" role="img" aria-label={`${asset} candlestick chart`} />
      </div>
    </div>
  );
}
