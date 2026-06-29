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

/** Merge high/low event dates by calendar day (endDate UTC date key). */
export function mergeWeatherDateColumns(highDates: DateCol[], lowDates: DateCol[]): DateCol[] {
  const byKey = new Map<string, DateCol>();
  const keyOf = (d: DateCol) => {
    const t = new Date(d.endDate).getTime();
    return Number.isFinite(t) ? String(t) : d.slug;
  };
  for (const d of [...highDates, ...lowDates]) {
    const k = keyOf(d);
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

export function findDateColForEndDate(dates: DateCol[], targetEndDate: string): DateCol | undefined {
  const target = new Date(targetEndDate).getTime();
  if (!Number.isFinite(target)) return dates[0];
  return dates.find((d) => new Date(d.endDate).getTime() === target) ?? dates[0];
}
