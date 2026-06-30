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
const LINE_COLOR = '#38bdf8';
const FORECAST_COLOR = 'rgba(56, 189, 248, 0.65)';

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
  const [drawTick, setDrawTick] = useState(0);
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

    const padL = 36;
    const padR = 8;
    const padT = 22;
    const padB = 34;
    const chartL = padL;
    const chartR = w - padR;
    const chartT = padT;
    const chartB = h - padB;
    const unitSuffix = unit === 'F' ? '°F' : '°C';
    const labelOffset = 7;

    const points = data.points.map((p) => ({
      ...p,
      temp: floorDisplayTemp(p.temp, unit),
    }));
    const forecastPoints = (data.forecastPoints ?? []).map((p) => ({
      ...p,
      temp: floorDisplayTemp(p.temp, unit),
    }));
    const allPoints = [...points, ...forecastPoints];
    if (allPoints.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No temperature data', w / 2, h / 2);
      return;
    }

    let minPoint = allPoints[0];
    let maxPoint = allPoints[0];
    let yMin = minPoint.temp;
    let yMax = maxPoint.temp;
    for (const p of allPoints) {
      if (p.temp < minPoint.temp) minPoint = p;
      if (p.temp > maxPoint.temp) maxPoint = p;
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
      ctx.strokeStyle = FORECAST_COLOR;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      if (points.length > 0) {
        const last = points[points.length - 1];
        ctx.moveTo(toX(last.timeMs), toY(last.temp));
      } else {
        const first = forecastPoints[0];
        ctx.moveTo(toX(first.timeMs), toY(first.temp));
      }
      for (const p of forecastPoints) {
        ctx.lineTo(toX(p.timeMs), toY(p.temp));
      }
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = FORECAST_COLOR;
      for (const p of forecastPoints) {
        const x = toX(p.timeMs);
        const y = toY(p.temp);
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.stroke();
      }
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
  }, [data, unit]);

  useLayoutEffect(() => {
    draw();
  }, [draw, drawTick]);

  useEffect(() => {
    const ro = new ResizeObserver(() => bumpDraw());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [bumpDraw]);

  return (
    <div ref={containerRef} className="h-full w-full min-h-0 min-w-0">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
