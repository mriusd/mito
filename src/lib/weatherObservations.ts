import { API_BASE } from './env';
import { fetchBackend } from './fetchBackend';
import type { WeatherCitySlug } from '../types';
import type { WeatherTempSource } from './weatherCities';

export type WeatherObservationPoint = {
  timeMs: number;
  temp: number;
  humidity?: number;
  dewpoint?: number;
  windDirDeg?: number;
  windSpeedKt?: number;
};

export type WeatherForecastHistoryBatch = {
  issuedAtMs: number;
  points: WeatherObservationPoint[];
};

export type WeatherForecastSourceId = 'open-meteo' | 'weather-company';

export type WeatherForecastSourceSeries = {
  points?: WeatherObservationPoint[];
  forecastHighC?: number;
  forecastLowC?: number;
  forecastUpdatedAt?: number;
};

export type WeatherObservationsResponse = {
  city: string;
  date: string;
  source?: WeatherTempSource;
  forecastSource?: WeatherForecastSourceId | string;
  locationId: string;
  timezone: string;
  dayStartMs: number;
  dayEndMs: number;
  points: WeatherObservationPoint[];
  forecastPoints?: WeatherObservationPoint[];
  forecastBySource?: Partial<Record<WeatherForecastSourceId | string, WeatherForecastSourceSeries>>;
  forecastHistory?: WeatherForecastHistoryBatch[];
  highTemp?: number;
  lowTemp?: number;
  forecastHighC?: number;
  forecastLowC?: number;
  forecastUpdatedAt?: number;
  /** Native unit for obs temps/dew points (forecast stays °C). */
  obsTempUnit?: WeatherTempUnit;
};

export function weatherObsWithForecastSource(
  data: WeatherObservationsResponse,
  source: WeatherForecastSourceId,
): WeatherObservationsResponse {
  const series = data.forecastBySource?.[source];
  if (!series?.points?.length) {
    // Legacy: flat forecastPoints is primary only — reuse for that source, else clear.
    if (data.forecastSource === source || (!data.forecastBySource && source === 'open-meteo')) {
      return { ...data, forecastSource: source };
    }
    return {
      ...data,
      forecastSource: source,
      forecastPoints: undefined,
      forecastHighC: undefined,
      forecastLowC: undefined,
      forecastUpdatedAt: undefined,
    };
  }
  return {
    ...data,
    forecastSource: source,
    forecastPoints: series.points,
    forecastHighC: series.forecastHighC,
    forecastLowC: series.forecastLowC,
    forecastUpdatedAt: series.forecastUpdatedAt,
  };
}

export type WeatherForecastSummary = {
  city: string;
  date: string;
  forecastHighC?: number;
  forecastLowC?: number;
  forecastUpdatedAt?: number;
};

function parseDateYmd(date: string): string {
  const raw = date.replace(/-/g, '');
  if (!/^\d{8}$/.test(raw)) {
    throw new Error(`invalid date: ${date}`);
  }
  return raw;
}

export type WeatherObsFetchOptions = {
  /** Past forecast lines — heavy; load after chart paints. */
  history?: boolean;
};

export async function fetchWeatherObservations(
  city: WeatherCitySlug,
  date: string,
  options?: WeatherObsFetchOptions,
): Promise<WeatherObservationsResponse> {
  const dateParam = parseDateYmd(date);
  const qs = new URLSearchParams({ date: dateParam });
  if (options?.history) qs.set('history', '1');
  const resp = await fetchBackend(
    `${API_BASE}/api/weather-observations/${encodeURIComponent(city)}?${qs.toString()}`,
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `weather observations ${resp.status}`);
  }
  return resp.json();
}

export async function fetchWeatherForecastSummary(
  city: WeatherCitySlug,
  date: string,
): Promise<WeatherForecastSummary> {
  const dateParam = parseDateYmd(date);
  const resp = await fetchBackend(
    `${API_BASE}/api/weather-forecast/${encodeURIComponent(city)}?date=${encodeURIComponent(dateParam)}`,
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `weather forecast ${resp.status}`);
  }
  return resp.json();
}

export function weatherDateInputValue(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function zonedYmdParts(d: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const n = (t: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  return { year: n('year'), month: n('month'), day: n('day') };
}

function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Calendar date YYYY-MM-DD in the given IANA timezone. */
export function weatherDateInputValueInTimezone(timeZone: string, d = new Date()): string {
  const { year, month, day } = zonedYmdParts(d, timeZone);
  return formatYmd(year, month, day);
}

/** Calendar date in timezone, offset by whole local days (e.g. +1 = tomorrow). */
export function weatherDateInputValuePlusDaysInTimezone(
  timeZone: string,
  deltaDays: number,
  d = new Date(),
): string {
  const { year, month, day } = zonedYmdParts(d, timeZone);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return formatYmd(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function isWeatherDateTodayInTimezone(date: string, timeZone: string): boolean {
  return date === weatherDateInputValueInTimezone(timeZone);
}

export function formatWeatherChartHour(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}

export function isWeatherDateToday(date: string): boolean {
  return date === weatherDateInputValue();
}

export type WeatherTempUnit = 'C' | 'F';

const TEMP_UNIT_STORAGE_KEY = 'polybot-weather-temp-unit';

export function readWeatherTempUnit(): WeatherTempUnit {
  try {
    return localStorage.getItem(TEMP_UNIT_STORAGE_KEY) === 'F' ? 'F' : 'C';
  } catch {
    return 'C';
  }
}

export function writeWeatherTempUnit(unit: WeatherTempUnit): void {
  localStorage.setItem(TEMP_UNIT_STORAGE_KEY, unit);
}

export function celsiusToDisplayTemp(celsius: number, unit: WeatherTempUnit): number {
  if (unit === 'F') return (celsius * 9) / 5 + 32;
  return celsius;
}

export function storedTempToDisplay(
  stored: number,
  storedUnit: WeatherTempUnit,
  displayUnit: WeatherTempUnit,
): number {
  if (storedUnit === displayUnit) return stored;
  if (storedUnit === 'F' && displayUnit === 'C') return ((stored - 32) * 5) / 9;
  return celsiusToDisplayTemp(stored, 'F');
}

export function obsTempToCelsius(temp: number, obsUnit: WeatherTempUnit = 'C'): number {
  if (obsUnit === 'F') return ((temp - 32) * 5) / 9;
  return temp;
}

export function floorDisplayTemp(
  stored: number,
  storedUnit: WeatherTempUnit,
  displayUnit: WeatherTempUnit,
): number {
  return Math.floor(storedTempToDisplay(stored, storedUnit, displayUnit));
}

/** Temp Odds low bucket highlight: colder of forecast low vs observed low. */
export function weatherHighlightLowC(data: WeatherObservationsResponse | null | undefined): number | null {
  if (!data) return null;
  const obsUnit = data.obsTempUnit ?? 'C';
  const obs = data.lowTemp != null ? obsTempToCelsius(data.lowTemp, obsUnit) : null;
  const fc = data.forecastLowC;
  if (obs != null && fc != null) return Math.min(obs, fc);
  return fc ?? obs ?? null;
}

/** Temp Odds high bucket highlight: forecast daily high; obs if already warmer. */
export function weatherHighlightHighC(data: WeatherObservationsResponse | null | undefined): number | null {
  if (!data) return null;
  const obsUnit = data.obsTempUnit ?? 'C';
  const obs = data.highTemp != null ? obsTempToCelsius(data.highTemp, obsUnit) : null;
  const fc = data.forecastHighC;
  if (obs != null && fc != null) return Math.max(obs, fc);
  return fc ?? obs ?? null;
}

/**
 * High bound for Mis Priced map: hotter of observed high and any forecast source high.
 * Matches Temp Odds gold ring when OM/WC disagree (e.g. OM 25.9 vs WC 26).
 */
export function weatherMispriceHighBoundC(
  data: WeatherObservationsResponse | null | undefined,
): number | null {
  if (!data) return null;
  const obsUnit = data.obsTempUnit ?? 'C';
  const obs = data.highTemp != null ? obsTempToCelsius(data.highTemp, obsUnit) : null;
  const fcs: number[] = [];
  const push = (v: number | undefined) => {
    if (v != null && Number.isFinite(v)) fcs.push(v);
  };
  push(data.forecastHighC);
  push(data.forecastBySource?.['open-meteo']?.forecastHighC);
  push(data.forecastBySource?.['weather-company']?.forecastHighC);
  const fcMax = fcs.length > 0 ? Math.max(...fcs) : null;
  if (obs != null && fcMax != null) return Math.max(obs, fcMax);
  return fcMax ?? obs ?? null;
}
