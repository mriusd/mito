export type WeatherCitySlug = string;

export type WeatherCityMeta = {
  slug: WeatherCitySlug;
  label: string;
  timezone: string;
  /** Polymarket resolution station ICAO (WU history/hourly). */
  icao?: string;
  /** NOAA WRH timeseries instead of WU (istanbul, tel-aviv). */
  tempSource?: WeatherTempSource;
};

export type WeatherTempSource = 'wu' | 'weathergov';

/** Polymarket daily temperature cities (slug matches event slug segment). */
export const WEATHER_CITIES: WeatherCityMeta[] = [
  { slug: 'amsterdam', label: 'Amsterdam', timezone: 'Europe/Amsterdam', icao: 'EHAM' },
  { slug: 'ankara', label: 'Ankara', timezone: 'Europe/Istanbul', icao: 'LTAC' },
  { slug: 'atlanta', label: 'Atlanta', timezone: 'America/New_York', icao: 'KATL' },
  { slug: 'austin', label: 'Austin', timezone: 'America/Chicago', icao: 'KAUS' },
  { slug: 'beijing', label: 'Beijing', timezone: 'Asia/Shanghai', icao: 'ZBAA' },
  { slug: 'buenos-aires', label: 'Buenos Aires', timezone: 'America/Argentina/Buenos_Aires', icao: 'SAEZ' },
  { slug: 'busan', label: 'Busan', timezone: 'Asia/Seoul', icao: 'RKPK' },
  { slug: 'cape-town', label: 'Cape Town', timezone: 'Africa/Johannesburg', icao: 'FACT' },
  { slug: 'chengdu', label: 'Chengdu', timezone: 'Asia/Shanghai', icao: 'ZUUU' },
  { slug: 'chicago', label: 'Chicago', timezone: 'America/Chicago', icao: 'KORD' },
  { slug: 'chongqing', label: 'Chongqing', timezone: 'Asia/Shanghai', icao: 'ZUCK' },
  { slug: 'dallas', label: 'Dallas', timezone: 'America/Chicago', icao: 'KDAL' },
  { slug: 'denver', label: 'Denver', timezone: 'America/Denver', icao: 'KBKF' },
  { slug: 'guangzhou', label: 'Guangzhou', timezone: 'Asia/Shanghai', icao: 'ZGGG' },
  { slug: 'helsinki', label: 'Helsinki', timezone: 'Europe/Helsinki', icao: 'EFHK' },
  { slug: 'hong-kong', label: 'Hong Kong', timezone: 'Asia/Hong_Kong', icao: 'VHHH', tempSource: 'weathergov' },
  { slug: 'houston', label: 'Houston', timezone: 'America/Chicago', icao: 'KHOU' },
  { slug: 'istanbul', label: 'Istanbul', timezone: 'Europe/Istanbul', icao: 'LTFM', tempSource: 'weathergov' },
  { slug: 'jeddah', label: 'Jeddah', timezone: 'Asia/Riyadh', icao: 'OEJN' },
  { slug: 'karachi', label: 'Karachi', timezone: 'Asia/Karachi', icao: 'OPKC' },
  { slug: 'kuala-lumpur', label: 'Kuala Lumpur', timezone: 'Asia/Kuala_Lumpur', icao: 'WMKK' },
  { slug: 'london', label: 'London', timezone: 'Europe/London', icao: 'EGLC' },
  { slug: 'los-angeles', label: 'Los Angeles', timezone: 'America/Los_Angeles', icao: 'KLAX' },
  { slug: 'lucknow', label: 'Lucknow', timezone: 'Asia/Kolkata', icao: 'VILK' },
  { slug: 'madrid', label: 'Madrid', timezone: 'Europe/Madrid', icao: 'LEMD' },
  { slug: 'manila', label: 'Manila', timezone: 'Asia/Manila', icao: 'RPLL' },
  { slug: 'mexico-city', label: 'Mexico City', timezone: 'America/Mexico_City', icao: 'MMMX' },
  { slug: 'miami', label: 'Miami', timezone: 'America/New_York', icao: 'KMIA' },
  { slug: 'milan', label: 'Milan', timezone: 'Europe/Rome', icao: 'LIMC' },
  { slug: 'moscow', label: 'Moscow', timezone: 'Europe/Moscow', icao: 'UUWW', tempSource: 'weathergov' },
  { slug: 'munich', label: 'Munich', timezone: 'Europe/Berlin', icao: 'EDDM' },
  { slug: 'nyc', label: 'NYC', timezone: 'America/New_York', icao: 'KLGA' },
  { slug: 'panama-city', label: 'Panama City', timezone: 'America/Panama', icao: 'MPMG' },
  { slug: 'paris', label: 'Paris', timezone: 'Europe/Paris', icao: 'LFPB' },
  { slug: 'qingdao', label: 'Qingdao', timezone: 'Asia/Shanghai', icao: 'ZSQD' },
  { slug: 'san-francisco', label: 'San Francisco', timezone: 'America/Los_Angeles', icao: 'KSFO' },
  { slug: 'sao-paulo', label: 'Sao Paulo', timezone: 'America/Sao_Paulo', icao: 'SBGR' },
  { slug: 'seattle', label: 'Seattle', timezone: 'America/Los_Angeles', icao: 'KSEA' },
  { slug: 'seoul', label: 'Seoul', timezone: 'Asia/Seoul', icao: 'RKSI' },
  { slug: 'shanghai', label: 'Shanghai', timezone: 'Asia/Shanghai', icao: 'ZSPD' },
  { slug: 'shenzhen', label: 'Shenzhen', timezone: 'Asia/Shanghai', icao: 'ZGSZ' },
  { slug: 'singapore', label: 'Singapore', timezone: 'Asia/Singapore', icao: 'WSSS' },
  { slug: 'taipei', label: 'Taipei', timezone: 'Asia/Taipei', icao: 'RCSS' },
  { slug: 'tel-aviv', label: 'Tel Aviv', timezone: 'Asia/Jerusalem', icao: 'LLBG', tempSource: 'weathergov' },
  { slug: 'tokyo', label: 'Tokyo', timezone: 'Asia/Tokyo', icao: 'RJTT' },
  { slug: 'toronto', label: 'Toronto', timezone: 'America/Toronto', icao: 'CYYZ' },
  { slug: 'warsaw', label: 'Warsaw', timezone: 'Europe/Warsaw', icao: 'EPWA' },
  { slug: 'wellington', label: 'Wellington', timezone: 'Pacific/Auckland', icao: 'NZWN' },
  { slug: 'wuhan', label: 'Wuhan', timezone: 'Asia/Shanghai', icao: 'ZHHH' },
];

export const WEATHER_CITY_SLUGS = new Set<string>(WEATHER_CITIES.map((c) => c.slug));

export function isWeatherCitySlug(slug: string): slug is WeatherCitySlug {
  return WEATHER_CITY_SLUGS.has(slug);
}

export function weatherCityTimezone(slug: string): string {
  return WEATHER_CITIES.find((c) => c.slug === slug)?.timezone ?? 'UTC';
}

/** US Polymarket weather markets use °F; fallback when bucket titles not loaded yet. */
const WEATHER_FAHRENHEIT_CITY_SLUGS = new Set<string>([
  'atlanta',
  'austin',
  'chicago',
  'dallas',
  'denver',
  'houston',
  'los-angeles',
  'miami',
  'nyc',
  'san-francisco',
  'seattle',
]);

export function weatherCityTempUnit(slug: string, marketTitles: string[] = []): 'C' | 'F' {
  for (const t of marketTitles) {
    if (/°F/i.test(t)) return 'F';
    if (/°C/i.test(t)) return 'C';
  }
  return WEATHER_FAHRENHEIT_CITY_SLUGS.has(slug.trim().toLowerCase()) ? 'F' : 'C';
}

export function formatWeatherCityLocalClock(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}

export function weatherCityLabel(slug: string): string {
  const hit = WEATHER_CITIES.find((c) => c.slug === slug);
  if (hit) return hit.label;
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function weatherCityTempSource(slug: string): WeatherTempSource {
  return WEATHER_CITIES.find((c) => c.slug === slug.trim().toLowerCase())?.tempSource ?? 'wu';
}

export function weatherCityResolutionUrl(slug: string, dateYmd?: string | null): string | null {
  return weatherCityWundergroundHourlyUrl(slug, dateYmd);
}

export function weatherCityWundergroundHourlyUrl(slug: string, dateYmd?: string | null): string | null {
  const icao = WEATHER_CITIES.find((c) => c.slug === slug.trim().toLowerCase())?.icao?.trim();
  if (!icao) return null;
  const base = `https://www.wunderground.com/hourly/${icao.toUpperCase()}`;
  if (!dateYmd) return base;
  const raw = dateYmd.replace(/-/g, '');
  if (!/^\d{8}$/.test(raw)) return base;
  return `${base}/date/${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/** Aviation Weather Center decoded METAR for city ICAO. */
export function weatherCityMetarUrl(slug: string): string | null {
  const icao = WEATHER_CITIES.find((c) => c.slug === slug.trim().toLowerCase())?.icao?.trim();
  if (!icao) return null;
  return `https://aviationweather.gov/data/metar/?decoded=1&autorefresh=0&ids=${encodeURIComponent(icao.toUpperCase())}`;
}

/** Catalog cities plus any extra slugs from loaded market data. */
export function mergeWeatherCityOptions(extraSlugs: string[] = []): WeatherCityMeta[] {
  const map = new Map<string, WeatherCityMeta>(WEATHER_CITIES.map((c) => [c.slug, c]));
  for (const slug of extraSlugs) {
    const s = slug.trim().toLowerCase();
    if (!s || map.has(s)) continue;
    map.set(s, { slug: s, label: weatherCityLabel(s), timezone: 'UTC' });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}
