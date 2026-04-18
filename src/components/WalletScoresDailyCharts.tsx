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
  if (kind === 'pct0') return `${v.toFixed(0)}%`;
  if (kind === 'pct1') return `${v.toFixed(1)}%`;
  const a = Math.abs(v);
  const pref = v >= 0 ? '' : '−';
  if (a >= 1e6) return `${pref}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${pref}$${(a / 1e3).toFixed(1)}k`;
  return `${pref}$${a.toFixed(0)}`;
}

type RateSeries = {
  values: number[];
  stroke: string;
  yFmt: YFmt;
};

/** Win %, profit %, ROI % on one Y scale (percentage points). */
function RatesRoiCanvas({ dates, win, profit, roi }: { dates: string[]; win: number[]; profit: number[]; roi: number[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(280);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(120, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(120, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const n = win.length;
    const H = 56;
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    const W = Math.max(120, width);
    c.width = Math.floor(W * dpr);
    c.height = Math.floor(H * dpr);
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const padL = 50;
    const padR = 4;
    const padT = 4;
    const padB = 14;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    if (n === 0) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '9px sans-serif';
      ctx.fillText('No data', padL, H / 2);
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
    const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (v: number) => padT + innerH - ((v - vmin) / (vmax - vmin)) * innerH;

    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + innerH);
    ctx.lineTo(padL + innerW, padT + innerH);
    ctx.stroke();

    ctx.fillStyle = '#6b7280';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${vmax.toFixed(0)}%`, padL - 2, padT + 7);
    ctx.fillText(`${vmin.toFixed(0)}%`, padL - 2, padT + innerH);

    const lastIdx = n - 1;
    const lastX = xAt(lastIdx);

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
      ctx.moveTo(padL, lastY);
      ctx.lineTo(lastX, lastY);
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

    type Lbl = { stroke: string; yFmt: YFmt; lastVal: number; lastY: number };
    const lbls: Lbl[] = series.map((s) => ({
      stroke: s.stroke,
      yFmt: s.yFmt,
      lastVal: s.values[lastIdx],
      lastY: yAt(s.values[lastIdx]),
    }));
    lbls.sort((a, b) => a.lastY - b.lastY);
    let prevTy = -1e9;
    for (const L of lbls) {
      let ty = L.lastY;
      if (ty < prevTy + 10) ty = prevTy + 10;
      if (ty > padT + innerH - 2) ty = padT + innerH - 2;
      prevTy = ty;
      ctx.save();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = L.stroke;
      ctx.font = 'bold 8px monospace';
      ctx.fillText(formatYAxis(L.yFmt, L.lastVal), padL - 2, ty);
      ctx.restore();
    }

    ctx.fillStyle = '#9ca3af';
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const labelIdxs = n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1];
    for (const i of labelIdxs) {
      const d = dates[i] || '';
      const short =
        d.length >= 10 ? d.slice(5, 10) : d.length >= 8 ? d.slice(0, 10) : d.length > 0 ? d : '—';
      ctx.fillText(short, xAt(i), H - 3);
    }
  }, [width, dates, win, profit, roi]);

  return (
    <div ref={wrap} className="w-full min-w-0">
      <div className="text-[9px] text-gray-400 mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-gray-300">Win % · Profit % · ROI %</span>
        <span className="text-emerald-400">●</span>
        <span className="text-gray-500">Win</span>
        <span className="text-sky-400">●</span>
        <span className="text-gray-500">Profit</span>
        <span className="text-pink-400">●</span>
        <span className="text-gray-500">ROI</span>
      </div>
      <canvas ref={canvas} className="block max-w-full" />
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
  const [width, setWidth] = useState(280);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(120, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(120, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const H = 52;
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    const W = Math.max(120, width);
    c.width = Math.floor(W * dpr);
    c.height = Math.floor(H * dpr);
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const padL = 46;
    const padR = 4;
    const padT = 4;
    const padB = 14;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const n = values.length;
    if (n === 0) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '9px sans-serif';
      ctx.fillText('No data', padL, H / 2);
      return;
    }
    let vmin = Math.min(...values);
    let vmax = Math.max(...values);
    [vmin, vmax] = padRange(vmin, vmax);
    const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yAt = (v: number) => padT + innerH - ((v - vmin) / (vmax - vmin)) * innerH;

    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + innerH);
    ctx.lineTo(padL + innerW, padT + innerH);
    ctx.stroke();

    const lastIdx = n - 1;
    const lastVal = values[lastIdx];
    const lastX = xAt(lastIdx);
    const lastY = yAt(lastVal);

    ctx.fillStyle = '#6b7280';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(formatYAxis(yFmt, vmax), padL - 2, padT + 7);
    ctx.fillText(formatYAxis(yFmt, vmin), padL - 2, padT + innerH);

    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, lastY);
    ctx.lineTo(lastX, lastY);
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

    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = stroke;
    ctx.font = 'bold 8px monospace';
    ctx.fillText(formatYAxis(yFmt, lastVal), padL - 2, lastY);
    ctx.restore();

    ctx.fillStyle = '#9ca3af';
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const labelIdxs = n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1];
    for (const i of labelIdxs) {
      const d = dates[i] || '';
      const short =
        d.length >= 10 ? d.slice(5, 10) : d.length >= 8 ? d.slice(0, 10) : d.length > 0 ? d : '—';
      ctx.fillText(short, xAt(i), H - 3);
    }
  }, [width, dates, values, stroke, yFmt]);

  return (
    <div ref={wrap} className="w-full min-w-0">
      <div className="text-[9px] text-gray-400 mb-0.5">{title}</div>
      <canvas ref={canvas} className="block max-w-full" />
    </div>
  );
}

export function WalletScoresDailyCharts({
  wallet,
  refreshToken = 0,
}: {
  wallet: string;
  refreshToken?: number;
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
  const roi = points.map((p) => (Number.isFinite(p.roi) ? p.roi * 100 : 0));

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
    <div className="mt-2 pt-2 border-t border-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
        <span className="text-[9px] text-gray-500 font-semibold">Daily (UTC)</span>
        <div className="flex gap-0.5 shrink-0">
          {btn('7d', '7d')}
          {btn('30d', '30d')}
          {btn('all', 'All')}
        </div>
      </div>
      {loading && <div className="text-gray-500 text-[9px]">Loading chart…</div>}
      {err && <div className="text-red-400 text-[9px]">{err}</div>}
      {!loading && !err && (
        <div className="grid grid-cols-2 gap-3 min-w-0">
          <div className="min-w-0">
            <RatesRoiCanvas dates={dates} win={wr} profit={pr} roi={roi} />
          </div>
          <div className="min-w-0">
            <MiniLineCanvas title="PnL $" dates={dates} values={pnl} stroke="#fbbf24" yFmt="money" />
          </div>
        </div>
      )}
    </div>
  );
}
