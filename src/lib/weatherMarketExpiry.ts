import type { Market } from '../types';
import {
  WEATHER_CITIES,
  isWeatherCitySlug,
  weatherCityTimezone,
  type WeatherCitySlug,
} from './weatherCities';
import { isWeatherMarket } from '../utils/format';

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

export const WEATHER_CITY_TIMEZONES: Record<string, string> = Object.fromEntries(
  WEATHER_CITIES.map((c) => [c.slug, c.timezone]),
);

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
  if (isWeatherCitySlug(city)) return city;
  return city;
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

function weatherTimezoneForMarket(
  market: { eventSlug?: string; question?: string },
  cityOverride?: WeatherCitySlug | null,
): string {
  if (cityOverride) return weatherCityTimezone(cityOverride);
  const fromSlug = parseWeatherCityFromSlug(market.eventSlug || '');
  if (fromSlug) return weatherCityTimezone(fromSlug);
  const q = (market.question || '').toLowerCase();
  for (const c of WEATHER_CITIES) {
    const label = c.label.toLowerCase();
    const slugWords = c.slug.replace(/-/g, ' ');
    if (q.includes(`in ${label} `) || q.includes(`in ${label}?`) || q.includes(`in ${slugWords} `)) {
      return c.timezone;
    }
  }
  return 'UTC';
}

function weatherTimezoneForEvent(eventSlug: string, cityOverride?: WeatherCitySlug | null): string {
  return weatherTimezoneForMarket({ eventSlug, question: '' }, cityOverride);
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
  const parsed = parseWeatherEventDay(market);
  if (!parsed) return null;
  const timeZone = weatherTimezoneForMarket(market);
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

/** Chart window start for weather markets — trades often begin days before event day. */
export function weatherMarketChartStartMs(
  market:
    | Pick<Market, 'eventSlug' | 'question' | 'endDate'>
    | { endDate?: string; question?: string; eventSlug?: string }
    | null
    | undefined,
): number | null {
  const expiryMs = effectiveMarketExpiryMs(market);
  if (expiryMs == null || !market || !isWeatherMarket(market)) return null;
  return expiryMs - 14 * 24 * 60 * 60 * 1000;
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

/** Event day YYYY-MM-DD from slug like highest-temperature-in-london-on-july-7-2026. */
export function weatherEventBucketDateISO(
  market: { eventSlug?: string; question?: string; endDate?: string } | null | undefined,
): string | null {
  const slug = (market?.eventSlug || '').trim();
  const m = slug.match(/-on-([a-z]+)-(\d+)-(\d{4})/i);
  if (m) {
    const monthIdx = MONTH_NAMES.indexOf(m[1].toLowerCase());
    if (monthIdx >= 0) {
      const day = m[2].padStart(2, '0');
      const month = String(monthIdx + 1).padStart(2, '0');
      return `${m[3]}-${month}-${day}`;
    }
  }
  const parsed = parseWeatherEventDay(market || {});
  if (!parsed) return null;
  return `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
}

const TPO_WEATHER_DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
const TPO_WEATHER_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** TPO Date column for weather — event day from slug (no TODAY/TMR, no UTC endDate shift). */
export function formatWeatherEventDateLabel(
  market: { eventSlug?: string; question?: string; endDate?: string } | null | undefined,
): { label: string; color: string; eventDateIso: string } | null {
  const iso = weatherEventBucketDateISO(market);
  if (!iso) return null;
  const [y, mo, day] = iso.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day)) return null;
  const dow = new Date(Date.UTC(y, mo - 1, day, 12, 0, 0)).getUTCDay();
  const isWeekend = dow === 0 || dow === 6;
  return {
    label: `${TPO_WEATHER_DOW[dow]} ${day} ${TPO_WEATHER_MONTHS[mo - 1]}`,
    color: isWeekend ? 'text-purple-400' : 'text-gray-400',
    eventDateIso: iso,
  };
}

/** Sort/display date key for TPO rows — weather uses event day ISO, others use resolved expiry. */
export function tpoMarketSortDateIso(
  market: { endDate?: string; question?: string; eventSlug?: string } | null | undefined,
  fallbackEndDate?: string | null,
): string | null {
  if (market && isWeatherMarket(market)) {
    return weatherEventBucketDateISO(market);
  }
  const raw = market
    ? resolveMarketExpiryEndDate(market, market.endDate || fallbackEndDate || '') || null
    : fallbackEndDate || null;
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return getLocalDateKeyFromMs(ms);
}

/** YYYY-MM-DD bucket key for P&L Market Expiry mode (weather = event day from slug, like Temp Odds tabs). */
export function marketExpiryBucketDateKey(
  market:
    | Pick<Market, 'endDate' | 'question' | 'eventSlug'>
    | { endDate?: string; question?: string; eventSlug?: string }
    | null
    | undefined,
): string | null {
  if (!market) return null;
  if (isWeatherMarket(market)) {
    return weatherEventBucketDateISO(market);
  }
  const ms = effectiveMarketExpiryMs(market);
  if (ms == null) return null;
  return getLocalDateKeyFromMs(ms);
}

function getLocalDateKeyFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
