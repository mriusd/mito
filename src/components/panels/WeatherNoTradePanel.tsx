import { memo, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useMarketLookupSnapshot } from '../../hooks/useMarketLookupSnapshot';
import { subscribeBidAskMarketLookupGridFlush, getBidAskGridFlushDigest } from '../../lib/bidAskMarketLookup';
import { setChartBidAskExtraTokens } from '../../lib/chartWsShared';
import {
  findWeatherNoTradeOpps,
  weatherNoTradeTokenIds,
  type NoTradeQuoteMode,
  type WeatherNoTradeOpp,
} from '../../lib/weatherNoTrade';
import type { WeatherMetric } from '../../lib/weatherMarketsGrid';
import { isWeatherCitySlug } from '../../lib/weatherCities';
import {
  selectTempOddsCity,
  selectTempOddsDate,
  selectTempOddsMetric,
} from '../../lib/weatherTempOddsControl';
import { useSyncExternalStore } from 'react';

const PROFIT_LS = 'polybot-weather-no-trade-profit';
const MODE_LS = 'polybot-weather-no-trade-mode';
const METRIC_LS = 'polybot-weather-no-trade-metric';
const MAX_LEGS_LS = 'polybot-weather-no-trade-max-legs';
const SORT_LS = 'polybot-weather-no-trade-sort';
const DEFAULT_MAX_LEGS = 6;

type NoTradeSort = 'profit' | 'date';

function readProfit(): number {
  try {
    const v = localStorage.getItem(PROFIT_LS);
    if (v == null || v === '') return 100;
    const n = parseFloat(v);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    /* ignore */
  }
  return 100;
}

function readMode(): NoTradeQuoteMode {
  try {
    const v = localStorage.getItem(MODE_LS);
    if (v === 'bid' || v === 'mid' || v === 'ask') return v;
  } catch {
    /* ignore */
  }
  return 'ask';
}

function readMetric(): WeatherMetric | 'both' {
  try {
    const v = localStorage.getItem(METRIC_LS);
    if (v === 'high' || v === 'low' || v === 'both') return v;
  } catch {
    /* ignore */
  }
  return 'high';
}

function readMaxLegs(): number {
  try {
    const v = localStorage.getItem(MAX_LEGS_LS);
    if (v == null || v === '') return DEFAULT_MAX_LEGS;
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n >= 2) return n;
  } catch {
    /* ignore */
  }
  return DEFAULT_MAX_LEGS;
}

function readSort(): NoTradeSort {
  try {
    const v = localStorage.getItem(SORT_LS);
    if (v === 'profit' || v === 'date') return v;
  } catch {
    /* ignore */
  }
  return 'profit';
}

function fmtCents(n: number): string {
  return `${n.toFixed(1)}¢`;
}

function sortOpps(opps: WeatherNoTradeOpp[], sort: NoTradeSort): WeatherNoTradeOpp[] {
  const next = opps.slice();
  if (sort === 'date') {
    next.sort(
      (a, b) =>
        (a.dateIso || '').localeCompare(b.dateIso || '') ||
        b.profitCents - a.profitCents ||
        a.cityLabel.localeCompare(b.cityLabel),
    );
  } else {
    next.sort(
      (a, b) =>
        b.profitCents - a.profitCents ||
        (a.dateIso || '').localeCompare(b.dateIso || '') ||
        a.cityLabel.localeCompare(b.cityLabel),
    );
  }
  return next;
}

const OppRow = memo(function OppRow({
  opp,
  expanded,
  onToggle,
  onOpen,
}: {
  opp: WeatherNoTradeOpp;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (opp: WeatherNoTradeOpp) => void;
}) {
  return (
    <>
      <tr
        className="border-b border-gray-800/80 hover:bg-gray-800/50 cursor-pointer"
        onClick={onToggle}
        title="Select city in Temp Odds"
      >
        <td className="py-1 pr-2 text-left text-gray-200 font-medium whitespace-nowrap">{opp.cityLabel}</td>
        <td className="py-1 pr-2 text-left text-gray-400 whitespace-nowrap">{opp.dateLabel}</td>
        <td className="py-1 pr-2 text-center text-[9px] text-gray-400 uppercase">{opp.metric}</td>
        <td className="py-1 pr-2 text-right tabular-nums text-gray-300">{opp.n}</td>
        <td className="py-1 pr-2 text-right tabular-nums text-amber-200/90">{fmtCents(opp.costCents)}</td>
        <td className="py-1 pr-2 text-right tabular-nums text-gray-500">{fmtCents(opp.maxCostCents)}</td>
        <td className="py-1 pr-2 text-right tabular-nums font-bold text-emerald-400">{fmtCents(opp.profitCents)}</td>
        <td className="py-1 text-right">
          <button
            type="button"
            className="text-[9px] text-blue-400 hover:underline px-1"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(opp);
            }}
            title="Select first leg in sidebar (NO)"
          >
            Open
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-gray-800/60 bg-gray-900/40">
          <td colSpan={8} className="px-2 py-1.5">
            <div className="flex flex-wrap gap-1.5">
              {opp.legs.map((leg) => (
                <span
                  key={leg.noTokenId}
                  className="inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-800/80 px-1.5 py-0.5 text-[9px] text-gray-300"
                  title={leg.market.question || leg.temp}
                >
                  <span className="text-gray-400">{leg.temp}</span>
                  <span className="tabular-nums text-rose-300/90">{fmtCents(leg.priceCents)}</span>
                </span>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
});

export function WeatherNoTradePanel({ panelId }: { panelId?: string }) {
  const weatherMarkets = useAppStore((s) => s.weatherMarkets);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const marketLookup = useMarketLookupSnapshot();
  const quoteDigest = useSyncExternalStore(
    subscribeBidAskMarketLookupGridFlush,
    getBidAskGridFlushDigest,
    () => 0,
  );

  const [profitLocal, setProfitLocal] = useState(() => String(readProfit()));
  const [profitTarget, setProfitTarget] = useState(() => readProfit());
  const [maxLegsLocal, setMaxLegsLocal] = useState(() => String(readMaxLegs()));
  const [maxLegs, setMaxLegs] = useState(() => readMaxLegs());
  const [mode, setMode] = useState<NoTradeQuoteMode>(() => readMode());
  const [metric, setMetric] = useState<WeatherMetric | 'both'>(() => readMetric());
  const [sort, setSort] = useState<NoTradeSort>(() => readSort());
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const extraKey = `weather-no-trade-${panelId || 'default'}`;

  useEffect(() => {
    const ids = weatherNoTradeTokenIds(weatherMarkets);
    setChartBidAskExtraTokens(extraKey, ids);
    return () => setChartBidAskExtraTokens(extraKey, []);
  }, [weatherMarkets, extraKey]);

  const opps = useMemo(() => {
    void quoteDigest;
    const found = findWeatherNoTradeOpps({
      weatherMarkets,
      lookup: marketLookup,
      mode,
      profitTargetCents: profitTarget,
      metric,
      maxLegs,
    });
    return sortOpps(found, sort);
  }, [weatherMarkets, marketLookup, mode, profitTarget, metric, maxLegs, sort, quoteDigest]);

  const commitProfit = () => {
    const n = parseFloat(profitLocal.replace(/,/g, ''));
    const next = Number.isFinite(n) && n >= 0 ? n : 100;
    setProfitLocal(String(next));
    setProfitTarget(next);
    try {
      localStorage.setItem(PROFIT_LS, String(next));
    } catch {
      /* ignore */
    }
  };

  const commitMaxLegs = () => {
    const n = parseInt(maxLegsLocal.replace(/,/g, ''), 10);
    const next = Number.isFinite(n) && n >= 2 ? n : DEFAULT_MAX_LEGS;
    setMaxLegsLocal(String(next));
    setMaxLegs(next);
    try {
      localStorage.setItem(MAX_LEGS_LS, String(next));
    } catch {
      /* ignore */
    }
  };

  const setModePersist = (m: NoTradeQuoteMode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_LS, m);
    } catch {
      /* ignore */
    }
  };

  const setMetricPersist = (m: WeatherMetric | 'both') => {
    setMetric(m);
    try {
      localStorage.setItem(METRIC_LS, m);
    } catch {
      /* ignore */
    }
  };

  const setSortPersist = (s: NoTradeSort) => {
    setSort(s);
    try {
      localStorage.setItem(SORT_LS, s);
    } catch {
      /* ignore */
    }
  };

  const focusTempOdds = (opp: WeatherNoTradeOpp) => {
    if (isWeatherCitySlug(opp.city)) {
      selectTempOddsCity(opp.city, { linkSidebar: false });
    }
    if (opp.dateIso) selectTempOddsDate(opp.dateIso);
    if (opp.metric === 'high' || opp.metric === 'low') selectTempOddsMetric(opp.metric);
  };

  const onRowClick = (opp: WeatherNoTradeOpp, key: string) => {
    focusTempOdds(opp);
    setExpandedKey((k) => (k === key ? null : key));
  };

  const onOpen = (opp: WeatherNoTradeOpp) => {
    focusTempOdds(opp);
    const first = opp.legs[0]?.market;
    if (!first) return;
    setSelectedMarket(first);
    setSidebarOutcome('NO');
    setSidebarOpen(true);
  };

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-2 flex flex-col min-h-0 h-full">
      <div className="panel-header flex items-center gap-2 mb-1.5 flex-wrap cursor-grab shrink-0">
        <span className="text-xs font-semibold text-white">No Trade</span>
        <span className="text-[9px] text-gray-500" title="Buy cheapest N NO asks if cost ≤ N×100¢ − profit">
          weather NO basket
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[9px] text-gray-500">Profit</span>
          <input
            type="text"
            inputMode="decimal"
            value={profitLocal}
            onChange={(e) => setProfitLocal(e.target.value)}
            onBlur={commitProfit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitProfit();
            }}
            className="w-12 text-[11px] text-center text-gray-200 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 outline-none no-drag"
            title="Target profit in cents (default 100)"
            aria-label="Profit target cents"
            onMouseDown={(e) => e.stopPropagation()}
          />
          <span className="text-[9px] text-gray-500">¢</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-gray-500">Max Legs</span>
          <input
            type="text"
            inputMode="numeric"
            value={maxLegsLocal}
            onChange={(e) => setMaxLegsLocal(e.target.value)}
            onBlur={commitMaxLegs}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitMaxLegs();
            }}
            className="w-10 text-[11px] text-center text-gray-200 bg-gray-700 border border-gray-600 rounded px-1 py-0.5 outline-none no-drag"
            title="Cap N (minimum 2, default 6)"
            aria-label="Max legs"
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="flex rounded overflow-hidden border border-gray-600 text-[9px] font-bold">
          {(['bid', 'mid', 'ask'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModePersist(m)}
              className={`px-1.5 py-0.5 uppercase ${
                mode === m ? 'bg-purple-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="flex rounded overflow-hidden border border-gray-600 text-[9px] font-bold">
          {(
            [
              ['high', 'Hi'],
              ['low', 'Lo'],
              ['both', 'Both'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetricPersist(k)}
              className={`px-1.5 py-0.5 ${
                metric === k ? 'bg-cyan-800 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded overflow-hidden border border-gray-600 text-[9px] font-bold">
          {(
            [
              ['profit', 'Profit'],
              ['date', 'Date'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSortPersist(k)}
              className={`px-1.5 py-0.5 ${
                sort === k ? 'bg-amber-800 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
              title={k === 'date' ? 'Sort by event date (soonest first)' : 'Sort by profit (highest first)'}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-body flex-1 min-h-0 overflow-auto text-[10px]">
        {opps.length === 0 ? (
          <div className="text-gray-500 text-center py-6 px-2">
            No cities where cheapest NO basket (N≤{maxLegs}) costs ≤ N×100¢ − {profitTarget}¢ ({mode}).
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-20 bg-gray-900">
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-1 font-medium bg-gray-900">City</th>
                <th
                  className={`text-left py-1 font-medium bg-gray-900 cursor-pointer select-none hover:text-gray-300 ${
                    sort === 'date' ? 'text-amber-300' : ''
                  }`}
                  onClick={() => setSortPersist('date')}
                  title="Sort by date"
                >
                  Date{sort === 'date' ? ' ▲' : ''}
                </th>
                <th className="text-center py-1 font-medium bg-gray-900">Hi/Lo</th>
                <th className="text-right py-1 font-medium bg-gray-900">N</th>
                <th className="text-right py-1 font-medium bg-gray-900">Cost</th>
                <th className="text-right py-1 font-medium bg-gray-900">Max</th>
                <th
                  className={`text-right py-1 font-medium bg-gray-900 cursor-pointer select-none hover:text-gray-300 ${
                    sort === 'profit' ? 'text-amber-300' : ''
                  }`}
                  onClick={() => setSortPersist('profit')}
                  title="Sort by profit"
                >
                  Profit{sort === 'profit' ? ' ▼' : ''}
                </th>
                <th className="text-right py-1 font-medium bg-gray-900" />
              </tr>
            </thead>
            <tbody>
              {opps.map((opp) => {
                const key = `${opp.city}|${opp.eventSlug}|${opp.metric}|${opp.n}`;
                return (
                  <OppRow
                    key={key}
                    opp={opp}
                    expanded={expandedKey === key}
                    onToggle={() => onRowClick(opp, key)}
                    onOpen={onOpen}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
