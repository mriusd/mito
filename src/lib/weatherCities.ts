export type WeatherCitySlug = string;

export type WeatherCityMeta = {
  slug: WeatherCitySlug;
  label: string;
  timezone: string;
  icao?: string;
};

/** Polymarket daily temperature cities (slug matches event slug segment). */
export const WEATHER_CITIES: WeatherCityMeta[] = [
  { slug: 'amsterdam', label: 'Amsterdam', timezone: 'Europe/Amsterdam', icao: 'EHAM' },
  { slug: 'ankara', label: 'Ankara', timezone: 'Europe/Istanbul', icao: 'LTAC' },
  { slug: 'atlanta', label: 'Atlanta', timezone: 'America/New_York', icao: 'KATL' },
  { slug: 'beijing', label: 'Beijing', timezone: 'Asia/Shanghai', icao: 'ZBAA' },
  { slug: 'busan', label: 'Busan', timezone: 'Asia/Seoul', icao: 'RKPK' },
  { slug: 'chengdu', label: 'Chengdu', timezone: 'Asia/Shanghai', icao: 'ZUUU' },
  { slug: 'chicago', label: 'Chicago', timezone: 'America/Chicago', icao: 'KMDW' },
  { slug: 'dallas', label: 'Dallas', timezone: 'America/Chicago', icao: 'KDFW' },
  { slug: 'guangzhou', label: 'Guangzhou', timezone: 'Asia/Shanghai', icao: 'ZGGG' },
  { slug: 'helsinki', label: 'Helsinki', timezone: 'Europe/Helsinki', icao: 'EFHK' },
  { slug: 'hong-kong', label: 'Hong Kong', timezone: 'Asia/Hong_Kong', icao: 'VHHH' },
  { slug: 'istanbul', label: 'Istanbul', timezone: 'Europe/Istanbul', icao: 'LTFM' },
  { slug: 'jeddah', label: 'Jeddah', timezone: 'Asia/Riyadh', icao: 'OEJN' },
  { slug: 'karachi', label: 'Karachi', timezone: 'Asia/Karachi', icao: 'OPKC' },
  { slug: 'kuala-lumpur', label: 'Kuala Lumpur', timezone: 'Asia/Kuala_Lumpur', icao: 'WMKK' },
  { slug: 'london', label: 'London', timezone: 'Europe/London', icao: 'EGLC' },
  { slug: 'madrid', label: 'Madrid', timezone: 'Europe/Madrid', icao: 'LEMD' },
  { slug: 'miami', label: 'Miami', timezone: 'America/New_York', icao: 'KMIA' },
  { slug: 'munich', label: 'Munich', timezone: 'Europe/Berlin', icao: 'EDDM' },
  { slug: 'nyc', label: 'NYC', timezone: 'America/New_York', icao: 'KLGA' },
  { slug: 'paris', label: 'Paris', timezone: 'Europe/Paris', icao: 'LFPG' },
  { slug: 'qingdao', label: 'Qingdao', timezone: 'Asia/Shanghai', icao: 'ZSQD' },
  { slug: 'seoul', label: 'Seoul', timezone: 'Asia/Seoul', icao: 'RKSS' },
  { slug: 'shanghai', label: 'Shanghai', timezone: 'Asia/Shanghai', icao: 'ZSPD' },
  { slug: 'shenzhen', label: 'Shenzhen', timezone: 'Asia/Shanghai', icao: 'ZGSZ' },
  { slug: 'singapore', label: 'Singapore', timezone: 'Asia/Singapore', icao: 'WSSS' },
  { slug: 'taipei', label: 'Taipei', timezone: 'Asia/Taipei', icao: 'RCTP' },
  { slug: 'tokyo', label: 'Tokyo', timezone: 'Asia/Tokyo', icao: 'RJTT' },
  { slug: 'warsaw', label: 'Warsaw', timezone: 'Europe/Warsaw', icao: 'EPWA' },
  { slug: 'wellington', label: 'Wellington', timezone: 'Pacific/Auckland', icao: 'NZWN' },
];

export const WEATHER_CITY_SLUGS = new Set<string>(WEATHER_CITIES.map((c) => c.slug));

export function isWeatherCitySlug(slug: string): slug is WeatherCitySlug {
  return WEATHER_CITY_SLUGS.has(slug);
}

export function weatherCityTimezone(slug: string): string {
  return WEATHER_CITIES.find((c) => c.slug === slug)?.timezone ?? 'UTC';
}

export function weatherCityLabel(slug: string): string {
  const hit = WEATHER_CITIES.find((c) => c.slug === slug);
  if (hit) return hit.label;
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
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
