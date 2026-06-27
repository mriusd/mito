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

const SYNOPTIC_TIMESERIES_URL =
  'https://api.synopticdata.com/v2/stations/timeseries?STID=EGLC&showemptystations=1&recent=4320&complete=1&token=7c76618b66c74aee913bdbae4b448bdd&obtimezone=local';

const SYNOPTIC_STIDS: Record<WeatherCitySlug, string> = {
  nyc: 'NYC',
  london: 'EGLC',
  'hong-kong': 'VHHH',
  chicago: 'MDW',
  miami: 'MIA',
  seoul: 'RKSS',
  tokyo: 'RJTT',
  paris: 'CDG',
  dallas: 'DFW',
  atlanta: 'ATL',
};

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

function synopticUrlForCity(stid: string): string {
  return SYNOPTIC_TIMESERIES_URL.replace('STID=EGLC', `STID=${encodeURIComponent(stid)}`);
}

function parseSynopticLocalTime(isoLocal: string, timeZone: string): number | null {
  const m = isoLocal.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const target = {
    year: parseInt(m[1], 10),
    month: parseInt(m[2], 10),
    day: parseInt(m[3], 10),
    hour: parseInt(m[4], 10),
    minute: parseInt(m[5], 10),
    second: parseInt(m[6], 10),
  };
  let lo = Date.UTC(target.year, target.month - 1, target.day - 1);
  let hi = Date.UTC(target.year, target.month - 1, target.day + 1);
  for (let t = lo; t <= hi; t += 1000) {
    const p = getZonedYMDHMS(t, timeZone);
    if (
      p.year === target.year &&
      p.month === target.month &&
      p.day === target.day &&
      p.hour === target.hour &&
      p.minute === target.minute &&
      p.second === target.second
    ) {
      return t;
    }
  }
  return null;
}

function airTempKey(observations: Record<string, unknown>): string | null {
  for (const key of Object.keys(observations)) {
    if (key.startsWith('air_temp_set_')) return key;
  }
  return null;
}

export async function fetchWeatherObservations(
  city: WeatherCitySlug,
  date: string,
): Promise<WeatherObservationsResponse> {
  const dateParam = date.replace(/-/g, '');
  const bounds = cityDayBounds(city, dateParam);
  const stid = SYNOPTIC_STIDS[city];
  if (!bounds || !stid) {
    throw new Error(`unknown city: ${city}`);
  }

  const resp = await fetch(synopticUrlForCity(stid));
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `synoptic ${resp.status}`);
  }

  const raw = (await resp.json()) as {
    SUMMARY?: { RESPONSE_CODE?: number; RESPONSE_MESSAGE?: string };
    STATION?: Array<{
      TIMEZONE?: string;
      OBSERVATIONS?: Record<string, unknown>;
    }>;
  };

  if (raw.SUMMARY?.RESPONSE_CODE !== 1) {
    throw new Error(raw.SUMMARY?.RESPONSE_MESSAGE || 'synoptic request failed');
  }

  const station = raw.STATION?.[0];
  const observations = station?.OBSERVATIONS;
  if (!observations) {
    throw new Error('synoptic returned no observations');
  }

  const tempKey = airTempKey(observations);
  if (!tempKey) {
    throw new Error('synoptic returned no air temperature');
  }

  const timeZone = station.TIMEZONE || bounds.timezone;
  const dateTimes = observations.date_time;
  const temps = observations[tempKey];
  if (!Array.isArray(dateTimes) || !Array.isArray(temps)) {
    throw new Error('synoptic observation shape invalid');
  }

  const points: WeatherObservationPoint[] = [];
  let high: number | undefined;
  let low: number | undefined;

  for (let i = 0; i < dateTimes.length; i++) {
    const dt = dateTimes[i];
    const temp = temps[i];
    if (typeof dt !== 'string' || temp == null || !Number.isFinite(temp)) continue;
    const timeMs = parseSynopticLocalTime(dt, timeZone);
    if (timeMs == null) continue;
    if (timeMs < bounds.dayStartMs || timeMs >= bounds.dayEndMs) continue;
    points.push({ timeMs, temp: Number(temp) });
    if (high == null || temp > high) high = Number(temp);
    if (low == null || temp < low) low = Number(temp);
  }
  points.sort((a, b) => a.timeMs - b.timeMs);

  return {
    city,
    date: dateParam,
    locationId: stid,
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
