import { useCallback, useMemo, useState } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useMarketLookupSnapshot } from '../../hooks/useMarketLookupSnapshot';
import type { Market } from '../../types';
import { formatPolymarketVolumeK, classifyMarketAssetCategory, marketAssetCategoryMatches, type MarketAssetCategoryFilter } from '../../utils/format';

const MIN_SPREAD_LS = 'polybot-spreads-min-cents';
const MAX_SPREAD_LS = 'polybot-spreads-max-cents';
const CATEGORY_LS = 'polybot-spreads-category';

const CATEGORY_OPTS: MarketAssetCategoryFilter[] = ['ALL', 'CRYPTO', 'WEATHER', 'OTHER'];

type SortCol = 'date' | 'market' | 'bid' | 'ask' | 'mid' | 'spread' | 'volume' | 'stkY' | 'stkN';

type SpreadRow = {
  market: Market;
  dateMs: number;
  label: string;
  bid: number;
  ask: number;
  mid: number;
  spreadCents: number;
  volume: number | null;
  stkY: number | null;
  stkN: number | null;
};

function stakedUsd(m: Market, leg: 'yes' | 'no'): number | null {
  const net = leg === 'yes' ? m.stakedNetYesUsd : m.stakedNetNoUsd;
  if (typeof net === 'number' && Number.isFinite(net) && net >= 0) return net;
  const abs = leg === 'yes' ? m.stakedUsdYesLeg : m.stakedUsdNoLeg;
  if (typeof abs === 'number' && Number.isFinite(abs) && abs >= 0) return abs;
  return null;
}

function fmtUsd(n: number | null): string {
  if (n == null) return '—';
  const k = formatPolymarketVolumeK(n);
  return k === '—' ? '—' : `$${k}`;
}

function readSpreadBound(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v == null || v === '') return fallback;
    const n = parseFloat(v);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch {
    /* ignore */
  }
  return fallback;
}

function hasQuote(side: number | undefined | null): side is number {
  return typeof side === 'number' && Number.isFinite(side) && side > 0 && side <= 1;
}

function readCategory(): MarketAssetCategoryFilter {
  try {
    const v = localStorage.getItem(CATEGORY_LS);
    if (v && CATEGORY_OPTS.includes(v as MarketAssetCategoryFilter)) return v as MarketAssetCategoryFilter;
  } catch {
    /* ignore */
  }
  return 'ALL';
}

function dateStyle(endDate: string): { dateStr: string; dateColor: string; dateMs: number } {
  const endD = new Date(endDate);
  const dateMs = endD.getTime();
  if (Number.isNaN(dateMs)) return { dateStr: '—', dateColor: 'text-gray-400', dateMs: 0 };
  const hoursUntil = (dateMs - Date.now()) / 3600000;
  const dayAbbr = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][endD.getDay()];
  const isWeekend = endD.getDay() === 0 || endD.getDay() === 6;
  if (hoursUntil > 0 && hoursUntil < 24) return { dateStr: 'TODAY', dateColor: 'text-red-400 font-bold', dateMs };
  if (hoursUntil >= 24 && hoursUntil < 48) return { dateStr: 'TMR', dateColor: 'text-yellow-400 font-bold', dateMs };
  return {
    dateStr: `${dayAbbr} ${endD.getDate()}`,
    dateColor: isWeekend ? 'text-purple-400' : 'text-gray-400',
    dateMs,
  };
}

function marketLabel(m: Market): string {
  const git = (m.groupItemTitle || '').trim();
  const et = (m.eventTitle || '').trim();
  const q = (m.question || '').trim();
  if (et && git) return `${et} · ${git}`;
  if (git) return git;
  if (et) return et;
  return q || m.id;
}

function cents(n: number): string {
  return `${(n * 100).toFixed(1)}¢`;
}

export function SpreadsPanel() {
  const marketLookup = useMarketLookupSnapshot();
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);

  const [minSpreadLocal, setMinSpreadLocal] = useState(() => String(readSpreadBound(MIN_SPREAD_LS, 15)));
  const [minSpread, setMinSpread] = useState(() => readSpreadBound(MIN_SPREAD_LS, 15));
  const [maxSpreadLocal, setMaxSpreadLocal] = useState(() => String(readSpreadBound(MAX_SPREAD_LS, 60)));
  const [maxSpread, setMaxSpread] = useState(() => readSpreadBound(MAX_SPREAD_LS, 60));
  const [categoryFilter, setCategoryFilter] = useState<MarketAssetCategoryFilter>(() => readCategory());
  const [sortCol, setSortCol] = useState<SortCol>('spread');
  const [sortAsc, setSortAsc] = useState(false);

  const stopPanelDrag = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const commitMinSpread = () => {
    const n = parseFloat(minSpreadLocal);
    const next = Number.isFinite(n) && n >= 0 ? n : 15;
    setMinSpread(next);
    setMinSpreadLocal(String(next));
    localStorage.setItem(MIN_SPREAD_LS, String(next));
  };

  const commitMaxSpread = () => {
    const n = parseFloat(maxSpreadLocal);
    const next = Number.isFinite(n) && n >= 0 ? n : 60;
    setMaxSpread(next);
    setMaxSpreadLocal(String(next));
    localStorage.setItem(MAX_SPREAD_LS, String(next));
  };

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc((a) => !a);
    else {
      setSortCol(col);
      setSortAsc(col === 'date' || col === 'market');
    }
  };

  const rows = useMemo(() => {
    const byId = new Map<string, Market>();
    for (const m of Object.values(marketLookup)) {
      if (!m?.id || m.closed) continue;
      const yesTok = m.clobTokenIds?.[0];
      const prev = byId.get(m.id);
      if (!prev) {
        byId.set(m.id, m);
        continue;
      }
      // Prefer YES-token row when lookup has both legs
      if (yesTok && m.clobTokenIds?.[0] === yesTok && prev.clobTokenIds?.[0] !== yesTok) {
        byId.set(m.id, m);
      }
    }

    const out: SpreadRow[] = [];
    for (const m of byId.values()) {
      const cat = classifyMarketAssetCategory(m);
      if (!marketAssetCategoryMatches(categoryFilter, cat)) continue;
      const bid = m.bestBid;
      const ask = m.bestAsk;
      // Skip one-sided / empty books — need both bid and ask
      if (!hasQuote(bid) || !hasQuote(ask)) continue;
      if (!(ask > bid)) continue;
      const spreadCents = (ask - bid) * 100;
      if (!(spreadCents > minSpread)) continue;
      if (!(spreadCents <= maxSpread)) continue;
      const volRaw =
        typeof m.wmpVolumeSum === 'number' && Number.isFinite(m.wmpVolumeSum)
          ? m.wmpVolumeSum
          : typeof m.volume === 'number' && Number.isFinite(m.volume)
            ? m.volume
            : null;
      const { dateMs } = dateStyle(m.endDate);
      out.push({
        market: m,
        dateMs,
        label: marketLabel(m),
        bid,
        ask,
        mid: (bid + ask) / 2,
        spreadCents,
        volume: volRaw,
        stkY: stakedUsd(m, 'yes'),
        stkN: stakedUsd(m, 'no'),
      });
    }

    out.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'date':
          cmp = a.dateMs - b.dateMs;
          break;
        case 'market':
          cmp = a.label.localeCompare(b.label);
          break;
        case 'bid':
          cmp = a.bid - b.bid;
          break;
        case 'ask':
          cmp = a.ask - b.ask;
          break;
        case 'mid':
          cmp = a.mid - b.mid;
          break;
        case 'spread':
          cmp = a.spreadCents - b.spreadCents;
          break;
        case 'volume':
          cmp = (a.volume ?? -1) - (b.volume ?? -1);
          break;
        case 'stkY':
          cmp = (a.stkY ?? -1) - (b.stkY ?? -1);
          break;
        case 'stkN':
          cmp = (a.stkN ?? -1) - (b.stkN ?? -1);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return out;
  }, [marketLookup, minSpread, maxSpread, categoryFilter, sortCol, sortAsc]);

  const openMarket = useCallback(
    (m: Market) => {
      setSelectedMarket(m);
      setSidebarOutcome('YES');
      setSidebarOpen(true);
    },
    [setSelectedMarket, setSidebarOutcome, setSidebarOpen],
  );

  const sortMark = (col: SortCol) => {
    if (sortCol !== col) return '';
    return sortAsc ? ' ↑' : ' ↓';
  };

  const th = (col: SortCol, label: string, align: 'left' | 'right' = 'left') => (
    <th
      className={`px-1 py-0.5 cursor-pointer select-none hover:text-gray-300 whitespace-nowrap ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => toggleSort(col)}
      onPointerDownCapture={stopPanelDrag}
      onMouseDown={stopPanelDrag}
    >
      {label}
      {sortMark(col)}
    </th>
  );

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0 h-full">
      <div className="panel-header flex items-center justify-between gap-2 mb-2 cursor-grab flex-wrap">
        <h3 className="text-sm font-bold text-cyan-400 flex items-center gap-1">
          <ArrowDownUp className="w-3.5 h-3.5" />
          Spreads
          <span className="text-[10px] font-normal text-gray-500">{rows.length}</span>
        </h3>
        <div
          className="flex gap-1.5 items-center no-drag text-[9px] text-gray-500 flex-wrap justify-end"
          onPointerDownCapture={stopPanelDrag}
          onMouseDown={stopPanelDrag}
          onTouchStart={stopPanelDrag}
        >
          <div className="inline-flex items-center gap-0.5 rounded-md bg-gray-900 border border-gray-700 p-0.5 text-[9px] font-bold">
            {CATEGORY_OPTS.map((c) => {
              const active = categoryFilter === c;
              const label = c === 'CRYPTO' ? 'Crypto' : c === 'WEATHER' ? 'Weather' : c === 'OTHER' ? 'Other' : 'All';
              return (
                <button
                  key={c}
                  type="button"
                  title={
                    c === 'ALL' ? 'All markets'
                      : c === 'CRYPTO' ? 'BTC / ETH / SOL / XRP'
                        : c === 'WEATHER' ? 'Weather / temperature'
                          : 'RWA, events, and other'
                  }
                  className={`px-1.5 py-0.5 rounded transition ${
                    active
                      ? c === 'CRYPTO'
                        ? 'bg-green-800/80 text-green-200'
                        : c === 'WEATHER'
                          ? 'bg-sky-800/80 text-sky-200'
                          : c === 'OTHER'
                            ? 'bg-amber-800/70 text-amber-100'
                            : 'bg-gray-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                  onClick={() => {
                    setCategoryFilter(c);
                    localStorage.setItem(CATEGORY_LS, c);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-0.5 text-gray-400">
            <span>Min</span>
            <input
              type="text"
              inputMode="decimal"
              value={minSpreadLocal}
              onChange={(e) => setMinSpreadLocal(e.target.value)}
              onBlur={commitMinSpread}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitMinSpread();
              }}
              onPointerDownCapture={stopPanelDrag}
              onMouseDown={stopPanelDrag}
              className="w-10 bg-gray-700 text-white text-[9px] px-0.5 rounded border border-gray-600 text-center no-spin h-[22px]"
            />
            <span className="text-gray-500">¢</span>
          </label>
          <label className="flex items-center gap-0.5 text-gray-400">
            <span>Max</span>
            <input
              type="text"
              inputMode="decimal"
              value={maxSpreadLocal}
              onChange={(e) => setMaxSpreadLocal(e.target.value)}
              onBlur={commitMaxSpread}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitMaxSpread();
              }}
              onPointerDownCapture={stopPanelDrag}
              onMouseDown={stopPanelDrag}
              className="w-10 bg-gray-700 text-white text-[9px] px-0.5 rounded border border-gray-600 text-center no-spin h-[22px]"
            />
            <span className="text-gray-500">¢</span>
          </label>
        </div>
      </div>

      <div className="panel-body text-xs overflow-x-auto overflow-y-auto flex-1 min-h-0">
        {rows.length === 0 ? (
          <div className="text-gray-500 text-center py-4">
            No markets with both sides in {minSpread}–{maxSpread}¢ spread
          </div>
        ) : (
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-gray-900 z-10">
              <tr className="text-gray-500 border-b border-gray-700">
                {th('date', 'Date')}
                {th('market', 'Market')}
                {th('bid', 'Bid', 'right')}
                {th('ask', 'Ask', 'right')}
                {th('mid', 'Mid', 'right')}
                {th('spread', 'Spread', 'right')}
                {th('stkY', 'Stk Y', 'right')}
                {th('stkN', 'Stk N', 'right')}
                {th('volume', 'Volume', 'right')}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { dateStr, dateColor } = dateStyle(row.market.endDate);
                return (
                  <tr
                    key={row.market.id}
                    onClick={() => openMarket(row.market)}
                    className="border-b border-gray-700/30 hover:bg-gray-700/30 cursor-pointer"
                    title="Open market in sidebar"
                  >
                    <td className={`px-1 py-0.5 ${dateColor} whitespace-nowrap`}>{dateStr}</td>
                    <td className="px-1 py-0.5 text-gray-200 whitespace-nowrap truncate max-w-[220px]" title={row.label}>
                      {row.label}
                    </td>
                    <td className="px-1 py-0.5 text-right text-green-400/90 tabular-nums">{cents(row.bid)}</td>
                    <td className="px-1 py-0.5 text-right text-red-400/90 tabular-nums">{cents(row.ask)}</td>
                    <td className="px-1 py-0.5 text-right text-gray-300 tabular-nums">{cents(row.mid)}</td>
                    <td className="px-1 py-0.5 text-right text-yellow-300 font-semibold tabular-nums">
                      {row.spreadCents.toFixed(1)}¢
                    </td>
                    <td className="px-1 py-0.5 text-right text-emerald-400/90 tabular-nums">{fmtUsd(row.stkY)}</td>
                    <td className="px-1 py-0.5 text-right text-red-400/90 tabular-nums">{fmtUsd(row.stkN)}</td>
                    <td className="px-1 py-0.5 text-right text-gray-400 tabular-nums">
                      {formatPolymarketVolumeK(row.volume)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
