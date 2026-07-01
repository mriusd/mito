import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  floorDisplayTemp,
  formatWeatherChartHour,
  readWeatherTempUnit,
  writeWeatherTempUnit,
  type WeatherObservationsResponse,
  type WeatherTempUnit,
} from '../lib/weatherObservations';

const DAY_MS = 24 * 60 * 60 * 1000;
const PAD_L = 36;
const PAD_R = 8;
const PAD_T = 22;
const PAD_B = 34;
const LINE_COLOR = '#38bdf8';
const FORECAST_COLOR = 'rgba(156, 163, 175, 0.9)';
const FORECAST_HISTORY_BASE = 'rgba(156, 163, 175,';

type ChartPoint = { timeMs: number; temp: number; kind: 'obs' | 'forecast' };

type ChartLayout = {
  chartL: number;
  chartR: number;
  chartT: number;
  chartB: number;
  dayStart: number;
  yMin: number;
  yMax: number;
  timezone: string;
  unitSuffix: string;
  points: ChartPoint[];
  forecastPoints: ChartPoint[];
};

function nearestChartPoint(layout: ChartLayout, mx: number): ChartPoint | null {
  const candidates = [...layout.points, ...layout.forecastPoints];
  if (candidates.length === 0) return null;
  const span = layout.chartR - layout.chartL;
  if (span <= 0) return candidates[0];
  const timeMs = layout.dayStart + ((mx - layout.chartL) / span) * DAY_MS;
  let best = candidates[0];
  let bestDt = Math.abs(best.timeMs - timeMs);
  for (const p of candidates.slice(1)) {
    const dt = Math.abs(p.timeMs - timeMs);
    if (dt < bestDt) {
      best = p;
      bestDt = dt;
    }
  }
  return best;
}

function chartCoords(layout: ChartLayout, p: ChartPoint) {
  const toX = (timeMs: number) =>
    layout.chartL + ((timeMs - layout.dayStart) / DAY_MS) * (layout.chartR - layout.chartL);
  const toY = (temp: number) =>
    layout.chartB - ((temp - layout.yMin) / (layout.yMax - layout.yMin)) * (layout.chartB - layout.chartT);
  return { x: toX(p.timeMs), y: toY(p.temp) };
}

export function TempUnitToggle({
  unit,
  onChange,
}: {
  unit: WeatherTempUnit;
  onChange: (unit: WeatherTempUnit) => void;
}) {
  const btn = (u: WeatherTempUnit) =>
    unit === u
      ? 'px-1.5 py-0.5 text-[9px] font-bold bg-gray-600 text-white'
      : 'px-1.5 py-0.5 text-[9px] font-bold text-gray-400 hover:text-gray-200';
  return (
    <div className="no-drag inline-flex overflow-hidden rounded border border-gray-600 divide-x divide-gray-600 bg-gray-900/90">
      <button type="button" className={btn('C')} onClick={() => onChange('C')}>
        °C
      </button>
      <button type="button" className={btn('F')} onClick={() => onChange('F')}>
        °F
      </button>
    </div>
  );
}

export function useWeatherTempUnit(): [WeatherTempUnit, (unit: WeatherTempUnit) => void] {
  const [unit, setUnit] = useState<WeatherTempUnit>(() => readWeatherTempUnit());
  const onChange = useCallback((u: WeatherTempUnit) => {
    setUnit(u);
    writeWeatherTempUnit(u);
  }, []);
  return [unit, onChange];
}

export function TemperatureChart({
  data,
  unit,
}: {
  data: WeatherObservationsResponse;
  unit: WeatherTempUnit;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<ChartLayout | null>(null);
  const hoverRef = useRef<ChartPoint | null>(null);
  const [drawTick, setDrawTick] = useState(0);
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const bumpDraw = useCallback(() => setDrawTick((n) => n + 1), []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = PAD_L;
    const padR = PAD_R;
    const padT = PAD_T;
    const padB = PAD_B;
    const chartL = padL;
    const chartR = w - padR;
    const chartT = padT;
    const chartB = h - padB;
    const unitSuffix = unit === 'F' ? '°F' : '°C';
    const labelOffset = 7;

    const points: ChartPoint[] = data.points.map((p) => ({
      timeMs: p.timeMs,
      temp: floorDisplayTemp(p.temp, unit),
      kind: 'obs' as const,
    }));
    const forecastPoints: ChartPoint[] = (data.forecastPoints ?? []).map((p) => ({
      timeMs: p.timeMs,
      temp: floorDisplayTemp(p.temp, unit),
      kind: 'forecast' as const,
    }));
    const forecastHistory = (data.forecastHistory ?? []).map((batch) => ({
      issuedAtMs: batch.issuedAtMs,
      points: batch.points.map((p) => ({
        ...p,
        temp: floorDisplayTemp(p.temp, unit),
      })),
    }));
    const allPoints = [
      ...points,
      ...forecastPoints,
      ...forecastHistory.flatMap((b) => b.points),
    ];
    if (allPoints.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No temperature data', w / 2, h / 2);
      return;
    }

    const labelPoints = [...points, ...forecastPoints];
    let minPoint = labelPoints[0] ?? allPoints[0];
    let maxPoint = labelPoints[0] ?? allPoints[0];
    let yMin = allPoints[0].temp;
    let yMax = allPoints[0].temp;
    for (const p of labelPoints) {
      if (p.temp < minPoint.temp) minPoint = p;
      if (p.temp > maxPoint.temp) maxPoint = p;
    }
    for (const p of allPoints) {
      yMin = Math.min(yMin, p.temp);
      yMax = Math.max(yMax, p.temp);
    }
    const padY = Math.max(1, (yMax - yMin) * 0.12);
    yMin -= padY;
    yMax += padY;

    const dayStart = data.dayStartMs;
    const toX = (timeMs: number) =>
      chartL + ((timeMs - dayStart) / DAY_MS) * (chartR - chartL);
    const toY = (temp: number) =>
      chartB - ((temp - yMin) / (yMax - yMin)) * (chartB - chartT);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let g = 0; g <= 4; g++) {
      const v = yMin + ((yMax - yMin) * g) / 4;
      const y = toY(v);
      ctx.beginPath();
      ctx.moveTo(chartL, y);
      ctx.lineTo(chartR, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.floor(v)}${unitSuffix}`, chartL - 4, y);
    }

    for (let hour = 0; hour <= 24; hour += 6) {
      const x = chartL + (hour / 24) * (chartR - chartL);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(x, chartT);
      ctx.lineTo(x, chartB);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const labelMs = dayStart + hour * 3600000;
      ctx.fillText(formatWeatherChartHour(labelMs, data.timezone), x, chartB + 4);
    }

    const drawExtremeLabel = (x: number, y: number, text: string, above: boolean) => {
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.textAlign = 'center';
      ctx.textBaseline = above ? 'bottom' : 'top';
      ctx.fillText(text, x, above ? y - labelOffset : y + labelOffset);
    };

    const drawForecastLine = (
      linePoints: { timeMs: number; temp: number }[],
      color: string,
      lineWidth: number,
      dash: number[],
      dotRadius: number,
      strokeDots: boolean,
      anchorToLastObs: boolean,
    ) => {
      if (linePoints.length === 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(dash);
      ctx.beginPath();
      if (anchorToLastObs && points.length > 0) {
        const last = points[points.length - 1];
        ctx.moveTo(toX(last.timeMs), toY(last.temp));
      } else {
        const first = linePoints[0];
        ctx.moveTo(toX(first.timeMs), toY(first.temp));
      }
      for (const p of linePoints) {
        ctx.lineTo(toX(p.timeMs), toY(p.temp));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (strokeDots) {
        ctx.strokeStyle = color;
        for (const p of linePoints) {
          ctx.beginPath();
          ctx.arc(toX(p.timeMs), toY(p.temp), dotRadius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };

    if (forecastHistory.length > 0) {
      const n = forecastHistory.length;
      forecastHistory.forEach((batch, i) => {
        const opacity = 0.12 + (0.28 * (i + 1)) / (n + 1);
        drawForecastLine(
          batch.points,
          `${FORECAST_HISTORY_BASE}${opacity})`,
          1.5,
          [3, 5],
          1.5,
          false,
          false,
        );
      });
    }

    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    if (points.length > 0) {
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = toX(points[i].timeMs);
        const y = toY(points[i].temp);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = LINE_COLOR;
      for (const p of points) {
        const x = toX(p.timeMs);
        const y = toY(p.temp);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (forecastPoints.length > 0) {
      drawForecastLine(forecastPoints, FORECAST_COLOR, 2, [5, 4], 2, true, true);
    }

    const minX = toX(minPoint.timeMs);
    const minY = toY(minPoint.temp);
    const maxX = toX(maxPoint.timeMs);
    const maxY = toY(maxPoint.temp);
    drawExtremeLabel(minX, minY, `${minPoint.temp}${unitSuffix}`, false);
    if (maxPoint.temp !== minPoint.temp || maxPoint.timeMs !== minPoint.timeMs) {
      drawExtremeLabel(maxX, maxY, `${maxPoint.temp}${unitSuffix}`, true);
    } else {
      drawExtremeLabel(maxX, maxY - labelOffset * 2, `${maxPoint.temp}${unitSuffix}`, true);
    }

    layoutRef.current = {
      chartL,
      chartR,
      chartT,
      chartB,
      dayStart,
      yMin,
      yMax,
      timezone: data.timezone,
      unitSuffix,
      points,
      forecastPoints,
    };

    const hover = hoverRef.current;
    if (hover) {
      const { x, y } = chartCoords(layoutRef.current, hover);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartT);
      ctx.lineTo(x, chartB);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hover.kind === 'forecast' ? FORECAST_COLOR : LINE_COLOR;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [data, unit]);

  useLayoutEffect(() => {
    draw();
  }, [draw, drawTick]);

  useEffect(() => {
    const ro = new ResizeObserver(() => bumpDraw());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [bumpDraw]);

  useEffect(() => {
    hoverRef.current = null;
    setHoverTip(null);
  }, [data, unit]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      const layout = layoutRef.current;
      if (!container || !layout) return;
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (mx < layout.chartL || mx > layout.chartR || my < layout.chartT || my > layout.chartB) {
        if (hoverRef.current) {
          hoverRef.current = null;
          setHoverTip(null);
          bumpDraw();
        }
        return;
      }
      const hit = nearestChartPoint(layout, mx);
      if (!hit) return;
      const prev = hoverRef.current;
      if (prev?.timeMs === hit.timeMs && prev.kind === hit.kind) {
        setHoverTip({
          x: mx,
          y: my,
          text: `${formatWeatherChartHour(hit.timeMs, layout.timezone)} · ${hit.temp}${layout.unitSuffix}`,
        });
        return;
      }
      hoverRef.current = hit;
      setHoverTip({
        x: mx,
        y: my,
        text: `${formatWeatherChartHour(hit.timeMs, layout.timezone)} · ${hit.temp}${layout.unitSuffix}`,
      });
      bumpDraw();
    },
    [bumpDraw],
  );

  const onPointerLeave = useCallback(() => {
    if (!hoverRef.current) return;
    hoverRef.current = null;
    setHoverTip(null);
    bumpDraw();
  }, [bumpDraw]);

  return (
    <div
      ref={containerRef}
      className="no-drag relative h-full w-full min-h-0 min-w-0"
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {hoverTip ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-gray-600 bg-gray-900/95 px-1.5 py-0.5 text-[9px] tabular-nums text-gray-100 shadow-md"
          style={{ left: hoverTip.x, top: hoverTip.y - 6 }}
        >
          {hoverTip.text}
        </div>
      ) : null}
    </div>
  );
}
