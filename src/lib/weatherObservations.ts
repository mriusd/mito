import { API_BASE } from './env';
import type { WeatherCitySlug } from '../types';

export type WeatherObservationPoint = {
  timeMs: number;
  temp: number;
};

export type WeatherObservationsResponse = {
  city: string;
  date: string;
  locationId: string;
  timezone: string;
  dayStartMs: number;
  dayEndMs: number;
  points: WeatherObservationPoint[];
  highTemp?: number;
  lowTemp?: number;
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

export function weatherDateInputValue(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
