import type { Market, WeatherCitySlug } from '../types';
import { isWeatherMarket } from '../utils/format';

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

export const WEATHER_CITY_TIMEZONES: Record<WeatherCitySlug, string> = {
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

type ParsedWeatherEventDay = { year: number; month: number; day: number };

function parseWeatherEventSlug(slug: string): ParsedWeatherEventDay | null {
  const m = slug.match(/(?:highest|lowest)-temperature-in-([a-z-]+)-on-([a-z]+)-(\d+)-(\d{4})/i);
  if (!m) return null;
  const monthIdx = MONTH_NAMES.indexOf(m[2].toLowerCase());
  if (monthIdx < 0) return null;
  const day = parseInt(m[3], 10);
  const year = parseInt(m[4], 10);
  if (!Number.isFinite(day) || !Number.isFinite(year)) return null;
  return { year, month: monthIdx + 1, day };
}

export function parseWeatherCityFromSlug(eventSlug: string): WeatherCitySlug | null {
  const m = eventSlug.match(/(?:highest|lowest)-temperature-in-([a-z-]+)-on-/i);
  if (!m) return null;
  const city = m[1].toLowerCase();
  if (city in WEATHER_CITY_TIMEZONES) return city as WeatherCitySlug;
  return null;
}

function parseWeatherEventDay(
  market: Pick<Market, 'eventSlug' | 'question' | 'endDate'> | { endDate?: string; question?: string; eventSlug?: string },
): ParsedWeatherEventDay | null {
  const slug = (market.eventSlug || '').trim();
  const fromSlug = parseWeatherEventSlug(slug);
  if (fromSlug) return fromSlug;

  const qm = (market.question || '').match(/ on ([A-Za-z]+) (\d+)\?/i);
  if (!qm) return null;
  const monthIdx = MONTH_NAMES.indexOf(qm[1].toLowerCase());
  if (monthIdx < 0) return null;

  const yearM = slug.match(/-(\d{4})$/) || String(market.endDate || '').match(/(\d{4})/);
  const year = yearM ? parseInt(yearM[1], 10) : new Date().getUTCFullYear();
  if (!Number.isFinite(year)) return null;

  return { year, month: monthIdx + 1, day: parseInt(qm[2], 10) };
}

function addCalendarDaysUtc(year: number, month: number, day: number, delta: number): ParsedWeatherEventDay {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedPartsAt(ms: number, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const n = (t: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  let hour = n('hour');
  if (hour === 24) hour = 0;
  return { year: n('year'), month: n('month'), day: n('day'), hour, minute: n('minute'), second: n('second') };
}

/** UTC epoch ms for local midnight on a calendar day in the given IANA timezone. */
export function zonedLocalMidnightUtcMs(year: number, month: number, day: number, timeZone: string): number {
  let utcMs = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const p = zonedPartsAt(utcMs, timeZone);
    const deltaMin =
      (year - p.year) * 525600 +
      (month - p.month) * 43200 +
      (day - p.day) * 1440 -
      p.hour * 60 -
      p.minute -
      Math.round(p.second / 60);
    if (deltaMin === 0) break;
    utcMs += deltaMin * 60_000;
  }
  return utcMs;
}

function weatherTimezoneForEvent(eventSlug: string, cityOverride?: WeatherCitySlug | null): string {
  if (cityOverride && WEATHER_CITY_TIMEZONES[cityOverride]) {
    return WEATHER_CITY_TIMEZONES[cityOverride];
  }
  const citySlug = parseWeatherCityFromSlug(eventSlug);
  if (citySlug) return WEATHER_CITY_TIMEZONES[citySlug];
  return 'UTC';
}

/** Weather markets resolve at 00:00 local time on the day after the event calendar date. */
export function weatherMarketExpiryMsForEvent(
  citySlug: WeatherCitySlug,
  eventSlug: string,
): number | null {
  const parsed = parseWeatherEventSlug(eventSlug);
  if (!parsed) return null;
  const timeZone = weatherTimezoneForEvent(eventSlug, citySlug);
  const expiryDay = addCalendarDaysUtc(parsed.year, parsed.month, parsed.day, 1);
  return zonedLocalMidnightUtcMs(expiryDay.year, expiryDay.month, expiryDay.day, timeZone);
}

export function weatherMarketLocalMidnightExpiryMs(
  market:
    | Pick<Market, 'eventSlug' | 'question' | 'endDate'>
    | { endDate?: string; question?: string; eventSlug?: string }
    | null
    | undefined,
): number | null {
  if (!market || !isWeatherMarket(market)) return null;
  const slug = (market.eventSlug || '').trim();
  const parsed = parseWeatherEventDay(market);
  if (!parsed) return null;
  const timeZone = weatherTimezoneForEvent(slug);
  const expiryDay = addCalendarDaysUtc(parsed.year, parsed.month, parsed.day, 1);
  return zonedLocalMidnightUtcMs(expiryDay.year, expiryDay.month, expiryDay.day, timeZone);
}

export function weatherMarketCountdownEndDate(
  market:
    | Pick<Market, 'eventSlug' | 'question' | 'endDate'>
    | { endDate?: string; question?: string; eventSlug?: string }
    | null
    | undefined,
): string {
  const ms = weatherMarketLocalMidnightExpiryMs(market);
  if (ms == null) return '';
  return new Date(ms).toISOString();
}

export function resolveMarketExpiryEndDate(
  market:
    | Pick<Market, 'endDate' | 'question' | 'eventSlug'>
    | { endDate?: string; question?: string; eventSlug?: string }
    | null
    | undefined,
  fallback = '',
): string {
  if (market && isWeatherMarket(market)) {
    const weather = weatherMarketCountdownEndDate(market);
    if (weather) return weather;
  }
  const raw = String(market?.endDate ?? fallback).trim();
  return raw || String(fallback).trim();
}

export function effectiveMarketExpiryMs(
  market:
    | Pick<Market, 'endDate' | 'question' | 'eventSlug'>
    | { closed?: boolean; endDate?: string; question?: string; eventSlug?: string }
    | null
    | undefined,
): number | null {
  if (!market) return null;
  const weatherMs = weatherMarketLocalMidnightExpiryMs(market);
  if (weatherMs != null) return weatherMs;
  const raw = String(market.endDate || '').trim();
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}
