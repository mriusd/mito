import { useSyncExternalStore } from 'react';
import type { WeatherCityMeta } from './weatherCities';

const STORAGE_KEY = 'polybot-weather-city-favorites';

const listeners = new Set<() => void>();
let favoritesArr: string[] = loadFavoritesFromStorage();

function loadFavoritesFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0))].sort();
  } catch {
    return [];
  }
}

function notify(): void {
  for (const l of listeners) l();
}

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favoritesArr));
}

export function subscribeWeatherCityFavorites(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getWeatherCityFavoritesSnapshot(): string[] {
  return favoritesArr;
}

export function isWeatherCityFavorite(slug: string): boolean {
  return favoritesArr.includes(slug.trim().toLowerCase());
}

export function toggleWeatherCityFavorite(slug: string): void {
  const s = slug.trim().toLowerCase();
  if (!s) return;
  if (favoritesArr.includes(s)) {
    favoritesArr = favoritesArr.filter((x) => x !== s);
  } else {
    favoritesArr = [...favoritesArr, s].sort();
  }
  persist();
  notify();
}

export function sortWeatherCityOptions(
  cities: WeatherCityMeta[],
  favorites: readonly string[],
): WeatherCityMeta[] {
  const favSet = new Set(favorites);
  const starred: WeatherCityMeta[] = [];
  const rest: WeatherCityMeta[] = [];
  for (const c of cities) {
    if (favSet.has(c.slug)) starred.push(c);
    else rest.push(c);
  }
  starred.sort((a, b) => a.label.localeCompare(b.label));
  rest.sort((a, b) => a.label.localeCompare(b.label));
  return [...starred, ...rest];
}

export function useWeatherCityFavorites(): string[] {
  return useSyncExternalStore(
    subscribeWeatherCityFavorites,
    getWeatherCityFavoritesSnapshot,
    getWeatherCityFavoritesSnapshot,
  );
}
