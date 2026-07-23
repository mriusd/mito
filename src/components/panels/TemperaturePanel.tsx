import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { WEATHER_CITIES, type WeatherCitySlug } from '../../types';
import { isWeatherCitySlug, mergeWeatherCityOptions, weatherCityTimezone } from '../../lib/weatherCities';
import { sortWeatherCityOptions, useWeatherCityFavorites } from '../../lib/weatherCityFavorites';
import { WeatherCityMenu } from '../WeatherCityMenu';
import { TempUnitToggle, TemperatureChart, useWeatherTempUnit } from '../TemperatureChart';
import {
  fetchWeatherObservations,
  floorDisplayTemp,
  isWeatherDateTodayInTimezone,
  weatherDateInputValueInTimezone,
  weatherDateInputValuePlusDaysInTimezone,
  type WeatherObservationsResponse,
} from '../../lib/weatherObservations';

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

function TemperaturePanelInner({ panelId }: { panelId: string }) {
  const [city, setCity] = useState<WeatherCitySlug>(() => readStoredCity(panelId));
  const [date, setDate] = useState(() =>
    readStoredDate(panelId, weatherCityTimezone(readStoredCity(panelId))),
  );
  const [cityOpen, setCityOpen] = useState(false);
  const [tempUnit, setTempUnit] = useWeatherTempUnit();
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
    () => weatherDateInputValuePlusDaysInTimezone(cityMeta.timezone, 3),
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

    const load = (opts?: { history?: boolean; silent?: boolean }) => {
      if (!opts?.silent) {
        setLoading(true);
        setError('');
      }
      void fetchWeatherObservations(city, date, { history: opts?.history })
        .then((resp) => {
          if (cancelled) return;
          if (opts?.history) {
            setData((prev) => (prev ? { ...prev, forecastHistory: resp.forecastHistory } : resp));
            return;
          }
          setData(resp);
        })
        .catch((e) => {
          if (cancelled || opts?.history) return;
          setData(null);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled && !opts?.silent && !opts?.history) setLoading(false);
        });
    };

    load();
    void fetchWeatherObservations(city, date, { history: true })
      .then((resp) => {
        if (cancelled) return;
        setData((prev) => (prev ? { ...prev, forecastHistory: resp.forecastHistory } : resp));
      })
      .catch(() => {});
    const pollMs = isWeatherDateTodayInTimezone(date, cityMeta.timezone) ? 60_000 : 0;
    const pollId = pollMs > 0 ? window.setInterval(() => load({ silent: true }), pollMs) : undefined;
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
          <TempUnitToggle unit={tempUnit} onChange={setTempUnit} />
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
              H {floorDisplayTemp(data.highTemp, data.obsTempUnit ?? 'C', tempUnit)}{tempUnit === 'F' ? '°F' : '°C'} · L{' '}
              {floorDisplayTemp(data.lowTemp, data.obsTempUnit ?? 'C', tempUnit)}{tempUnit === 'F' ? '°F' : '°C'}
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
