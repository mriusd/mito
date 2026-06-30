import { resolveMarketExpiryEndDate } from './weatherMarketExpiry';
import type { Market } from '../types';

export type WeatherMetric = 'high' | 'low';

export function filterWeatherMarkets(markets: Market[], metric: WeatherMetric): Market[] {
  const needle = metric === 'high' ? 'highest-temperature' : 'lowest-temperature';
  return markets.filter((m) => (m.eventSlug || '').includes(needle));
}

export function getTempSortValue(str: string): number {
  const s = str.replace(/°[FC]/gi, '').trim();
  if (/ or below$/i.test(s) || / or lower$/i.test(s)) {
    const n = parseFloat(s.replace(/ or below| or lower/gi, ''));
    return (Number.isFinite(n) ? n : 0) - 0.5;
  }
  if (/ or higher$/i.test(s) || / or above$/i.test(s)) {
    const n = parseFloat(s.replace(/ or higher| or above/gi, ''));
    return (Number.isFinite(n) ? n : 0) + 10_000;
  }
  if (s.includes('-')) {
    const n = parseFloat(s.split('-')[0]);
    return Number.isFinite(n) ? n : 0;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Compact x-axis label for bar charts (matches weather grid bucket text). */
export function compactTempBucketLabel(temp: string): string {
  const s = temp.replace(/°[FC]/gi, '').trim();
  if (/ or below$/i.test(s) || / or lower$/i.test(s)) {
    const n = parseFloat(s.replace(/ or below| or lower/gi, ''));
    return Number.isFinite(n) ? `<${Math.round(n)}` : s;
  }
  if (/ or higher$/i.test(s) || / or above$/i.test(s)) {
    const n = parseFloat(s.replace(/ or higher| or above/gi, ''));
    return Number.isFinite(n) ? `>${Math.round(n)}` : s;
  }
  return s.replace(/\s+/g, '');
}

const WEATHER_EVENT_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

/** Event day YYYY-MM-DD from slug like highest-temperature-in-london-on-june-28-2026. */
export function weatherEventDateISOFromSlug(eventSlug: string): string | null {
  const m = eventSlug.match(/-on-([a-z]+)-(\d+)-(\d{4})/i);
  if (!m) return null;
  const mi = WEATHER_EVENT_MONTHS.indexOf(m[1].toLowerCase() as (typeof WEATHER_EVENT_MONTHS)[number]);
  if (mi < 0) return null;
  const day = m[2].padStart(2, '0');
  const month = String(mi + 1).padStart(2, '0');
  return `${m[3]}-${month}-${day}`;
}

export function lookupModelBucketProb(
  buckets: Record<string, number> | undefined | null,
  temp: string,
): number | null {
  if (!buckets) return null;
  const label = compactTempBucketLabel(temp);
  if (label in buckets) return buckets[label]!;

  // The model emits 1-degree integer buckets keyed by floor(value). Markets may
  // bucket those into ranges (e.g. "84-85") or open tails (e.g. "<75", ">94"),
  // so aggregate the integer buckets that fall inside the market outcome.
  const intKeys: number[] = [];
  for (const k of Object.keys(buckets)) {
    const n = Number(k);
    if (Number.isInteger(n)) intKeys.push(n);
  }
  const sumRange = (lo: number, hi: number): number | null => {
    let sum = 0;
    let found = false;
    for (const n of intKeys) {
      if (n >= lo && n <= hi) {
        sum += buckets[String(n)]!;
        found = true;
      }
    }
    return found ? sum : null;
  };

  const intMatch = label.match(/^(\d+)$/);
  if (intMatch) {
    const n = parseInt(intMatch[1], 10);
    const hi = `${n}-${n + 1}`;
    if (hi in buckets) return buckets[hi]!;
    const lo = `${n - 1}-${n}`;
    if (lo in buckets) return buckets[lo]!;
    return null;
  }

  const rangeMatch = label.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    return sumRange(parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10));
  }

  const ltMatch = label.match(/^<(\d+)$/);
  if (ltMatch) {
    return sumRange(Number.NEGATIVE_INFINITY, parseInt(ltMatch[1], 10));
  }

  const gtMatch = label.match(/^>(\d+)$/);
  if (gtMatch) {
    return sumRange(parseInt(gtMatch[1], 10), Number.POSITIVE_INFINITY);
  }

  const bare = temp.replace(/°[FC]/gi, '').replace(/\s+/g, '');
  if (bare in buckets) return buckets[bare]!;
  return null;
}

/** True when a market temp bucket (groupItemTitle) contains the forecast value. */
export function weatherTempBucketMatchesCelsius(temp: string, tempCelsius: number): boolean {
  if (!Number.isFinite(tempCelsius)) return false;
  const unit: 'C' | 'F' = /°F/i.test(temp) ? 'F' : 'C';
  const v = Math.floor(unit === 'F' ? (tempCelsius * 9) / 5 + 32 : tempCelsius);
  const s = temp.replace(/°[FC]/gi, '').trim();

  if (/ or below/i.test(s) || / or lower/i.test(s)) {
    const n = Math.floor(parseFloat(s.replace(/ or below| or lower/gi, '')));
    return Number.isFinite(n) && v <= n;
  }
  if (/ or higher/i.test(s) || / or above/i.test(s)) {
    const n = Math.floor(parseFloat(s.replace(/ or higher| or above/gi, '')));
    return Number.isFinite(n) && v >= n;
  }
  if (s.includes('-')) {
    const parts = s.split('-');
    if (parts.length === 2) {
      const lo = Math.floor(parseFloat(parts[0].trim()));
      const hi = Math.floor(parseFloat(parts[1].trim()));
      if (Number.isFinite(lo) && Number.isFinite(hi)) return v >= lo && v <= hi;
    }
  }
  const n = Math.floor(parseFloat(s));
  return Number.isFinite(n) && v === n;
}

/** Stable key for weather event calendar day (slug), not UTC endDate. */
export function weatherDateColKey(d: DateCol): string {
  const fromSlug = weatherEventDateISOFromSlug(d.slug);
  if (fromSlug) return fromSlug;
  const t = new Date(d.endDate).getTime();
  return Number.isFinite(t) ? String(t) : d.slug;
}

const WEATHER_TAB_DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
const WEATHER_TAB_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

/** Tab header from event slug day (avoids UTC endDate shifting Seoul etc.). */
export function formatWeatherDateColHeader(d: DateCol): string {
  const iso = weatherEventDateISOFromSlug(d.slug);
  if (iso) {
    const [y, mo, day] = iso.split('-').map((x) => parseInt(x, 10));
    if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(day)) {
      const dow = new Date(Date.UTC(y, mo - 1, day, 12, 0, 0)).getUTCDay();
      return `${WEATHER_TAB_DAY_LABELS[dow]} ${WEATHER_TAB_MONTHS[mo - 1]} ${day}`;
    }
  }
  const dt = new Date(d.endDate);
  if (!Number.isFinite(dt.getTime())) return '';
  return `${WEATHER_TAB_DAY_LABELS[dt.getDay()]} ${WEATHER_TAB_MONTHS[dt.getMonth()]} ${dt.getDate()}`;
}

export function isWeatherDateColWeekend(d: DateCol): boolean {
  const iso = weatherEventDateISOFromSlug(d.slug);
  if (iso) {
    const [y, mo, day] = iso.split('-').map((x) => parseInt(x, 10));
    if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(day)) {
      const dow = new Date(Date.UTC(y, mo - 1, day, 12, 0, 0)).getUTCDay();
      return dow === 0 || dow === 6;
    }
  }
  const dt = new Date(d.endDate);
  return dt.getDay() === 0 || dt.getDay() === 6;
}

export interface DateCol {
  slug: string;
  endDate: string;
  expiryEndDate: string;
  title: string;
}

export interface WeatherGridData {
  dates: DateCol[];
  temps: string[];
  marketLookup: Record<string, Market>;
}

export function buildTableData(markets: Market[], includePast: boolean): WeatherGridData {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const dateMap = new Map<string, DateCol>();
  const tempSet = new Set<string>();
  const marketLookup: Record<string, Market> = {};

  for (const m of markets) {
    const slug = m.eventSlug || '';
    if (!slug) continue;
    if (!dateMap.has(slug)) {
      dateMap.set(slug, {
        slug,
        endDate: m.endDate,
        expiryEndDate: resolveMarketExpiryEndDate(m, m.endDate),
        title: m.eventTitle || '',
      });
    }
  }

  for (const m of markets) {
    const slug = m.eventSlug || '';
    const temp = m.groupItemTitle || '';
    if (!slug || !temp) continue;
    tempSet.add(temp);
    marketLookup[temp + '_' + slug] = m;
  }

  let dates = Array.from(dateMap.values())
    .filter((d) => {
      const endTime = d.expiryEndDate ? new Date(d.expiryEndDate).getTime() : Infinity;
      return endTime > oneDayAgo;
    })
    .sort((a, b) => {
      const ta = a.expiryEndDate ? new Date(a.expiryEndDate).getTime() : Infinity;
      const tb = b.expiryEndDate ? new Date(b.expiryEndDate).getTime() : Infinity;
      return ta - tb;
    });

  if (!includePast) {
    dates = dates.filter((d) => !d.expiryEndDate || new Date(d.expiryEndDate).getTime() >= now);
  }

  const temps = Array.from(tempSet)
    .filter((temp) => dates.some((d) => marketLookup[temp + '_' + d.slug]))
    .sort((a, b) => getTempSortValue(a) - getTempSortValue(b));

  return { dates, temps, marketLookup };
}

/** Merge high/low event dates by calendar event day (slug), not UTC endDate. */
export function mergeWeatherDateColumns(highDates: DateCol[], lowDates: DateCol[]): DateCol[] {
  const byKey = new Map<string, DateCol>();
  for (const d of [...highDates, ...lowDates]) {
    const k = weatherDateColKey(d);
    const prev = byKey.get(k);
    if (!prev || new Date(d.expiryEndDate).getTime() < new Date(prev.expiryEndDate).getTime()) {
      byKey.set(k, d);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const ta = a.expiryEndDate ? new Date(a.expiryEndDate).getTime() : Infinity;
    const tb = b.expiryEndDate ? new Date(b.expiryEndDate).getTime() : Infinity;
    return ta - tb;
  });
}

export function findDateColForEndDate(dates: DateCol[], target: DateCol): DateCol | undefined {
  if (dates.length === 0) return undefined;
  const key = weatherDateColKey(target);
  const byKey = dates.find((d) => weatherDateColKey(d) === key);
  if (byKey) return byKey;
  const targetMs = new Date(target.endDate).getTime();
  if (!Number.isFinite(targetMs)) return undefined;
  return dates.find((d) => new Date(d.endDate).getTime() === targetMs);
}
