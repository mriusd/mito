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

const WEATHER_COM_API_KEY = String(import.meta.env.VITE_WEATHER_COM_API_KEY || '').trim();

const WEATHER_CITY_TIMEZONES: Record<WeatherCitySlug, string> = {
  nyc: 'America/New_York',
  london: 'Europe/London',
  'hong-kong': 'Asia/Hong_Kong',
  chicago: 'America/Chicago',
  miami: 'America/New_York',
  seoul: 'Asia/Seoul',
  tokyo: 'Asia/Tokyo',
  paris: 'Europe/Paris',
  dallas: 'America/Chicago',
  atlanta: 'America/New_York',
};

const WEATHER_COM_LOCATIONS: Record<WeatherCitySlug, string> = {
  nyc: 'KNYC:9:US',
  london: 'EGLC:9:GB',
  'hong-kong': 'VHHH:9:HK',
  chicago: 'KMDW:9:US',
  miami: 'KMIA:9:US',
  seoul: 'RKSS:9:KR',
  tokyo: 'RJTT:9:JP',
  paris: 'LFPG:9:FR',
  dallas: 'KDFW:9:US',
  atlanta: 'KATL:9:US',
};

function getZonedYMDHMS(ms: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(new Date(ms));
  const n = (t: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  return {
    year: n('year'),
    month: n('month'),
    day: n('day'),
    hour: n('hour'),
    minute: n('minute'),
    second: n('second'),
  };
}

function zonedMidnightUtcMs(year: number, month: number, day: number, timeZone: string): number {
  let lo = Date.UTC(year, month - 1, day - 2);
  let hi = Date.UTC(year, month - 1, day + 2);
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    const p = getZonedYMDHMS(mid, timeZone);
    const localOrdinal = p.year * 10000 + p.month * 100 + p.day;
    const targetOrdinal = year * 10000 + month * 100 + day;
    const cmp = localOrdinal - targetOrdinal;
    if (cmp < 0 || (cmp === 0 && (p.hour > 0 || p.minute > 0 || p.second > 0))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  for (let t = lo; t <= hi; t += 1000) {
    const p = getZonedYMDHMS(t, timeZone);
    if (p.year === year && p.month === month && p.day === day && p.hour === 0 && p.minute === 0 && p.second === 0) {
      return t;
    }
  }
  return hi;
}

function parseDateYmd(date: string): { year: number; month: number; day: number } | null {
  const raw = date.replace(/-/g, '');
  if (!/^\d{8}$/.test(raw)) return null;
  const year = parseInt(raw.slice(0, 4), 10);
  const month = parseInt(raw.slice(4, 6), 10);
  const day = parseInt(raw.slice(6, 8), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

function cityDayBounds(city: WeatherCitySlug, date: string) {
  const parsed = parseDateYmd(date);
  const tz = WEATHER_CITY_TIMEZONES[city];
  if (!parsed || !tz) return null;
  const dayStartMs = zonedMidnightUtcMs(parsed.year, parsed.month, parsed.day, tz);
  return { dayStartMs, dayEndMs: dayStartMs + 24 * 60 * 60 * 1000, timezone: tz };
}

export async function fetchWeatherObservations(
  city: WeatherCitySlug,
  date: string,
): Promise<WeatherObservationsResponse> {
  if (!WEATHER_COM_API_KEY) {
    throw new Error('VITE_WEATHER_COM_API_KEY not set');
  }
  const dateParam = date.replace(/-/g, '');
  const bounds = cityDayBounds(city, dateParam);
  const locationId = WEATHER_COM_LOCATIONS[city];
  if (!bounds || !locationId) {
    throw new Error(`unknown city: ${city}`);
  }

  const url =
    `https://api.weather.com/v1/location/${encodeURIComponent(locationId)}/observations/historical.json` +
    `?apiKey=${encodeURIComponent(WEATHER_COM_API_KEY)}&units=m&startDate=${dateParam}&endDate=${dateParam}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `weather.com ${resp.status}`);
  }

  const raw = (await resp.json()) as {
    observations?: Array<{ valid_time_gmt?: number; temp?: number }>;
  };

  const points: WeatherObservationPoint[] = [];
  let high: number | undefined;
  let low: number | undefined;

  for (const o of raw.observations || []) {
    const sec = o.valid_time_gmt;
    if (sec == null || sec <= 0 || o.temp == null || !Number.isFinite(o.temp)) continue;
    const timeMs = sec * 1000;
    if (timeMs < bounds.dayStartMs || timeMs >= bounds.dayEndMs) continue;
    points.push({ timeMs, temp: o.temp });
    if (high == null || o.temp > high) high = o.temp;
    if (low == null || o.temp < low) low = o.temp;
  }
  points.sort((a, b) => a.timeMs - b.timeMs);

  return {
    city,
    date: dateParam,
    locationId,
    timezone: bounds.timezone,
    dayStartMs: bounds.dayStartMs,
    dayEndMs: bounds.dayEndMs,
    points,
    ...(high != null && low != null ? { highTemp: high, lowTemp: low } : {}),
  };
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
