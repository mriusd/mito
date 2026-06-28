import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import { resolveLegPositionForToken } from '../../lib/sidebarMyPositions';
import { useSidebarOnchainGridWalletPositions } from '../../lib/sidebarOnchainTradesStore';
import { getGridBidAskPairSnapshot } from '../../hooks/useThrottledBidAskPair';
import {
  getBidAskGridFlushDigest,
  subscribeBidAskMarketLookupGridFlush,
} from '../../lib/bidAskMarketLookup';
import { useThrottledGridPositions } from '../../hooks/useThrottledGridWallet';
import type { Position } from '../../types';
import type { WSPosition } from '../../hooks/useOnchainTradesWS';

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

function yesChartEntryFrac(avgPrice: number, outcome: 'YES' | 'NO'): number | null {
  let f = avgPrice > 1 ? avgPrice / 100 : avgPrice;
  if (!Number.isFinite(f) || f <= 0) return null;
  if (outcome === 'NO') f = 1 - f;
  if (f <= 0 || f >= 1) return null;
  return f;
}

function marketEntryYesFrac(
  yesTokenId: string,
  noTokenId: string,
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
): { frac: number; outcome: 'YES' | 'NO' } | null {
  const yesPos = yesTokenId
    ? resolveLegPositionForToken(yesTokenId, positions, liveTradesSource, onchainWsPositions)
    : null;
  if (yesPos?.avgPrice) {
    const frac = yesChartEntryFrac(yesPos.avgPrice, 'YES');
    if (frac != null) return { frac, outcome: 'YES' };
  }
  const noPos = noTokenId
    ? resolveLegPositionForToken(noTokenId, positions, liveTradesSource, onchainWsPositions)
    : null;
  if (noPos?.avgPrice) {
    const frac = yesChartEntryFrac(noPos.avgPrice, 'NO');
    if (frac != null) return { frac, outcome: 'NO' };
  }
  return null;
}

function getMarketYesProb(market: Market): number | null {
  const tokenIds = market.clobTokenIds || [];
  const yesTokenId = tokenIds[0] || '';
  const noTokenId = tokenIds[1] || '';
  const ws = getGridBidAskPairSnapshot(yesTokenId, noTokenId);
  const lookup: Record<string, Market> = {};
  if (yesTokenId) lookup[yesTokenId] = (ws.yes as Market | undefined) ?? market;
  if (noTokenId && ws.no) lookup[noTokenId] = ws.no;
  const prob = outcomeMidOrOneSideProb(yesTokenId, lookup, {
    bestBid: market.bestBid,
    bestAsk: market.bestAsk,
  });
  if (prob == null || !Number.isFinite(prob)) return null;
  return Math.max(0, Math.min(1, prob));
}

type TempOddsBucket = {
  temp: string;
  label: string;
  market: Market;
  pct: number | null;
  entry: { frac: number; outcome: 'YES' | 'NO' } | null;
};

function buildTempOddsBuckets(
  buckets: { temp: string; label: string; market: Market }[],
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
): { entries: TempOddsBucket[]; maxPct: number } {
  const entries: TempOddsBucket[] = buckets.map(({ temp, label, market }) => {
    const yesTokenId = market.clobTokenIds?.[0] || '';
    const noTokenId = market.clobTokenIds?.[1] || '';
    return {
      temp,
      label,
      market,
      pct: getMarketYesProb(market),
      entry: marketEntryYesFrac(yesTokenId, noTokenId, positions, liveTradesSource, onchainWsPositions),
    };
  });
  const maxPct = Math.max(0.001, ...entries.map((e) => e.pct ?? 0));
  return { entries, maxPct };
}

function useTempOddsBuckets(
  buckets: { temp: string; label: string; market: Market }[],
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
) {
  const digest = useSyncExternalStore(
    subscribeBidAskMarketLookupGridFlush,
    getBidAskGridFlushDigest,
    getBidAskGridFlushDigest,
  );
  return useMemo(
    () => buildTempOddsBuckets(buckets, positions, liveTradesSource, onchainWsPositions),
    [buckets, positions, liveTradesSource, onchainWsPositions, digest],
  );
}

interface TempOddsBarProps {
  label: string;
  pct: number | null;
  maxPct: number;
  trackPx: number;
  barColor: string;
  selected: boolean;
  entry: { frac: number; outcome: 'YES' | 'NO' } | null;
  marketTitle: string;
  onClick: () => void;
  showProb?: boolean;
  showLabel?: boolean;
}

function TempOddsBar({
  label,
  pct,
  maxPct,
  trackPx,
  barColor,
  selected,
  entry,
  marketTitle,
  onClick,
  showProb = true,
  showLabel = true,
}: TempOddsBarProps) {
  const barPx = pct != null && maxPct > 0 ? Math.max(2, (pct / maxPct) * trackPx) : 0;
  const entryBottomPx =
    entry != null && maxPct > 0 ? Math.min(trackPx, Math.max(0, (entry.frac / maxPct) * trackPx)) : null;
  const entryTip =
    entry != null ? `Entry ${(entry.frac * 100).toFixed(1)}¢ (${entry.outcome})` : undefined;

  return (
    <button
      type="button"
      className={`no-drag flex flex-col items-center justify-end flex-1 min-w-0 h-full px-0.5 group ${selected ? 'ring-1 ring-white/40 rounded' : ''}`}
      onClick={onClick}
      title={[marketTitle, entryTip].filter(Boolean).join(' · ')}
    >
      {showProb ? (
        <span className="text-[9px] text-gray-400 mb-0.5 tabular-nums shrink-0 min-h-[12px] leading-none">
          {pct != null ? `${Math.round(pct * 100)}%` : '—'}
        </span>
      ) : null}
      <div className="relative w-full shrink-0 flex-1 min-h-0 flex items-end">
        <div className="relative w-full" style={{ height: trackPx }}>
          {barPx > 0 ? (
            <div
              className={`absolute bottom-0 left-0 right-0 rounded-t-sm transition-opacity group-hover:opacity-90 ${barColor}`}
              style={{ height: barPx }}
            />
          ) : null}
          {entryBottomPx != null ? (
            <div
              className="absolute left-0 right-0 h-[2px] z-10 pointer-events-none bg-white shadow-[0_0_2px_rgba(0,0,0,0.85)]"
              style={{ bottom: entryBottomPx }}
            />
          ) : null}
        </div>
      </div>
      {showLabel ? (
        <span className="text-[8px] text-gray-500 mt-1 truncate max-w-full leading-tight shrink-0 min-h-[10px]">
          {label}
        </span>
      ) : null}
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
  positions: Position[];
  liveTradesSource: string;
  onchainWsPositions: WSPosition[];
}

function TempOddsChart({
  title,
  titleColor,
  barColor,
  grid,
  dateCol,
  selectedMarketId,
  onBarClick,
  positions,
  liveTradesSource,
  onchainWsPositions,
}: TempOddsChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [trackPx, setTrackPx] = useState(0);

  const buckets = useMemo(() => {
    if (!grid || !dateCol) return [];
    return grid.temps
      .map((temp) => ({
        temp,
        label: compactTempBucketLabel(temp),
        market: grid.marketLookup[temp + '_' + dateCol.slug],
      }))
      .filter((b): b is { temp: string; label: string; market: Market } => !!b.market);
  }, [grid, dateCol]);

  const { entries, maxPct } = useTempOddsBuckets(
    buckets,
    positions,
    liveTradesSource,
    onchainWsPositions,
  );

  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => setTrackPx(Math.max(0, el.clientHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [buckets.length]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <span className={`text-xs font-bold ${titleColor} shrink-0 mb-2 block`}>{title}</span>
      <div className="flex flex-col flex-1 min-h-0 border border-gray-700/80 rounded-lg bg-gray-900/40 p-2">
        {entries.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-600 text-[10px]">No markets</div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 gap-1">
            <div className="flex shrink-0 gap-0.5 min-h-[12px]">
              {entries.map(({ temp, pct }) => (
                <div
                  key={`prob-${temp}`}
                  className="flex-1 min-w-0 text-center text-[9px] text-gray-400 tabular-nums leading-none"
                >
                  {pct != null ? `${Math.round(pct * 100)}%` : '—'}
                </div>
              ))}
            </div>
            <div ref={plotRef} className="flex-1 min-h-[40px] flex items-end gap-0.5">
              {trackPx > 0
                ? entries.map(({ temp, label, market, pct, entry }) => (
                    <TempOddsBar
                      key={temp}
                      label={label}
                      pct={pct}
                      maxPct={maxPct}
                      trackPx={trackPx}
                      barColor={barColor}
                      selected={selectedMarketId === market.id}
                      entry={entry}
                      marketTitle={market.groupItemTitle || label}
                      onClick={() => onBarClick(market)}
                      showProb={false}
                      showLabel={false}
                    />
                  ))
                : null}
            </div>
            <div className="flex shrink-0 gap-0.5 min-h-[10px]">
              {entries.map(({ temp, label }) => (
                <div
                  key={`lbl-${temp}`}
                  className="flex-1 min-w-0 text-center text-[8px] text-gray-500 truncate leading-tight"
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const positions = useThrottledGridPositions(2000);
  const onchainWsPositions = useSidebarOnchainGridWalletPositions();

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
    setSelectedDateKey((prev) => (prev === key ? prev : key));
    localStorage.setItem(`polybot-weather-temp-bars-date-${panelId}`, key);
  }, [selectedDateCol, panelId]);

  const selectDate = useCallback(
    (d: DateCol) => {
      const key = dateStorageKey(d.endDate);
      setSelectedDateKey(key);
      localStorage.setItem(`polybot-weather-temp-bars-date-${panelId}`, key);
    },
    [panelId],
  );

  const highDateCol = useMemo(
    () => (highGrid && selectedDateCol ? findDateColForEndDate(highGrid.dates, selectedDateCol.endDate) : undefined),
    [highGrid, selectedDateCol],
  );
  const lowDateCol = useMemo(
    () => (lowGrid && selectedDateCol ? findDateColForEndDate(lowGrid.dates, selectedDateCol.endDate) : undefined),
    [lowGrid, selectedDateCol],
  );

  const handleBarClick = useCallback(
    (market: Market) => {
      setSelectedMarket(market);
      setSidebarOutcome('YES');
      setSidebarOpen(true);
    },
    [setSelectedMarket, setSidebarOpen, setSidebarOutcome],
  );

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 h-full flex flex-col min-h-0">
      <div className="panel-header shrink-0 mb-2 space-y-1.5">
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

        {dateColumns.length > 0 && (
          <div className="no-drag flex flex-wrap gap-1">
            {dateColumns.map((d) => {
              const key = dateStorageKey(d.endDate);
              const selected =
                !!selectedDateCol && key === dateStorageKey(selectedDateCol.endDate);
              const isEnded = d.expiryEndDate && new Date(d.expiryEndDate).getTime() < Date.now();
              const dt = new Date(d.endDate);
              const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectDate(d)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold tabular-nums border transition-colors ${
                    selected
                      ? 'bg-sky-600/50 border-sky-500 text-white'
                      : 'bg-gray-800/80 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                  } ${isEnded ? 'opacity-50' : ''} ${isWeekend && !selected ? 'text-purple-400' : ''}`}
                >
                  {formatDateHeader(d.endDate)}
                </button>
              );
            })}
          </div>
        )}
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
              positions={positions}
              liveTradesSource={liveTradesSource}
              onchainWsPositions={onchainWsPositions}
            />
            <TempOddsChart
              title="High Temp"
              titleColor="text-red-400"
              barColor="bg-red-400/90"
              grid={highGrid}
              dateCol={highDateCol}
              selectedMarketId={selectedMarketId}
              onBarClick={handleBarClick}
              positions={positions}
              liveTradesSource={liveTradesSource}
              onchainWsPositions={onchainWsPositions}
            />
          </>
        )}
      </div>
    </div>
  );
}

export const TemperatureBarChartPanel = memo(TemperatureBarChartPanelInner);
