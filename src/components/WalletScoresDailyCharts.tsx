import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchWalletScoresDaily, type WalletScoresDailyPoint, type WalletScoresDailyWindow } from '../api';

function padRange(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (Math.abs(max - min) < 1e-9) {
    const b = Math.abs(max) < 1e-9 ? 1 : Math.abs(max) * 0.1;
    return [min - b, max + b];
  }
  const pad = (max - min) * 0.1;
  return [min - pad, max + pad];
}

type YFmt = 'pct0' | 'pct1' | 'money';

function formatYAxis(kind: YFmt, v: number): string {
  if (kind === 'pct0') return `${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}%`;
  if (kind === 'pct1') return `${v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const a = Math.abs(v);
  const pref = v >= 0 ? '' : '−';
  if (a >= 1e6) return `${pref}$${(a / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
  if (a >= 1e3) return `${pref}$${(a / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return pref + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

type RateSeries = {
  values: number[];
  stroke: string;
  yFmt: YFmt;
};

const AXIS_FONT_GRAY = '8px monospace';
const AXIS_FONT_LAST = 'bold 8px monospace';
const DATE_FONT = '7px monospace';
/** Right margin: dotted leader + last-value label(s) only (no gray scale here). */
const PAD_R_LAST = 50;
const PAD_T = 4;
const PAD_B = 14;

/** Win %, profit %, ROI % on one Y scale (percentage points). */
function RatesRoiCanvas({ dates, win, profit, roi }: { dates: string[]; win: number[]; profit: number[]; roi: number[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 280, h: 120 });

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({
        w: Math.max(120, el.clientWidth),
        h: Math.max(72, el.clientHeight),
      });
    });
    ro.observe(el);
    setSize({
      w: Math.max(120, el.clientWidth),
      h: Math.max(72, el.clientHeight),
    });
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const n = win.length;
    const W = size.w;
    const H = size.h;
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    c.width = Math.floor(W * dpr);
    c.height = Math.floor(H * dpr);
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const padT = PAD_T;
    const padB = PAD_B;
    const innerH = H - padT - padB;
    const plotRight = W - PAD_R_LAST;

    if (n === 0) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data', W / 2, H / 2);
      return;
    }

    const series: RateSeries[] = [
      { values: win, stroke: '#34d399', yFmt: 'pct0' },
      { values: profit, stroke: '#60a5fa', yFmt: 'pct0' },
      { values: roi, stroke: '#f472b6', yFmt: 'pct1' },
    ];

    const allVals: number[] = [];
    for (const s of series) allVals.push(...s.values);
    let vmin = Math.min(...allVals);
    let vmax = Math.max(...allVals);
    [vmin, vmax] = padRange(vmin, vmax);

    const maxStr = `${vmax.toLocaleString('en-US', { maximumFractionDigits: 0 })}%`;
    const minStr = `${vmin.toLocaleString('en-US', { maximumFractionDigits: 0 })}%`;
    ctx.font = AXIS_FONT_GRAY;
    const padL = Math.min(72, Math.max(28, Math.ceil(Math.max(ctx.measureText(maxStr).width, ctx.measureText(minStr).width) + 8)));
    const innerW = Math.max(1, plotRight - padL);
    const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (v: number) => padT + innerH - ((v - vmin) / (vmax - vmin)) * innerH;

    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT + innerH);
    ctx.lineTo(plotRight, padT + innerH);
    ctx.lineTo(plotRight, padT);
    ctx.stroke();

    ctx.fillStyle = '#6b7280';
    ctx.font = AXIS_FONT_GRAY;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(maxStr, padL - 4, padT + 7);
    ctx.fillText(minStr, padL - 4, padT + innerH);

    const lastIdx = n - 1;
    const lastX = xAt(lastIdx);
    const dashEndX = plotRight;

    for (const s of series) {
      const vals = s.values;
      const lastVal = vals[lastIdx];
      const lastY = yAt(lastVal);
      ctx.save();
      ctx.strokeStyle = s.stroke;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(dashEndX, lastY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    for (const s of series) {
      const vals = s.values;
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = 1.5;
      if (n === 1) {
        const x = xAt(0);
        const y = yAt(vals[0]);
        ctx.fillStyle = s.stroke;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = xAt(i);
          const y = yAt(vals[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    const labelX = plotRight + 4;
    type Lbl = { stroke: string; yFmt: YFmt; lastVal: number; lastY: number };
    const lbls: Lbl[] = series.map((s) => ({
      stroke: s.stroke,
      yFmt: s.yFmt,
      lastVal: s.values[lastIdx],
      lastY: yAt(s.values[lastIdx]),
    }));
    lbls.sort((a, b) => a.lastY - b.lastY);
    const stackGap = Math.max(10, Math.floor(innerH * 0.05));
    let prevTy = -1e9;
    for (const L of lbls) {
      let ty = L.lastY;
      if (ty < prevTy + stackGap) ty = prevTy + stackGap;
      if (ty > padT + innerH - 2) ty = padT + innerH - 2;
      prevTy = ty;
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = L.stroke;
      ctx.font = AXIS_FONT_LAST;
      ctx.fillText(formatYAxis(L.yFmt, L.lastVal), labelX, ty);
      ctx.restore();
    }

    ctx.fillStyle = '#9ca3af';
    ctx.font = DATE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const labelIdxs = n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1];
    for (const i of labelIdxs) {
      const d = dates[i] || '';
      const short =
        d.length >= 10 ? d.slice(5, 10) : d.length >= 8 ? d.slice(0, 10) : d.length > 0 ? d : '—';
      ctx.fillText(short, xAt(i), H - 3);
    }
  }, [size, dates, win, profit, roi]);

  return (
    <div className="w-full min-w-0 flex flex-col flex-1 min-h-0">
      <div className="text-[9px] text-gray-400 mb-0.5 shrink-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-gray-300">Win % · Profit % · ROI %</span>
        <span className="text-emerald-400">●</span>
        <span className="text-gray-500">Win</span>
        <span className="text-sky-400">●</span>
        <span className="text-gray-500">Profit</span>
        <span className="text-pink-400">●</span>
        <span className="text-gray-500">ROI</span>
      </div>
      <div ref={wrap} className="flex-1 min-h-0 w-full min-h-[64px]">
        <canvas ref={canvas} className="block w-full h-full" />
      </div>
    </div>
  );
}

function MiniLineCanvas({
  title,
  dates,
  values,
  stroke,
  yFmt,
}: {
  title: string;
  dates: string[];
  values: number[];
  stroke: string;
  yFmt: YFmt;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 280, h: 120 });

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({
        w: Math.max(120, el.clientWidth),
        h: Math.max(72, el.clientHeight),
      });
    });
    ro.observe(el);
    setSize({
      w: Math.max(120, el.clientWidth),
      h: Math.max(72, el.clientHeight),
    });
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const W = size.w;
    const H = size.h;
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    c.width = Math.floor(W * dpr);
    c.height = Math.floor(H * dpr);
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const padT = PAD_T;
    const padB = PAD_B;
    const innerH = H - padT - padB;
    const plotRight = W - PAD_R_LAST;
    const n = values.length;
    if (n === 0) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data', W / 2, H / 2);
      return;
    }
    let vmin = Math.min(...values);
    let vmax = Math.max(...values);
    [vmin, vmax] = padRange(vmin, vmax);

    const maxStr = formatYAxis(yFmt, vmax);
    const minStr = formatYAxis(yFmt, vmin);
    ctx.font = AXIS_FONT_GRAY;
    const padL = Math.min(88, Math.max(28, Math.ceil(Math.max(ctx.measureText(maxStr).width, ctx.measureText(minStr).width) + 8)));
    const innerW = Math.max(1, plotRight - padL);
    const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (v: number) => padT + innerH - ((v - vmin) / (vmax - vmin)) * innerH;

    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT + innerH);
    ctx.lineTo(plotRight, padT + innerH);
    ctx.lineTo(plotRight, padT);
    ctx.stroke();

    ctx.fillStyle = '#6b7280';
    ctx.font = AXIS_FONT_GRAY;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(maxStr, padL - 4, padT + 7);
    ctx.fillText(minStr, padL - 4, padT + innerH);

    const lastIdx = n - 1;
    const lastVal = values[lastIdx];
    const lastX = xAt(lastIdx);
    const lastY = yAt(lastVal);
    const dashEndX = plotRight;

    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(dashEndX, lastY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    if (n === 1) {
      const x = xAt(0);
      const y = yAt(values[0]);
      ctx.fillStyle = stroke;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = xAt(i);
        const y = yAt(values[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    const labelX = plotRight + 4;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = stroke;
    ctx.font = AXIS_FONT_LAST;
    ctx.fillText(formatYAxis(yFmt, lastVal), labelX, lastY);
    ctx.restore();

    ctx.fillStyle = '#9ca3af';
    ctx.font = DATE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const labelIdxs = n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1];
    for (const i of labelIdxs) {
      const d = dates[i] || '';
      const short =
        d.length >= 10 ? d.slice(5, 10) : d.length >= 8 ? d.slice(0, 10) : d.length > 0 ? d : '—';
      ctx.fillText(short, xAt(i), H - 3);
    }
  }, [size, dates, values, stroke, yFmt]);

  return (
    <div className="w-full min-w-0 flex flex-col flex-1 min-h-0">
      <div className="text-[9px] text-gray-400 mb-0.5 shrink-0">{title}</div>
      <div ref={wrap} className="flex-1 min-h-0 w-full min-h-[64px]">
        <canvas ref={canvas} className="block w-full h-full" />
      </div>
    </div>
  );
}

export function WalletScoresDailyCharts({
  wallet,
  refreshToken = 0,
  chartsLayout = 'stack',
}: {
  wallet: string;
  refreshToken?: number;
  /** `row`: win/profit/ROI and PnL canvases side by side (e.g. wallet info dialog). */
  chartsLayout?: 'stack' | 'row';
}) {
  const [windowSel, setWindowSel] = useState<WalletScoresDailyWindow>('30d');
  const [points, setPoints] = useState<WalletScoresDailyPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const w = (wallet || '').trim();
    if (!w) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchWalletScoresDaily(w, windowSel)
      .then((res) => {
        if (!cancelled) setPoints(res.points || []);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet, windowSel, refreshToken]);

  const dates = points.map((p) => p.date);
  const wr = points.map((p) => (Number.isFinite(p.winRate) ? p.winRate * 100 : 0));
  const pr = points.map((p) => (Number.isFinite(p.profitRate) ? p.profitRate * 100 : 0));
  const pnl = points.map((p) => (Number.isFinite(p.pnl) ? p.pnl : 0));
  const roi = points.map((p) =>
    typeof p.roi === 'number' && Number.isFinite(p.roi) ? p.roi * 100 : 0,
  );

  const btn = (w: WalletScoresDailyWindow, label: string) => (
    <button
      key={w}
      type="button"
      onClick={() => setWindowSel(w)}
      className={`px-2 py-0.5 rounded text-[9px] font-medium ${
        windowSel === w ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-w-0 flex flex-col flex-1 min-h-0 h-full">
      <div className="flex flex-wrap items-center justify-between gap-1 mb-1 shrink-0">
        <span className="text-[9px] text-gray-500 font-semibold">Daily (UTC)</span>
        <div className="flex gap-0.5 shrink-0">
          {btn('7d', '7d')}
          {btn('30d', '30d')}
          {btn('all', 'All')}
        </div>
      </div>
      {loading && <div className="text-gray-500 text-[9px] shrink-0">Loading chart…</div>}
      {err && <div className="text-red-400 text-[9px] shrink-0">{err}</div>}
      {!loading && !err && (
        <div
          className={
            chartsLayout === 'row'
              ? 'flex flex-col sm:flex-row gap-2 min-w-0 flex-1 min-h-0 [&>*]:min-w-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col'
              : 'flex flex-col gap-3 min-w-0 flex-1 min-h-0 [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col'
          }
        >
          <RatesRoiCanvas dates={dates} win={wr} profit={pr} roi={roi} />
          <MiniLineCanvas title="PnL $" dates={dates} values={pnl} stroke="#fbbf24" yFmt="money" />
        </div>
      )}
    </div>
  );
}
