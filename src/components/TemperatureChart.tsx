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
const PAD_R = 36;
const PAD_T = 22;
const PAD_B = 52;
const WIND_ROW_Y = 22;
const TEMP_LINE = '#ef4444';
const TEMP_FORECAST = 'rgba(239, 68, 68, 0.45)';
const TEMP_FORECAST_HISTORY_BASE = 'rgba(239, 68, 68,';
const HUMIDITY_LINE = '#3b82f6';
const HUMIDITY_FORECAST = 'rgba(59, 130, 246, 0.45)';
const HUMIDITY_FORECAST_HISTORY_BASE = 'rgba(59, 130, 246,';
const DEW_LINE = '#eab308';
const DEW_FORECAST = 'rgba(234, 179, 8, 0.45)';
const DEW_FORECAST_HISTORY_BASE = 'rgba(234, 179, 8,';

type ChartPoint = {
  timeMs: number;
  temp: number;
  humidity?: number;
  dewpoint?: number;
  windDirDeg?: number;
  windSpeedKt?: number;
  kind: 'obs' | 'forecast';
  series: 'temp' | 'humidity' | 'dewpoint';
};

type ChartLayout = {
  chartL: number;
  chartR: number;
  chartT: number;
  chartB: number;
  dayStart: number;
  yMin: number;
  yMax: number;
  hMin: number;
  hMax: number;
  timezone: string;
  unitSuffix: string;
  points: ChartPoint[];
  forecastPoints: ChartPoint[];
  humidityPoints: ChartPoint[];
  humidityForecastPoints: ChartPoint[];
  dewpointPoints: ChartPoint[];
  dewpointForecastPoints: ChartPoint[];
};

function nearestChartPoint(layout: ChartLayout, mx: number): ChartPoint | null {
  const candidates = [
    ...layout.points,
    ...layout.forecastPoints,
    ...layout.humidityPoints,
    ...layout.humidityForecastPoints,
    ...layout.dewpointPoints,
    ...layout.dewpointForecastPoints,
  ];
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
  const toY =
    p.series === 'humidity'
      ? (v: number) =>
          layout.chartB -
          ((v - layout.hMin) / (layout.hMax - layout.hMin)) * (layout.chartB - layout.chartT)
      : (v: number) =>
          layout.chartB -
          ((v - layout.yMin) / (layout.yMax - layout.yMin)) * (layout.chartB - layout.chartT);
  const value =
    p.series === 'humidity' ? (p.humidity ?? 0) : p.series === 'dewpoint' ? (p.dewpoint ?? 0) : p.temp;
  return { x: toX(p.timeMs), y: toY(value) };
}

function pointColor(p: ChartPoint): string {
  if (p.series === 'humidity') {
    return p.kind === 'forecast' ? HUMIDITY_FORECAST : HUMIDITY_LINE;
  }
  if (p.series === 'dewpoint') {
    return p.kind === 'forecast' ? DEW_FORECAST : DEW_LINE;
  }
  return p.kind === 'forecast' ? TEMP_FORECAST : TEMP_LINE;
}

type WindMarkerStyle = 'obs' | 'forecast' | 'latest';

function drawWindMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dirDeg: number | undefined,
  speedKt: number | undefined,
  style: WindMarkerStyle = 'obs',
) {
  if (speedKt == null && dirDeg == null) return;
  const speed = speedKt ?? 0;
  const textColor =
    style === 'latest'
      ? '#2dd4bf'
      : style === 'forecast'
        ? 'rgba(255,255,255,0.22)'
        : 'rgba(255,255,255,0.45)';
  const strokeColor =
    style === 'latest'
      ? '#2dd4bf'
      : style === 'forecast'
        ? 'rgba(255,255,255,0.28)'
        : 'rgba(255,255,255,0.55)';
  ctx.font = style === 'latest' ? 'bold 8px monospace' : '8px monospace';
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if (speed <= 0) {
    ctx.fillText('calm', x, y - 4);
    return;
  }
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = style === 'latest' ? 1.6 : 1.2;
  ctx.lineCap = 'round';
  if (dirDeg != null) {
    const len = Math.min(10, 6 + speed * 0.3);
    const angle = ((dirDeg + 90) * Math.PI) / 180;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, len * 0.45);
    ctx.lineTo(0, -len * 0.55);
    ctx.moveTo(0, -len * 0.55);
    ctx.lineTo(-3, -len * 0.25);
    ctx.moveTo(0, -len * 0.55);
    ctx.lineTo(3, -len * 0.25);
    ctx.stroke();
    ctx.restore();
  } else {
    // Variable / missing direction (e.g. VRB)
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillText(`${Math.round(speed)}`, x, y + 6);
}

/** One wind sample per local hour — latest point that has wind in that hour. */
function hourlyWindPoints<T extends { timeMs: number; windDirDeg?: number; windSpeedKt?: number }>(
  points: T[],
  dayStartMs: number,
): T[] {
  const byHour = new Map<number, T>();
  for (const p of points) {
    if (p.windDirDeg == null && p.windSpeedKt == null) continue;
    const hour = Math.floor((p.timeMs - dayStartMs) / 3600000);
    if (hour < 0 || hour > 24) continue;
    const prev = byHour.get(hour);
    if (!prev || p.timeMs >= prev.timeMs) byHour.set(hour, p);
  }
  return [...byHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, p]) => p);
}

function windHoverText(dirDeg: number | undefined, speedKt: number | undefined): string | null {
  if (speedKt == null && dirDeg == null) return null;
  const speed = speedKt ?? 0;
  if (speed <= 0) return 'calm';
  if (dirDeg != null) return `wind ${Math.round(dirDeg)}° ${Math.round(speed)}`;
  return `${Math.round(speed)}`;
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

    const chartL = PAD_L;
    const chartR = w - PAD_R;
    const chartT = PAD_T;
    const chartB = h - PAD_B;
    const unitSuffix = unit === 'F' ? '°F' : '°C';
    const labelOffset = 7;
    const obsUnit = data.obsTempUnit ?? 'C';
    const fcUnit: WeatherTempUnit = 'C';
    const fmtObs = (v: number) => floorDisplayTemp(v, obsUnit, unit);
    const fmtFc = (v: number) => floorDisplayTemp(v, fcUnit, unit);

    const points: ChartPoint[] = data.points.map((p) => ({
      timeMs: p.timeMs,
      temp: fmtObs(p.temp),
      humidity: p.humidity,
      dewpoint: p.dewpoint != null ? fmtObs(p.dewpoint) : undefined,
      windDirDeg: p.windDirDeg,
      windSpeedKt: p.windSpeedKt,
      kind: 'obs' as const,
      series: 'temp' as const,
    }));
    const forecastPoints: ChartPoint[] = (data.forecastPoints ?? []).map((p) => ({
      timeMs: p.timeMs,
      temp: fmtFc(p.temp),
      humidity: p.humidity,
      dewpoint: p.dewpoint != null ? fmtFc(p.dewpoint) : undefined,
      windDirDeg: p.windDirDeg,
      windSpeedKt: p.windSpeedKt,
      kind: 'forecast' as const,
      series: 'temp' as const,
    }));
    const humidityPoints: ChartPoint[] = data.points
      .filter((p) => p.humidity != null)
      .map((p) => ({
        timeMs: p.timeMs,
        temp: fmtObs(p.temp),
        humidity: p.humidity,
        windDirDeg: p.windDirDeg,
        windSpeedKt: p.windSpeedKt,
        kind: 'obs' as const,
        series: 'humidity' as const,
      }));
    const humidityForecastPoints: ChartPoint[] = (data.forecastPoints ?? [])
      .filter((p) => p.humidity != null)
      .map((p) => ({
        timeMs: p.timeMs,
        temp: fmtFc(p.temp),
        humidity: p.humidity,
        windDirDeg: p.windDirDeg,
        windSpeedKt: p.windSpeedKt,
        kind: 'forecast' as const,
        series: 'humidity' as const,
      }));
    const dewpointPoints: ChartPoint[] = data.points
      .filter((p) => p.dewpoint != null)
      .map((p) => ({
        timeMs: p.timeMs,
        temp: fmtObs(p.temp),
        dewpoint: fmtObs(p.dewpoint!),
        windDirDeg: p.windDirDeg,
        windSpeedKt: p.windSpeedKt,
        kind: 'obs' as const,
        series: 'dewpoint' as const,
      }));
    const dewpointForecastPoints: ChartPoint[] = (data.forecastPoints ?? [])
      .filter((p) => p.dewpoint != null)
      .map((p) => ({
        timeMs: p.timeMs,
        temp: fmtFc(p.temp),
        dewpoint: fmtFc(p.dewpoint!),
        windDirDeg: p.windDirDeg,
        windSpeedKt: p.windSpeedKt,
        kind: 'forecast' as const,
        series: 'dewpoint' as const,
      }));
    const forecastHistory = (data.forecastHistory ?? []).map((batch) => ({
      issuedAtMs: batch.issuedAtMs,
      points: batch.points.map((p) => ({
        ...p,
        temp: fmtFc(p.temp),
        dewpoint: p.dewpoint != null ? fmtFc(p.dewpoint) : undefined,
      })),
    }));
    const allTempPoints = [
      ...points,
      ...forecastPoints,
      ...forecastHistory.flatMap((b) =>
        b.points.map((p) => ({
          timeMs: p.timeMs,
          temp: p.temp,
          humidity: p.humidity,
          kind: 'forecast' as const,
          series: 'temp' as const,
        })),
      ),
    ];
    const allTempAxisValues = [
      ...allTempPoints.map((p) => p.temp),
      ...dewpointPoints.map((p) => p.dewpoint ?? 0),
      ...dewpointForecastPoints.map((p) => p.dewpoint ?? 0),
      ...forecastHistory.flatMap((b) =>
        b.points.map((p) => p.dewpoint).filter((v): v is number => v != null),
      ),
    ];
    const allHumidityValues = [
      ...humidityPoints.map((p) => p.humidity ?? 0),
      ...humidityForecastPoints.map((p) => p.humidity ?? 0),
      ...forecastHistory.flatMap((b) => b.points.map((p) => p.humidity).filter((v) => v != null)),
    ] as number[];
    if (allTempAxisValues.length === 0 && allHumidityValues.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No temperature data', w / 2, h / 2);
      return;
    }

    const primaryCurve = [...points, ...forecastPoints];
    const labelPoints = primaryCurve.length > 0 ? primaryCurve : allTempPoints;
    let minPoint = labelPoints[0];
    let maxPoint = labelPoints[0];
    let yMin = allTempAxisValues[0] ?? 0;
    let yMax = allTempAxisValues[0] ?? 0;
    for (const p of labelPoints) {
      if (p.temp < minPoint.temp) minPoint = p;
      if (p.temp > maxPoint.temp) maxPoint = p;
    }
    for (const v of allTempAxisValues) {
      yMin = Math.min(yMin, v);
      yMax = Math.max(yMax, v);
    }
    const padY = Math.max(1, (yMax - yMin) * 0.12);
    yMin -= padY;
    yMax += padY;

    let hMin = 0;
    let hMax = 100;
    if (allHumidityValues.length > 0) {
      hMin = Math.min(...allHumidityValues);
      hMax = Math.max(...allHumidityValues);
      const padH = Math.max(2, (hMax - hMin) * 0.12);
      hMin = Math.max(0, hMin - padH);
      hMax = Math.min(100, hMax + padH);
      if (hMax - hMin < 10) {
        hMin = Math.max(0, hMin - 5);
        hMax = Math.min(100, hMax + 5);
      }
    }

    const dayStart = data.dayStartMs;
    const toX = (timeMs: number) =>
      chartL + ((timeMs - dayStart) / DAY_MS) * (chartR - chartL);
    const toYTemp = (temp: number) =>
      chartB - ((temp - yMin) / (yMax - yMin)) * (chartB - chartT);
    const toYHumidity = (humidity: number) =>
      chartB - ((humidity - hMin) / (hMax - hMin)) * (chartB - chartT);

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let g = 0; g <= 4; g++) {
      const v = yMin + ((yMax - yMin) * g) / 4;
      const y = toYTemp(v);
      ctx.beginPath();
      ctx.moveTo(chartL, y);
      ctx.lineTo(chartR, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(239, 68, 68, 0.55)';
      ctx.fillText(`${Math.floor(v)}${unitSuffix}`, chartL - 4, y);
    }
    if (allHumidityValues.length > 0) {
      for (let g = 0; g <= 4; g++) {
        const v = hMin + ((hMax - hMin) * g) / 4;
        const y = toYHumidity(v);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(59, 130, 246, 0.55)';
        ctx.fillText(`${Math.round(v)}%`, chartR + 4, y);
      }
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

    const windY = chartB + WIND_ROW_Y;
    const hourlyObsWind = hourlyWindPoints(data.points, dayStart);
    const hourlyFcWind = hourlyWindPoints(data.forecastPoints ?? [], dayStart);
    for (const p of hourlyObsWind) {
      drawWindMarker(ctx, toX(p.timeMs), windY, p.windDirDeg, p.windSpeedKt, 'obs');
    }
    for (const p of hourlyFcWind) {
      drawWindMarker(ctx, toX(p.timeMs), windY, p.windDirDeg, p.windSpeedKt, 'forecast');
    }
    const latestWind =
      hourlyObsWind.length > 0 ? hourlyObsWind[hourlyObsWind.length - 1] : null;
    if (latestWind) {
      drawWindMarker(
        ctx,
        toX(latestWind.timeMs),
        windY,
        latestWind.windDirDeg,
        latestWind.windSpeedKt,
        'latest',
      );
    }

    const drawExtremeLabel = (x: number, y: number, text: string, above: boolean) => {
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.textAlign = 'center';
      ctx.textBaseline = above ? 'bottom' : 'top';
      ctx.fillText(text, x, above ? y - labelOffset : y + labelOffset);
    };

    const drawSeriesLine = (
      linePoints: { timeMs: number; value: number }[],
      toY: (v: number) => number,
      color: string,
      lineWidth: number,
      dash: number[],
      dotRadius: number,
      strokeDots: boolean,
      anchorToLastObs: { timeMs: number; value: number } | null,
    ) => {
      if (linePoints.length === 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(dash);
      ctx.beginPath();
      if (anchorToLastObs) {
        ctx.moveTo(toX(anchorToLastObs.timeMs), toY(anchorToLastObs.value));
      } else {
        const first = linePoints[0];
        ctx.moveTo(toX(first.timeMs), toY(first.value));
      }
      for (const p of linePoints) {
        ctx.lineTo(toX(p.timeMs), toY(p.value));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (strokeDots) {
        ctx.strokeStyle = color;
        for (const p of linePoints) {
          ctx.beginPath();
          ctx.arc(toX(p.timeMs), toY(p.value), dotRadius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };

    if (forecastHistory.length > 0) {
      const n = forecastHistory.length;
      forecastHistory.forEach((batch, i) => {
        const opacity = 0.12 + (0.28 * (i + 1)) / (n + 1);
        drawSeriesLine(
          batch.points.map((p) => ({ timeMs: p.timeMs, value: p.temp })),
          toYTemp,
          `${TEMP_FORECAST_HISTORY_BASE}${opacity})`,
          1.5,
          [3, 5],
          1.5,
          false,
          null,
        );
        const humPts = batch.points
          .filter((p) => p.humidity != null)
          .map((p) => ({ timeMs: p.timeMs, value: p.humidity as number }));
        if (humPts.length > 0) {
          drawSeriesLine(
            humPts,
            toYHumidity,
            `${HUMIDITY_FORECAST_HISTORY_BASE}${opacity})`,
            1.5,
            [3, 5],
            1.5,
            false,
            null,
          );
        }
        const dewPts = batch.points
          .filter((p) => p.dewpoint != null)
          .map((p) => ({ timeMs: p.timeMs, value: p.dewpoint as number }));
        if (dewPts.length > 0) {
          drawSeriesLine(
            dewPts,
            toYTemp,
            `${DEW_FORECAST_HISTORY_BASE}${opacity})`,
            1.5,
            [3, 5],
            1.5,
            false,
            null,
          );
        }
      });
    }

    if (dewpointPoints.length > 0) {
      ctx.strokeStyle = DEW_LINE;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < dewpointPoints.length; i++) {
        const x = toX(dewpointPoints[i].timeMs);
        const y = toYTemp(dewpointPoints[i].dewpoint ?? 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = DEW_LINE;
      for (const p of dewpointPoints) {
        ctx.beginPath();
        ctx.arc(toX(p.timeMs), toYTemp(p.dewpoint ?? 0), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (dewpointForecastPoints.length > 0) {
      const lastDewObs =
        dewpointPoints.length > 0 ? dewpointPoints[dewpointPoints.length - 1] : null;
      drawSeriesLine(
        dewpointForecastPoints.map((p) => ({ timeMs: p.timeMs, value: p.dewpoint ?? 0 })),
        toYTemp,
        DEW_FORECAST,
        2,
        [5, 4],
        2,
        true,
        lastDewObs
          ? { timeMs: lastDewObs.timeMs, value: lastDewObs.dewpoint ?? 0 }
          : null,
      );
    }

    if (humidityPoints.length > 0) {
      ctx.strokeStyle = HUMIDITY_LINE;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < humidityPoints.length; i++) {
        const x = toX(humidityPoints[i].timeMs);
        const y = toYHumidity(humidityPoints[i].humidity ?? 0);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = HUMIDITY_LINE;
      for (const p of humidityPoints) {
        ctx.beginPath();
        ctx.arc(toX(p.timeMs), toYHumidity(p.humidity ?? 0), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (humidityForecastPoints.length > 0) {
      const lastHumObs =
        humidityPoints.length > 0 ? humidityPoints[humidityPoints.length - 1] : null;
      drawSeriesLine(
        humidityForecastPoints.map((p) => ({ timeMs: p.timeMs, value: p.humidity ?? 0 })),
        toYHumidity,
        HUMIDITY_FORECAST,
        2,
        [5, 4],
        2,
        true,
        lastHumObs
          ? { timeMs: lastHumObs.timeMs, value: lastHumObs.humidity ?? 0 }
          : null,
      );
    }

    ctx.strokeStyle = TEMP_LINE;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    if (points.length > 0) {
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = toX(points[i].timeMs);
        const y = toYTemp(points[i].temp);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = TEMP_LINE;
      for (const p of points) {
        const x = toX(p.timeMs);
        const y = toYTemp(p.temp);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (forecastPoints.length > 0) {
      const lastObs = points.length > 0 ? points[points.length - 1] : null;
      drawSeriesLine(
        forecastPoints.map((p) => ({ timeMs: p.timeMs, value: p.temp })),
        toYTemp,
        TEMP_FORECAST,
        2,
        [5, 4],
        2,
        true,
        lastObs ? { timeMs: lastObs.timeMs, value: lastObs.temp } : null,
      );
    }

    const drawLastObsValue = (
      x: number,
      y: number,
      text: string,
      color: string,
      above: boolean,
    ) => {
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = above ? 'bottom' : 'top';
      ctx.fillText(text, x + 5, above ? y - 4 : y + 4);
    };
    if (points.length > 0) {
      const last = points[points.length - 1];
      drawLastObsValue(
        toX(last.timeMs),
        toYTemp(last.temp),
        `${last.temp}${unitSuffix}`,
        TEMP_LINE,
        true,
      );
    }
    if (humidityPoints.length > 0) {
      const last = humidityPoints[humidityPoints.length - 1];
      drawLastObsValue(
        toX(last.timeMs),
        toYHumidity(last.humidity ?? 0),
        `${Math.round(last.humidity ?? 0)}%`,
        HUMIDITY_LINE,
        false,
      );
    }
    if (dewpointPoints.length > 0) {
      const last = dewpointPoints[dewpointPoints.length - 1];
      drawLastObsValue(
        toX(last.timeMs),
        toYTemp(last.dewpoint ?? 0),
        `${last.dewpoint}${unitSuffix}`,
        DEW_LINE,
        false,
      );
    }

    if (labelPoints.length > 0) {
      const minX = toX(minPoint.timeMs);
      const minY = toYTemp(minPoint.temp);
      const maxX = toX(maxPoint.timeMs);
      const maxY = toYTemp(maxPoint.temp);
      drawExtremeLabel(minX, minY, `${minPoint.temp}${unitSuffix}`, false);
      if (maxPoint.temp !== minPoint.temp || maxPoint.timeMs !== minPoint.timeMs) {
        drawExtremeLabel(maxX, maxY, `${maxPoint.temp}${unitSuffix}`, true);
      } else {
        drawExtremeLabel(maxX, maxY - labelOffset * 2, `${maxPoint.temp}${unitSuffix}`, true);
      }
    }

    layoutRef.current = {
      chartL,
      chartR,
      chartT,
      chartB,
      dayStart,
      yMin,
      yMax,
      hMin,
      hMax,
      timezone: data.timezone,
      unitSuffix,
      points,
      forecastPoints,
      humidityPoints,
      humidityForecastPoints,
      dewpointPoints,
      dewpointForecastPoints,
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
      ctx.fillStyle = pointColor(hover);
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

  const hoverText = useCallback((hit: ChartPoint, layout: ChartLayout) => {
    const parts = [formatWeatherChartHour(hit.timeMs, layout.timezone)];
    if (hit.series === 'humidity') {
      parts.push(`${Math.round(hit.humidity ?? 0)}% RH`);
      const wind = windHoverText(hit.windDirDeg, hit.windSpeedKt);
      if (wind) parts.push(wind);
    } else if (hit.series === 'dewpoint') {
      parts.push(`dew ${hit.dewpoint}${layout.unitSuffix}`);
      const wind = windHoverText(hit.windDirDeg, hit.windSpeedKt);
      if (wind) parts.push(wind);
    } else {
      parts.push(`${hit.temp}${layout.unitSuffix}`);
      if (hit.humidity != null) parts.push(`${Math.round(hit.humidity)}% RH`);
      if (hit.dewpoint != null) parts.push(`dew ${hit.dewpoint}${layout.unitSuffix}`);
      const wind = windHoverText(hit.windDirDeg, hit.windSpeedKt);
      if (wind) parts.push(wind);
    }
    return parts.join(' · ');
  }, []);

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
      const text = hoverText(hit, layout);
      const prev = hoverRef.current;
      if (prev?.timeMs === hit.timeMs && prev.kind === hit.kind && prev.series === hit.series) {
        setHoverTip({ x: mx, y: my, text });
        return;
      }
      hoverRef.current = hit;
      setHoverTip({ x: mx, y: my, text });
      bumpDraw();
    },
    [bumpDraw, hoverText],
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
