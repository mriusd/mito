import type { Market } from '../types';
import { isWeatherMarket } from '../utils/format';

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const WEATHER_CITY_TIMEZONES: Record<string, string> = {
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

type ParsedWeatherEvent = { city: string; year: number; month: number; day: number };

function parseWeatherEventSlug(slug: string): ParsedWeatherEvent | null {
  const m = slug.match(/(?:highest|lowest)-temperature-in-([a-z-]+)-on-([a-z]+)-(\d+)-(\d{4})/i);
  if (!m) return null;
  const monthIdx = MONTH_NAMES.indexOf(m[2].toLowerCase());
  if (monthIdx < 0) return null;
  const day = parseInt(m[3], 10);
  const year = parseInt(m[4], 10);
  if (!Number.isFinite(day) || !Number.isFinite(year)) return null;
  return { city: m[1].toLowerCase(), year, month: monthIdx + 1, day };
}

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

/** UTC ms when local clock in `timeZone` reads Y-M-D 00:00:00. */
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

function addCalendarDays(year: number, month: number, day: number, delta: number) {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Weather markets resolve at local midnight after the event calendar day. */
export function weatherMarketLocalMidnightExpiryMs(
  market:
    | Pick<Market, 'eventSlug' | 'question' | 'endDate'>
    | { endDate?: string; question?: string; eventSlug?: string }
    | null
    | undefined,
): number | null {
  if (!market || !isWeatherMarket(market)) return null;
  const slug = (market.eventSlug || '').trim();
  let parsed = parseWeatherEventSlug(slug);
  if (!parsed) {
    const cityM = slug.match(/(?:highest|lowest)-temperature-in-([a-z-]+)-on-/i);
    const qm = (market.question || '').match(/ on ([A-Za-z]+) (\d+)\?/);
    if (cityM && qm) {
      const monthIdx = MONTH_NAMES.indexOf(qm[1].toLowerCase());
      if (monthIdx >= 0) {
        const yearM = slug.match(/-(\d{4})$/);
        parsed = {
          city: cityM[1].toLowerCase(),
          year: yearM ? parseInt(yearM[1], 10) : new Date().getUTCFullYear(),
          month: monthIdx + 1,
          day: parseInt(qm[2], 10),
        };
      }
    }
  }
  if (!parsed) return null;
  const tz = WEATHER_CITY_TIMEZONES[parsed.city];
  if (!tz) return null;
  const expiryDate = addCalendarDays(parsed.year, parsed.month, parsed.day, 1);
  return zonedMidnightUtcMs(expiryDate.year, expiryDate.month, expiryDate.day, tz);
}

export function weatherMarketCountdownEndDate(
  market:
    | Pick<Market, 'eventSlug' | 'question' | 'endDate'>
    | { endDate?: string; question?: string; eventSlug?: string }
    | null
    | undefined,
): string {
  const ms = weatherMarketLocalMidnightExpiryMs(market);
  if (ms != null) return new Date(ms).toISOString();
  return String(market?.endDate || '').trim();
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
