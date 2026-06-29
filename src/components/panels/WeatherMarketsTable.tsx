import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { formatDateShort, normalizeClobTokenId } from '../../utils/format';
import { resolveMarketExpiryEndDate } from '../../lib/weatherMarketExpiry';
import { buildTableData, filterWeatherMarkets, type WeatherGridData, type WeatherMetric } from '../../lib/weatherMarketsGrid';
import type { Market, Order, WeatherCitySlug } from '../../types';
import { WEATHER_CITIES } from '../../types';
import { GridMarketCell } from './GridMarketCell';
import {
  useGridPositionLookup,
  useThrottledGridOrders,
} from '../../hooks/useThrottledGridWallet';
import { polymarketSiteUrl } from '../../lib/polymarketSiteUrl';

const EMPTY_MARKETS: Market[] = [];
const EMPTY_ORDERS: Order[] = [];
const CITY_SLUGS = new Set<string>(WEATHER_CITIES.map((c) => c.slug));
const METRICS: WeatherMetric[] = ['low', 'high'];

interface WeatherMarketsTableProps {
  panelId: string;
  initialCity?: WeatherCitySlug;
}

function WeatherGridTable({
  metric,
  gridData,
  selectedMarketId,
  positionLookup,
  orderLookup,
  onCellClick,
}: {
  metric: WeatherMetric;
  gridData: WeatherGridData | null;
  selectedMarketId: string;
  positionLookup: ReturnType<typeof useGridPositionLookup>;
  orderLookup: Record<string, Order[]>;
  onCellClick: (market: Market, outcome?: 'YES' | 'NO') => void;
}) {
  const isHigh = metric === 'high';
  const titleColor = isHigh ? 'text-red-400' : 'text-sky-400';
  const borderClass = isHigh ? 'border-red-500/40' : 'border-sky-500/40';
  const tempColHeading = isHigh ? 'High Temp' : 'Low Temp';

  if (!gridData || gridData.dates.length === 0 || gridData.temps.length === 0) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="text-gray-500 text-center py-2 text-xs">No active markets</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className={`overflow-x-auto overflow-y-auto min-h-0 flex-1 border rounded ${borderClass}`}>
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-20 bg-gray-900">
            <tr>
              <th className={`sticky left-0 bg-gray-900 z-30 px-1 py-1 text-left ${titleColor} font-bold border-b border-gray-700 text-[10px]`}>
                {tempColHeading}
              </th>
              {gridData.dates.map((d) => {
                const dt = new Date(d.endDate);
                const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
                const isEnded = d.expiryEndDate && new Date(d.expiryEndDate).getTime() < Date.now();
                return (
                  <th
                    key={d.slug}
                    className={`px-1 py-1 text-center border-b border-gray-700 min-w-[70px] bg-gray-900 ${isEnded ? 'opacity-50' : ''} ${isWeekend ? 'bg-purple-900/20' : ''}`}
                  >
                    <a
                      href={polymarketSiteUrl(`event/${d.slug}`)}
                      target="_blank"
                      rel="noreferrer"
                      className="block hover:bg-gray-800/50 rounded p-0.5 transition"
                    >
                      <div className={`font-bold ${isWeekend ? 'text-purple-400' : 'text-white'} hover:text-blue-400 text-[10px]`}>
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dt.getDay()]} {formatDateShort(d.endDate)}
                      </div>
                    </a>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {gridData.temps.map((tempStr) => (
              <tr key={tempStr} className="hover:bg-gray-800/50">
                <td className={`sticky left-0 bg-gray-900 z-10 px-1 py-0.5 text-[10px] font-bold ${titleColor} border-b border-gray-700/50 whitespace-nowrap`}>
                  {tempStr}
                </td>
                {gridData.dates.map((d) => {
                  const market = gridData.marketLookup[tempStr + '_' + d.slug];
                  const dateEnded = d.expiryEndDate && new Date(d.expiryEndDate).getTime() < Date.now();
                  const dt = new Date(d.endDate);
                  const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;

                  if (!market) {
                    return (
                      <td
                        key={d.slug}
                        className={`text-center px-1 py-0.5 border-b border-gray-700/50 text-gray-600 text-[10px] ${dateEnded ? 'opacity-50' : ''} ${isWeekend ? 'bg-purple-900/20' : ''}`}
                      >
                        -
                      </td>
                    );
                  }

                  const tokenIds = market.clobTokenIds || [];
                  const yesTokenId = tokenIds[0] || '';
                  const noTokenId = tokenIds[1] || '';
                  const yesPos = yesTokenId ? positionLookup[normalizeClobTokenId(yesTokenId)] : undefined;
                  const noPos = noTokenId ? positionLookup[normalizeClobTokenId(noTokenId)] : undefined;

                  return (
                    <GridMarketCell
                      key={d.slug}
                      market={market}
                      asset="BTC"
                      endDate={resolveMarketExpiryEndDate(market, d.expiryEndDate || d.endDate)}
                      deltaPriceStr=""
                      isClosed={!!(market.closed || dateEnded)}
                      isWeekend={isWeekend}
                      variant="between"
                      signalsOnGrid={false}
                      isSelected={selectedMarketId === market.id}
                      adjVol={0.6}
                      bsTimeOffsetHours={0}
                      yesPosSize={yesPos?.size}
                      noPosSize={noPos?.size}
                      yesOrders={orderLookup[normalizeClobTokenId(yesTokenId)] ?? EMPTY_ORDERS}
                      noOrders={orderLookup[normalizeClobTokenId(noTokenId)] ?? EMPTY_ORDERS}
                      onCellClick={onCellClick}
                      skipDeltaBg
                      cellPyClass="py-1.5"
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WeatherMarketsTableInner({ panelId, initialCity = 'nyc' }: WeatherMarketsTableProps) {
  const [city, setCity] = useState<WeatherCitySlug>(() => {
    const saved = localStorage.getItem(`polybot-weather-city-${panelId}`);
    if (saved && CITY_SLUGS.has(saved)) return saved as WeatherCitySlug;
    return initialCity;
  });
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [pastFilterTick, setPastFilterTick] = useState(0);

  const cityMeta = WEATHER_CITIES.find((c) => c.slug === city) ?? WEATHER_CITIES[0];
  const allMarkets = useAppStore((s) => s.weatherMarkets[city] ?? EMPTY_MARKETS);
  const highMarkets = useMemo(() => filterWeatherMarkets(allMarkets, 'high'), [allMarkets]);
  const lowMarkets = useMemo(() => filterWeatherMarkets(allMarkets, 'low'), [allMarkets]);
  const showPast = useAppStore((s) => s.showPast);
  const setShowPast = useAppStore((s) => s.setShowPast);
  const positionLookup = useGridPositionLookup(2000);
  const orders = useThrottledGridOrders(2000);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const selectedMarketId = useAppStore((s) => s.selectedMarket?.id ?? '');

  useEffect(() => {
    if (showPast) return;
    const id = window.setInterval(() => setPastFilterTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [showPast]);

  const handleCellClick = useCallback(
    (market: Market, outcome: 'YES' | 'NO' = 'YES') => {
      setSelectedMarket(market);
      setSidebarOutcome(outcome);
      setSidebarOpen(true);
    },
    [setSelectedMarket, setSidebarOpen, setSidebarOutcome],
  );

  const orderLookup = useMemo(() => {
    const lookup: Record<string, typeof orders> = {};
    for (const ord of orders) {
      const tid = ord.asset_id || ord.token_id || '';
      if (!tid) continue;
      const key = normalizeClobTokenId(tid);
      if (!lookup[key]) lookup[key] = [];
      lookup[key].push(ord);
    }
    return lookup;
  }, [orders]);

  const gridByMetric = useMemo(() => {
    const out: Record<WeatherMetric, WeatherGridData | null> = { high: null, low: null };
    for (const m of METRICS) {
      const filtered = m === 'high' ? highMarkets : lowMarkets;
      out[m] = filtered.length > 0 ? buildTableData(filtered, showPast) : null;
    }
    return out;
  }, [highMarkets, lowMarkets, showPast, pastFilterTick]);

  const titleColor = 'text-sky-400';
  const hasAnyMarkets = highMarkets.length > 0 || lowMarkets.length > 0;

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 h-full flex flex-col min-h-0">
      <div className="panel-header shrink-0 cursor-grab">
        <h3 className={`text-sm font-bold mb-2 flex items-center gap-1 flex-wrap ${titleColor}`}>
          <span
            className="relative no-drag inline-flex items-center cursor-pointer select-none"
            onClick={() => setCityDropdownOpen((v) => !v)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {cityMeta.label}
            <svg className="w-3 h-3 ml-0.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {cityDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[120px] max-h-48 overflow-y-auto">
                {WEATHER_CITIES.map((c) => (
                  <div
                    key={c.slug}
                    className={`px-3 py-1 text-xs font-bold hover:bg-gray-700 cursor-pointer ${c.slug === city ? 'text-white bg-gray-700' : 'text-gray-300'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCity(c.slug);
                      localStorage.setItem(`polybot-weather-city-${panelId}`, c.slug);
                      setCityDropdownOpen(false);
                    }}
                  >
                    {c.label}
                  </div>
                ))}
              </div>
            )}
          </span>
          <label className="no-drag inline-flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer ml-1 font-normal" onMouseDown={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={showPast}
              onChange={(e) => setShowPast(e.target.checked)}
              className="cursor-pointer w-3 h-3"
            />
            Past
          </label>
        </h3>
      </div>

      <div className="panel-body flex-1 min-h-0 flex flex-row gap-2 overflow-hidden">
        {!hasAnyMarkets ? (
          <div className="text-gray-500 text-center py-2 text-xs w-full">No weather markets</div>
        ) : (
          METRICS.map((m) => (
            <WeatherGridTable
              key={m}
              metric={m}
              gridData={gridByMetric[m]}
              selectedMarketId={selectedMarketId}
              positionLookup={positionLookup}
              orderLookup={orderLookup}
              onCellClick={handleCellClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

export const WeatherMarketsTable = memo(WeatherMarketsTableInner);
