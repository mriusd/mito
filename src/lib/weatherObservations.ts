import { API_BASE } from './env';
import type { WeatherCitySlug } from '../types';
import type { WeatherTempSource } from './weatherCities';

export type WeatherObservationPoint = {
  timeMs: number;
  temp: number;
};

export type WeatherForecastHistoryBatch = {
  issuedAtMs: number;
  points: WeatherObservationPoint[];
};

export type WeatherObservationsResponse = {
  city: string;
  date: string;
  source?: WeatherTempSource;
  forecastSource?: 'wunderground';
  locationId: string;
  timezone: string;
  dayStartMs: number;
  dayEndMs: number;
  points: WeatherObservationPoint[];
  forecastPoints?: WeatherObservationPoint[];
  forecastHistory?: WeatherForecastHistoryBatch[];
  highTemp?: number;
  lowTemp?: number;
  forecastHighC?: number;
  forecastLowC?: number;
  forecastUpdatedAt?: number;
};

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

export async function fetchWeatherObservations(
  city: WeatherCitySlug,
  date: string,
): Promise<WeatherObservationsResponse> {
  const dateParam = parseDateYmd(date);
  const resp = await fetch(
    `${API_BASE}/api/weather-observations/${encodeURIComponent(city)}?date=${encodeURIComponent(dateParam)}`,
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
  const resp = await fetch(
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

export function floorDisplayTemp(celsius: number, unit: WeatherTempUnit): number {
  return Math.floor(celsiusToDisplayTemp(celsius, unit));
}

/** Low bucket highlight: observed min if colder than forecast. */
export function weatherHighlightLowC(data: WeatherObservationsResponse | null | undefined): number | null {
  if (!data) return null;
  const obs = data.lowTemp;
  const fc = data.forecastLowC;
  if (obs != null && fc != null) return Math.min(obs, fc);
  return obs ?? fc ?? null;
}

/** High bucket highlight: observed daily max (resolution source). */
export function weatherHighlightHighC(data: WeatherObservationsResponse | null | undefined): number | null {
  if (!data) return null;
  return data.highTemp ?? null;
}
