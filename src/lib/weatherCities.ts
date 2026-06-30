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
  { slug: 'austin', label: 'Austin', timezone: 'America/Chicago', icao: 'KAUS' },
  { slug: 'beijing', label: 'Beijing', timezone: 'Asia/Shanghai', icao: 'ZBAA' },
  { slug: 'buenos-aires', label: 'Buenos Aires', timezone: 'America/Argentina/Buenos_Aires', icao: 'SABE' },
  { slug: 'busan', label: 'Busan', timezone: 'Asia/Seoul', icao: 'RKPK' },
  { slug: 'cape-town', label: 'Cape Town', timezone: 'Africa/Johannesburg', icao: 'FACT' },
  { slug: 'chengdu', label: 'Chengdu', timezone: 'Asia/Shanghai', icao: 'ZUUU' },
  { slug: 'chicago', label: 'Chicago', timezone: 'America/Chicago', icao: 'KMDW' },
  { slug: 'chongqing', label: 'Chongqing', timezone: 'Asia/Shanghai', icao: 'ZUCK' },
  { slug: 'dallas', label: 'Dallas', timezone: 'America/Chicago', icao: 'KDFW' },
  { slug: 'denver', label: 'Denver', timezone: 'America/Denver', icao: 'KDEN' },
  { slug: 'guangzhou', label: 'Guangzhou', timezone: 'Asia/Shanghai', icao: 'ZGGG' },
  { slug: 'helsinki', label: 'Helsinki', timezone: 'Europe/Helsinki', icao: 'EFHK' },
  { slug: 'hong-kong', label: 'Hong Kong', timezone: 'Asia/Hong_Kong', icao: 'VHHH' },
  { slug: 'houston', label: 'Houston', timezone: 'America/Chicago', icao: 'KIAH' },
  { slug: 'istanbul', label: 'Istanbul', timezone: 'Europe/Istanbul', icao: 'LTFM' },
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
  { slug: 'milan', label: 'Milan', timezone: 'Europe/Rome', icao: 'LIML' },
  { slug: 'moscow', label: 'Moscow', timezone: 'Europe/Moscow', icao: 'UUWW' },
  { slug: 'munich', label: 'Munich', timezone: 'Europe/Berlin', icao: 'EDDM' },
  { slug: 'nyc', label: 'NYC', timezone: 'America/New_York', icao: 'KLGA' },
  { slug: 'panama-city', label: 'Panama City', timezone: 'America/Panama', icao: 'MPTO' },
  { slug: 'paris', label: 'Paris', timezone: 'Europe/Paris', icao: 'LFPG' },
  { slug: 'qingdao', label: 'Qingdao', timezone: 'Asia/Shanghai', icao: 'ZSQD' },
  { slug: 'san-francisco', label: 'San Francisco', timezone: 'America/Los_Angeles', icao: 'KSFO' },
  { slug: 'sao-paulo', label: 'Sao Paulo', timezone: 'America/Sao_Paulo', icao: 'SBGR' },
  { slug: 'seattle', label: 'Seattle', timezone: 'America/Los_Angeles', icao: 'KSEA' },
  { slug: 'seoul', label: 'Seoul', timezone: 'Asia/Seoul', icao: 'RKSS' },
  { slug: 'shanghai', label: 'Shanghai', timezone: 'Asia/Shanghai', icao: 'ZSPD' },
  { slug: 'shenzhen', label: 'Shenzhen', timezone: 'Asia/Shanghai', icao: 'ZGSZ' },
  { slug: 'singapore', label: 'Singapore', timezone: 'Asia/Singapore', icao: 'WSSS' },
  { slug: 'taipei', label: 'Taipei', timezone: 'Asia/Taipei', icao: 'RCTP' },
  { slug: 'tel-aviv', label: 'Tel Aviv', timezone: 'Asia/Jerusalem', icao: 'LLBG' },
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

export function weatherCityLabel(slug: string): string {
  const hit = WEATHER_CITIES.find((c) => c.slug === slug);
  if (hit) return hit.label;
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function weatherCityWundergroundHourlyUrl(slug: string): string | null {
  const icao = WEATHER_CITIES.find((c) => c.slug === slug.trim().toLowerCase())?.icao?.trim();
  if (!icao) return null;
  return `https://www.wunderground.com/hourly/${icao.toUpperCase()}`;
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
