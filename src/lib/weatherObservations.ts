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
