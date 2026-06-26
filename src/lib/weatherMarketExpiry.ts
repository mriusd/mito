import type { Market } from '../types';
import { isWeatherMarket } from '../utils/format';

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

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

/** Weather markets resolve at 00:00 GMT/UTC on the day after the event calendar date. */
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
  const expiry = addCalendarDaysUtc(parsed.year, parsed.month, parsed.day, 1);
  return Date.UTC(expiry.year, expiry.month - 1, expiry.day, 0, 0, 0);
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
