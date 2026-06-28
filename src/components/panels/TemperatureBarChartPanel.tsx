import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { formatDateShort } from '../../utils/format';
import type { Market, WeatherCitySlug } from '../../types';
import { WEATHER_CITIES } from '../../types';
import {
  buildTableData,
  compactTempBucketLabel,
  filterWeatherMarkets,
  findDateColForEndDate,
  mergeWeatherDateColumns,
  type DateCol,
  type WeatherGridData,
} from '../../lib/weatherMarketsGrid';
import { outcomeMidOrOneSideProb } from '../../lib/outcomeQuote';
import { useThrottledBidAskPair } from '../../hooks/useThrottledBidAskPair';

const EMPTY_MARKETS: Market[] = [];
const CITY_SLUGS = new Set<string>(WEATHER_CITIES.map((c) => c.slug));
const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

function formatDateHeader(endDate: string): string {
  const dt = new Date(endDate);
  if (!Number.isFinite(dt.getTime())) return '';
  return `${DAY_LABELS[dt.getDay()]} ${formatDateShort(endDate)}`;
}

function dateStorageKey(endDate: string): string {
  const t = new Date(endDate).getTime();
  return Number.isFinite(t) ? String(t) : endDate;
}

interface TempOddsBarProps {
  market: Market;
  tempLabel: string;
  barColor: string;
  selected: boolean;
  onClick: (market: Market) => void;
}

function TempOddsBar({ market, tempLabel, barColor, selected, onClick }: TempOddsBarProps) {
  const tokenIds = market.clobTokenIds || [];
  const yesTokenId = tokenIds[0] || '';
  const noTokenId = tokenIds[1] || '';
  const ws = useThrottledBidAskPair(yesTokenId, noTokenId);

  const lookup = useMemo(() => {
    const o: Record<string, Market> = {};
    if (yesTokenId) o[yesTokenId] = (ws.yes as Market | undefined) ?? market;
    if (noTokenId && ws.no) o[noTokenId] = ws.no;
    return o;
  }, [yesTokenId, noTokenId, ws.yes, ws.no, market]);

  const prob = outcomeMidOrOneSideProb(yesTokenId, lookup, {
    bestBid: market.bestBid,
    bestAsk: market.bestAsk,
  });
  const pct = prob != null && Number.isFinite(prob) ? Math.max(0, Math.min(1, prob)) : 0;
  const barH = Math.max(2, pct * 100);

  return (
    <button
      type="button"
      className={`no-drag flex flex-col items-center justify-end flex-1 min-w-0 h-full px-0.5 group ${selected ? 'ring-1 ring-white/40 rounded' : ''}`}
      onClick={() => onClick(market)}
      title={market.groupItemTitle || tempLabel}
    >
      <span className="text-[9px] text-gray-400 mb-0.5 tabular-nums">
        {prob != null ? pct.toFixed(2) : '—'}
      </span>
      <div className="w-full flex-1 min-h-[40px] flex items-end">
        <div
          className={`w-full rounded-t-sm transition-opacity group-hover:opacity-90 ${barColor}`}
          style={{ height: `${barH}%`, minHeight: prob != null ? 2 : 0 }}
        />
      </div>
      <span className="text-[8px] text-gray-500 mt-1 truncate max-w-full leading-tight">{tempLabel}</span>
    </button>
  );
}

interface TempOddsChartProps {
  title: string;
  titleColor: string;
  barColor: string;
  grid: WeatherGridData | null;
  dateCol: DateCol | undefined;
  selectedMarketId: string;
  onBarClick: (market: Market) => void;
}

function TempOddsChart({
  title,
  titleColor,
  barColor,
  grid,
  dateCol,
  selectedMarketId,
  onBarClick,
}: TempOddsChartProps) {
  const buckets = useMemo(() => {
    if (!grid || !dateCol) return [];
    return grid.temps
      .map((temp) => ({
        temp,
        label: compactTempBucketLabel(temp),
        market: grid.marketLookup[temp + '_' + dateCol.slug],
      }))
      .filter((b) => b.market);
  }, [grid, dateCol]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0 border border-gray-700/80 rounded-lg bg-gray-900/40 p-2">
      <div className="flex items-center justify-between shrink-0 mb-2">
        <span className={`text-xs font-bold ${titleColor}`}>{title}</span>
        <span className="text-[9px] text-gray-500 uppercase tracking-wide">Data viewer</span>
      </div>
      {buckets.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-[10px]">No markets</div>
      ) : (
        <div className="flex-1 min-h-0 flex items-stretch gap-0.5">
          {buckets.map(({ temp, label, market }) => (
            <TempOddsBar
              key={temp}
              market={market!}
              tempLabel={label}
              barColor={barColor}
              selected={selectedMarketId === market!.id}
              onClick={onBarClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TemperatureBarChartPanelProps {
  panelId: string;
  initialCity?: WeatherCitySlug;
}

function TemperatureBarChartPanelInner({ panelId, initialCity = 'london' }: TemperatureBarChartPanelProps) {
  const [city, setCity] = useState<WeatherCitySlug>(() => {
    const saved = localStorage.getItem(`polybot-weather-temp-bars-city-${panelId}`);
    if (saved && CITY_SLUGS.has(saved)) return saved as WeatherCitySlug;
    return initialCity;
  });
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(() =>
    localStorage.getItem(`polybot-weather-temp-bars-date-${panelId}`),
  );
  const [pastFilterTick, setPastFilterTick] = useState(0);

  const cityMeta = WEATHER_CITIES.find((c) => c.slug === city) ?? WEATHER_CITIES[0];
  const allMarkets = useAppStore((s) => s.weatherMarkets[city] ?? EMPTY_MARKETS);
  const highMarkets = useMemo(() => filterWeatherMarkets(allMarkets, 'high'), [allMarkets]);
  const lowMarkets = useMemo(() => filterWeatherMarkets(allMarkets, 'low'), [allMarkets]);
  const showPast = useAppStore((s) => s.showPast);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const selectedMarketId = useAppStore((s) => s.selectedMarket?.id ?? '');

  useEffect(() => {
    if (showPast) return;
    const id = window.setInterval(() => setPastFilterTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [showPast]);

  const highGrid = useMemo(
    () => (highMarkets.length > 0 ? buildTableData(highMarkets, showPast) : null),
    [highMarkets, showPast, pastFilterTick],
  );
  const lowGrid = useMemo(
    () => (lowMarkets.length > 0 ? buildTableData(lowMarkets, showPast) : null),
    [lowMarkets, showPast, pastFilterTick],
  );

  const dateColumns = useMemo(() => {
    if (!highGrid && !lowGrid) return [];
    return mergeWeatherDateColumns(highGrid?.dates ?? [], lowGrid?.dates ?? []);
  }, [highGrid, lowGrid]);

  const selectedDateCol = useMemo(() => {
    if (dateColumns.length === 0) return undefined;
    if (selectedDateKey) {
      const hit = dateColumns.find((d) => dateStorageKey(d.endDate) === selectedDateKey);
      if (hit) return hit;
    }
    return dateColumns[0];
  }, [dateColumns, selectedDateKey]);

  useEffect(() => {
    if (!selectedDateCol) return;
    const key = dateStorageKey(selectedDateCol.endDate);
    setSelectedDateKey(key);
    localStorage.setItem(`polybot-weather-temp-bars-date-${panelId}`, key);
  }, [selectedDateCol, panelId]);

  const selectedDateIdx = useMemo(() => {
    if (!selectedDateCol) return -1;
    const key = dateStorageKey(selectedDateCol.endDate);
    return dateColumns.findIndex((d) => dateStorageKey(d.endDate) === key);
  }, [dateColumns, selectedDateCol]);

  const highDateCol = useMemo(
    () => (highGrid && selectedDateCol ? findDateColForEndDate(highGrid.dates, selectedDateCol.endDate) : undefined),
    [highGrid, selectedDateCol],
  );
  const lowDateCol = useMemo(
    () => (lowGrid && selectedDateCol ? findDateColForEndDate(lowGrid.dates, selectedDateCol.endDate) : undefined),
    [lowGrid, selectedDateCol],
  );

  const shiftDate = useCallback(
    (delta: number) => {
      if (dateColumns.length === 0) return;
      const idx = selectedDateIdx >= 0 ? selectedDateIdx : 0;
      const next = dateColumns[(idx + delta + dateColumns.length) % dateColumns.length];
      const key = dateStorageKey(next.endDate);
      setSelectedDateKey(key);
      localStorage.setItem(`polybot-weather-temp-bars-date-${panelId}`, key);
    },
    [dateColumns, selectedDateIdx, panelId],
  );

  const handleBarClick = useCallback(
    (market: Market) => {
      setSelectedMarket(market);
      setSidebarOutcome('YES');
      setSidebarOpen(true);
    },
    [setSelectedMarket, setSidebarOpen, setSidebarOutcome],
  );

  const dateEnded =
    selectedDateCol?.expiryEndDate && new Date(selectedDateCol.expiryEndDate).getTime() < Date.now();

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 h-full flex flex-col min-h-0">
      <div className="panel-header shrink-0 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="relative no-drag inline-flex items-center cursor-pointer select-none text-sm font-bold text-sky-400"
            onClick={() => setCityDropdownOpen((v) => !v)}
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
                      localStorage.setItem(`polybot-weather-temp-bars-city-${panelId}`, c.slug);
                      setCityDropdownOpen(false);
                    }}
                  >
                    {c.label}
                  </div>
                ))}
              </div>
            )}
          </span>

          {dateColumns.length > 0 && selectedDateCol && (
            <div className="no-drag inline-flex items-center gap-1 text-[10px]">
              <button
                type="button"
                className="px-1.5 py-0.5 rounded bg-gray-700/80 text-gray-300 hover:bg-gray-600 disabled:opacity-40"
                disabled={dateColumns.length <= 1}
                onClick={() => shiftDate(-1)}
                aria-label="Previous date"
              >
                ‹
              </button>
              <span className={`font-bold tabular-nums px-1 ${dateEnded ? 'text-gray-500' : 'text-white'}`}>
                {formatDateHeader(selectedDateCol.endDate)}
              </span>
              <button
                type="button"
                className="px-1.5 py-0.5 rounded bg-gray-700/80 text-gray-300 hover:bg-gray-600 disabled:opacity-40"
                disabled={dateColumns.length <= 1}
                onClick={() => shiftDate(1)}
                aria-label="Next date"
              >
                ›
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="panel-body flex-1 min-h-0 flex gap-2">
        {allMarkets.length === 0 ? (
          <div className="text-gray-500 text-center py-2 text-xs w-full">No weather markets</div>
        ) : dateColumns.length === 0 ? (
          <div className="text-gray-500 text-center py-2 text-xs w-full">No active markets</div>
        ) : (
          <>
            <TempOddsChart
              title="Low Temp"
              titleColor="text-cyan-400"
              barColor="bg-cyan-400/90"
              grid={lowGrid}
              dateCol={lowDateCol}
              selectedMarketId={selectedMarketId}
              onBarClick={handleBarClick}
            />
            <TempOddsChart
              title="High Temp"
              titleColor="text-orange-400"
              barColor="bg-orange-400/90"
              grid={highGrid}
              dateCol={highDateCol}
              selectedMarketId={selectedMarketId}
              onBarClick={handleBarClick}
            />
          </>
        )}
      </div>
    </div>
  );
}

export const TemperatureBarChartPanel = memo(TemperatureBarChartPanelInner);
