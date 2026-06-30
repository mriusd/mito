import { Star } from 'lucide-react';
import type { WeatherCitySlug } from '../types';
import type { WeatherCityMeta } from '../lib/weatherCities';
import { isWeatherCityFavorite, toggleWeatherCityFavorite } from '../lib/weatherCityFavorites';

type WeatherCityMenuProps = {
  cities: WeatherCityMeta[];
  selectedSlug: string;
  onSelect: (slug: WeatherCitySlug) => void;
  className?: string;
  /** First starred city index — renders divider after last starred row when set. */
  starredCount?: number;
};

export function WeatherCityMenu({
  cities,
  selectedSlug,
  onSelect,
  className,
  starredCount = 0,
}: WeatherCityMenuProps) {
  return (
    <div className={className}>
      {cities.map((c, i) => {
        const selected = c.slug === selectedSlug;
        const starred = isWeatherCityFavorite(c.slug);
        const showDivider = starredCount > 0 && i === starredCount - 1 && i < cities.length - 1;
        return (
          <div key={c.slug}>
            <div
              className={`flex items-center gap-0.5 hover:bg-gray-700 ${selected ? 'bg-gray-700' : ''}`}
            >
              <button
                type="button"
                className="no-drag shrink-0 px-1.5 py-1 text-gray-500 hover:text-yellow-300"
                title={starred ? 'Remove favourite' : 'Favourite city'}
                aria-label={starred ? `Unfavourite ${c.label}` : `Favourite ${c.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  toggleWeatherCityFavorite(c.slug);
                }}
              >
                <Star
                  className={`h-3 w-3 ${starred ? 'fill-yellow-400 text-yellow-400' : ''}`}
                  strokeWidth={2}
                />
              </button>
              <button
                type="button"
                className={`no-drag min-w-0 flex-1 cursor-pointer py-1 pr-2 text-left text-xs font-bold ${selected ? 'text-white' : 'text-gray-300'}`}
                onClick={() => onSelect(c.slug)}
              >
                {c.label}
              </button>
            </div>
            {showDivider ? <div className="mx-2 border-b border-gray-600/80" aria-hidden /> : null}
          </div>
        );
      })}
    </div>
  );
}
