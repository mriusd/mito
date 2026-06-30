import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { WEATHER_CITIES, type WeatherCitySlug } from '../../types';
import { isWeatherCitySlug, mergeWeatherCityOptions, weatherCityTimezone } from '../../lib/weatherCities';
import { sortWeatherCityOptions, useWeatherCityFavorites } from '../../lib/weatherCityFavorites';
import { WeatherCityMenu } from '../WeatherCityMenu';
import {
  fetchWeatherObservations,
  floorDisplayTemp,
  formatWeatherChartHour,
  isWeatherDateTodayInTimezone,
  readWeatherTempUnit,
  weatherDateInputValueInTimezone,
  weatherDateInputValuePlusDaysInTimezone,
  writeWeatherTempUnit,
  type WeatherObservationsResponse,
  type WeatherTempUnit,
} from '../../lib/weatherObservations';

const DAY_MS = 24 * 60 * 60 * 1000;
const LINE_COLOR = '#38bdf8';

function TempUnitToggle({
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

function readStoredCity(panelId: string): WeatherCitySlug {
  const saved = localStorage.getItem(`polybot-weather-temp-city-${panelId}`);
  if (saved && isWeatherCitySlug(saved)) return saved;
  return 'london';
}

function readStoredDate(panelId: string, timeZone: string): string {
  const saved = localStorage.getItem(`polybot-weather-temp-date-${panelId}`);
  if (saved) return saved;
  return weatherDateInputValueInTimezone(timeZone);
}

function TemperatureChart({
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
    const padT = 8;
    const padB = 22;
    const chartL = padL;
    const chartR = w - padR;
    const chartT = padT;
    const chartB = h - padB;
    const unitSuffix = unit === 'F' ? '°F' : '°C';

    const points = data.points.map((p) => ({
      ...p,
      temp: floorDisplayTemp(p.temp, unit),
    }));
    if (points.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No observations for this day', w / 2, h / 2);
      return;
    }

    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of points) {
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
      ctx.fillText(formatWeatherChartHour(labelMs, data.timezone), x, chartB + 3);
    }

    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
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

function TemperaturePanelInner({ panelId }: { panelId: string }) {
  const [city, setCity] = useState<WeatherCitySlug>(() => readStoredCity(panelId));
  const [date, setDate] = useState(() =>
    readStoredDate(panelId, weatherCityTimezone(readStoredCity(panelId))),
  );
  const [cityOpen, setCityOpen] = useState(false);
  const [tempUnit, setTempUnit] = useState<WeatherTempUnit>(() => readWeatherTempUnit());
  const [data, setData] = useState<WeatherObservationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cityBtnRef = useRef<HTMLButtonElement>(null);
  const cityMenuRef = useRef<HTMLDivElement>(null);

  const weatherMarketsByCity = useAppStore((s) => s.weatherMarkets);
  const weatherCityFavorites = useWeatherCityFavorites();
  const cityOptions = useMemo(
    () => sortWeatherCityOptions(mergeWeatherCityOptions(Object.keys(weatherMarketsByCity)), weatherCityFavorites),
    [weatherMarketsByCity, weatherCityFavorites],
  );
  const starredCityCount = useMemo(() => {
    const fav = new Set(weatherCityFavorites);
    let n = 0;
    for (const c of cityOptions) {
      if (!fav.has(c.slug)) break;
      n += 1;
    }
    return n;
  }, [cityOptions, weatherCityFavorites]);
  const cityMeta = cityOptions.find((c) => c.slug === city) ?? cityOptions[0] ?? WEATHER_CITIES[0];
  const maxDate = useMemo(
    () => weatherDateInputValuePlusDaysInTimezone(cityMeta.timezone, 1),
    [cityMeta.timezone],
  );

  useEffect(() => {
    setDate((prev) => (prev > maxDate ? weatherDateInputValueInTimezone(cityMeta.timezone) : prev));
  }, [cityMeta.timezone, maxDate]);

  useEffect(() => {
    if (!cityOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (cityBtnRef.current?.contains(t)) return;
      if (cityMenuRef.current?.contains(t)) return;
      setCityOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [cityOpen]);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      setLoading(true);
      setError('');
      void fetchWeatherObservations(city, date)
        .then((resp) => {
          if (cancelled) return;
          setData(resp);
        })
        .catch((e) => {
          if (cancelled) return;
          setData(null);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    load();
    const pollMs = isWeatherDateTodayInTimezone(date, cityMeta.timezone) ? 60_000 : 0;
    const pollId = pollMs > 0 ? window.setInterval(load, pollMs) : undefined;
    return () => {
      cancelled = true;
      if (pollId != null) window.clearInterval(pollId);
    };
  }, [city, date, cityMeta.timezone]);

  return (
    <div className="panel-wrapper flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-gray-800/50 p-3">
      <div className="panel-header mb-2 shrink-0">
        <h3 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-bold text-sky-400">
          <button
            ref={cityBtnRef}
            type="button"
            className="no-drag relative inline-flex cursor-pointer select-none items-center"
            onClick={() => setCityOpen((v) => !v)}
          >
            {cityMeta.label}
            <svg className="ml-0.5 inline h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {cityOpen && (
              <div
                ref={cityMenuRef}
                className="absolute left-0 top-full z-50 mt-1 max-h-48 min-w-[140px] overflow-y-auto rounded border border-gray-600 bg-gray-800 shadow-lg"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <WeatherCityMenu
                  cities={cityOptions}
                  selectedSlug={city}
                  starredCount={starredCityCount}
                  onSelect={(slug) => {
                    setCity(slug);
                    localStorage.setItem(`polybot-weather-temp-city-${panelId}`, slug);
                    setCityOpen(false);
                  }}
                />
              </div>
            )}
          </button>
          <TempUnitToggle
            unit={tempUnit}
            onChange={(u) => {
              setTempUnit(u);
              writeWeatherTempUnit(u);
            }}
          />
          <label className="no-drag inline-flex items-center gap-1 text-[10px] font-normal text-gray-300">
            <span className="text-gray-500">Date</span>
            <input
              type="date"
              max={maxDate}
              value={date}
              onChange={(e) => {
                const v = e.target.value;
                setDate(v);
                localStorage.setItem(`polybot-weather-temp-date-${panelId}`, v);
              }}
              className="rounded border border-gray-600 bg-gray-900 px-1 py-0.5 text-[10px] text-white"
            />
          </label>
          {data?.highTemp != null && data.lowTemp != null ? (
            <span className="ml-auto text-[10px] font-normal tabular-nums text-gray-400">
              H {floorDisplayTemp(data.highTemp, tempUnit)}{tempUnit === 'F' ? '°F' : '°C'} · L{' '}
              {floorDisplayTemp(data.lowTemp, tempUnit)}{tempUnit === 'F' ? '°F' : '°C'}
            </span>
          ) : null}
        </h3>
      </div>

      <div className="panel-body min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-gray-500">Loading…</div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-2 text-center text-xs text-red-400">{error}</div>
        ) : data ? (
          <TemperatureChart data={data} unit={tempUnit} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-gray-500">No data</div>
        )}
      </div>
    </div>
  );
}

export const TemperaturePanel = memo(TemperaturePanelInner);
