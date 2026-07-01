import type { WeatherCitySlug } from './weatherCities';

export const WEATHER_TEMP_ODDS_CITY_EVENT = 'polybot-weather-temp-odds-city';

export type WeatherTempOddsCityEventDetail = {
  city: WeatherCitySlug;
  linkSidebar: boolean;
};

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
