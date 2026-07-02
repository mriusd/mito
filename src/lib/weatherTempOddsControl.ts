import type { WeatherCitySlug } from './weatherCities';

export const WEATHER_TEMP_ODDS_CITY_EVENT = 'polybot-weather-temp-odds-city';
export const WEATHER_TEMP_ODDS_DATE_EVENT = 'polybot-weather-temp-odds-date';

export type WeatherTempOddsCityEventDetail = {
  city: WeatherCitySlug;
  linkSidebar: boolean;
};

let lastTempOddsDateIso: string | null = null;

export function getTempOddsSelectedDate(): string | null {
  return lastTempOddsDateIso;
}

export function selectTempOddsDate(dateIso: string | null) {
  if (lastTempOddsDateIso === dateIso) return;
  lastTempOddsDateIso = dateIso;
  window.dispatchEvent(
    new CustomEvent<string | null>(WEATHER_TEMP_ODDS_DATE_EVENT, { detail: dateIso }),
  );
}

export function onTempOddsDateSelect(handler: (dateIso: string | null) => void): () => void {
  const listener = (ev: Event) => {
    handler((ev as CustomEvent<string | null>).detail ?? null);
  };
  window.addEventListener(WEATHER_TEMP_ODDS_DATE_EVENT, listener);
  return () => window.removeEventListener(WEATHER_TEMP_ODDS_DATE_EVENT, listener);
}

export function selectTempOddsCity(city: WeatherCitySlug, options?: { linkSidebar?: boolean }) {
  window.dispatchEvent(
    new CustomEvent<WeatherTempOddsCityEventDetail>(WEATHER_TEMP_ODDS_CITY_EVENT, {
      detail: { city, linkSidebar: options?.linkSidebar ?? false },
    }),
  );
}

export function onTempOddsCitySelect(handler: (detail: WeatherTempOddsCityEventDetail) => void): () => void {
  const listener = (ev: Event) => {
    const detail = (ev as CustomEvent<WeatherTempOddsCityEventDetail>).detail;
    if (!detail?.city) return;
    handler(detail);
  };
  window.addEventListener(WEATHER_TEMP_ODDS_CITY_EVENT, listener);
  return () => window.removeEventListener(WEATHER_TEMP_ODDS_CITY_EVENT, listener);
}
