import { useMemo, useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { fetchWalletPnlDaily } from '../../api';
import type { Trade } from '../../types';
import { getTradeClobTokenId } from '../../utils/format';

const PNL_BUCKET_KEY = 'polybot-pnl-bucket-mode';
const PNL_MARKET_TYPE_FILTER_KEY = 'polybot-pnl-market-type-filter';

function getTradeTimeMs(trade: Trade): number {
  const ts = (trade as { match_time?: string }).match_time || trade.timestamp || trade.created_at || trade.matchTime || '';
  if (!ts) return 0;
  const num = typeof ts === 'number' ? ts : parseFloat(String(ts));
  if (!isNaN(num) && num > 0) {
    return num < 1e12 ? num * 1000 : num;
  }
  const parsed = new Date(ts);
  return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

function fmtUsd(v: number): string {
  if (v === 0) return '-';
  const sign = v >= 0 ? '' : '-';
  const abs = Math.abs(v);
  return `${sign}$${abs.toFixed(2)}`;
}

type PnlBucketMode = 'trade' | 'market';
type PnlMarketType = 'updown' | 'hit' | 'above' | 'between';
type PnlMarketTypeFilter = Record<PnlMarketType, boolean>;

const DEFAULT_MARKET_TYPE_FILTER: PnlMarketTypeFilter = {
  updown: true,
  hit: true,
  above: true,
  between: true,
};

function classifyMarketType(question: string | null | undefined, eventSlug?: string | null): PnlMarketType | null {
  const combined = `${question || ''} ${eventSlug || ''}`.toLowerCase();
  if (/(up\s+or\s+down|updown)/i.test(combined)) return 'updown';
  if (/(reach\s+\$?|dip\s+to\s+\$?| hit\b)/i.test(combined)) return 'hit';
  if (/\bbetween\b.+\band\b/i.test(combined)) return 'between';
  if (/(above\s+\$?|greater than|more than|over\s+\$?|less than|below|under)/i.test(combined)) return 'above';
  return null;
}

export function PnLPanel() {
  const trades = useAppStore((s) => s.trades);
  const marketLookup = useAppStore((s) => s.marketLookup);
  const makerAddress = useAppStore((s) => s.makerAddress);

  const [calendarBump, setCalendarBump] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setCalendarBump((b) => b + 1), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const dateWindow = useMemo(() => {
    const now = new Date();
    const DAYS_PAST = 3;
    const DAYS_FUTURE = 7;
    const dates: string[] = [];
    for (let i = -DAYS_PAST; i <= DAYS_FUTURE; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      dates.push(getDateKey(d));
    }
    return {
      dates,
      fromStr: dates[0]!,
      toStr: dates[dates.length - 1]!,
      dateSet: new Set(dates),
    };
  }, [calendarBump]);

  /** `inactive` = no wallet or fetch failed → Polymarket activity trades; `pending` = loading (show activity); object = on-chain buckets */
  const [onchainByDate, setOnchainByDate] = useState<
    Record<string, { bought: number; sold: number }> | 'pending' | 'inactive'
  >('inactive');

  const [bucketMode, setBucketMode] = useState<PnlBucketMode>(() => {
    const saved = localStorage.getItem(PNL_BUCKET_KEY);
    return saved === 'market' ? 'market' : 'trade';
  });
  const [marketTypeFilter, setMarketTypeFilter] = useState<PnlMarketTypeFilter>(() => {
    try {
      const raw = localStorage.getItem(PNL_MARKET_TYPE_FILTER_KEY);
      if (!raw) return { ...DEFAULT_MARKET_TYPE_FILTER };
      const parsed = JSON.parse(raw) as Partial<PnlMarketTypeFilter>;
      return {
        updown: parsed.updown !== false,
        hit: parsed.hit !== false,
        above: parsed.above !== false,
        between: parsed.between !== false,
      };
    } catch {
      return { ...DEFAULT_MARKET_TYPE_FILTER };
    }
  });

  const setBucket = useCallback((mode: PnlBucketMode) => {
    setBucketMode(mode);
    localStorage.setItem(PNL_BUCKET_KEY, mode);
  }, []);

  const toggleMarketType = useCallback((k: PnlMarketType) => {
    setMarketTypeFilter((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      localStorage.setItem(PNL_MARKET_TYPE_FILTER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const w = makerAddress?.trim();
    if (!w) {
      setOnchainByDate('inactive');
      return;
    }
    let cancelled = false;

    const load = (showPending: boolean) => {
      if (showPending) setOnchainByDate('pending');
      void fetchWalletPnlDaily({
        wallet: w,
        from: dateWindow.fromStr,
        to: dateWindow.toStr,
        bucket: bucketMode,
        updown: marketTypeFilter.updown,
        hit: marketTypeFilter.hit,
        above: marketTypeFilter.above,
        between: marketTypeFilter.between,
      })
        .then((res) => {
          if (!cancelled) setOnchainByDate(res.byDate || {});
        })
        .catch(() => {
          if (!cancelled && showPending) setOnchainByDate('inactive');
        });
    };

    load(true);
    const intervalId = window.setInterval(() => load(false), 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    makerAddress,
    dateWindow.fromStr,
    dateWindow.toStr,
    bucketMode,
    marketTypeFilter.updown,
    marketTypeFilter.hit,
    marketTypeFilter.above,
    marketTypeFilter.between,
  ]);

  const { dates, dataByDate } = useMemo(() => {
    const { dates, dateSet } = dateWindow;

    const dataByDate: Record<string, { bought: number; sold: number }> = {};
    for (const dk of dates) {
      dataByDate[dk] = { bought: 0, sold: 0 };
    }

    if (typeof onchainByDate === 'object' && makerAddress?.trim()) {
      for (const dk of dates) {
        const row = onchainByDate[dk];
        if (row) {
          dataByDate[dk] = { bought: row.bought, sold: row.sold };
        }
      }
      return { dates, dataByDate };
    }

    for (const trade of trades) {
      const timeMs = getTradeTimeMs(trade);
      if (timeMs === 0) continue;
      const tid = getTradeClobTokenId(trade);
      const market = tid ? marketLookup[tid] : undefined;
      const fallbackQuestion = (trade as Trade).title || market?.question || market?.groupItemTitle || market?.eventTitle;
      const fallbackEventSlug = (trade as Trade).eventSlug || (trade as Trade).slug || market?.eventSlug;
      const mType = classifyMarketType(fallbackQuestion, fallbackEventSlug);
      // If market type cannot be classified (missing lookup/meta), keep the trade
      // so P&L totals stay complete.
      if (mType != null && !marketTypeFilter[mType]) continue;

      let dateKey: string | null = null;
      if (bucketMode === 'trade') {
        dateKey = getDateKey(new Date(timeMs));
      } else {
        const end = market?.endDate;
        if (end) {
          const endMs = new Date(end).getTime();
          if (!Number.isNaN(endMs)) {
            dateKey = getDateKey(new Date(endMs));
          }
        }
        if (!dateKey) {
          dateKey = getDateKey(new Date(timeMs));
        }
      }

      if (!dateKey || !dateSet.has(dateKey)) continue;

      const rawPrice = parseFloat(trade.price) || 0;
      const size = parseFloat(trade.size_filled || trade.size) || 0;
      const isClaim = rawPrice === 0 && !(trade as { side?: string | null }).side;
      const value = isClaim ? (trade.usdcSize || size) : (trade.usdcSize || (rawPrice * size));

      if (trade.side === 'BUY' || isClaim) {
        dataByDate[dateKey].bought += value;
      } else {
        dataByDate[dateKey].sold += value;
      }
    }

    return { dates, dataByDate };
  }, [dateWindow, onchainByDate, makerAddress, trades, marketLookup, bucketMode, marketTypeFilter]);

  const todayKey = getDateKey(new Date());

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0">
      <div className="panel-header flex items-center justify-between gap-2 mb-2 cursor-grab flex-wrap">
        <div className="flex flex-col gap-0.5 min-w-0">
          <h3 className="text-sm font-bold text-yellow-400">P&L</h3>
          {makerAddress?.trim() && typeof onchainByDate === 'object' && (
            <span className="text-[8px] text-cyan-400/90 font-medium">On-chain fills</span>
          )}
          {makerAddress?.trim() && onchainByDate === 'pending' && (
            <span className="text-[8px] text-gray-500">Loading on-chain…</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 cursor-default flex-wrap justify-end" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex items-center rounded border border-gray-600 overflow-hidden text-[9px] font-bold">
            <button
              type="button"
              title="Bucket by trade execution date"
              className={`px-1.5 py-0.5 transition ${bucketMode === 'trade' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
              onClick={() => setBucket('trade')}
            >
              Trade Time
            </button>
            <button
              type="button"
              title="Bucket by market expiry date (falls back to trade date if unknown)"
              className={`px-1.5 py-0.5 transition ${bucketMode === 'market' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
              onClick={() => setBucket('market')}
            >
              Market Expiry
            </button>
          </div>
          <div className="flex items-center justify-end gap-x-2 gap-y-0.5 text-[9px] text-gray-300">
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" className="rounded accent-cyan-500" checked={marketTypeFilter.updown} onChange={() => toggleMarketType('updown')} />
              <span>Up or Down</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" className="rounded accent-cyan-500" checked={marketTypeFilter.hit} onChange={() => toggleMarketType('hit')} />
              <span>Hit</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" className="rounded accent-cyan-500" checked={marketTypeFilter.above} onChange={() => toggleMarketType('above')} />
              <span>Above</span>
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" className="rounded accent-cyan-500" checked={marketTypeFilter.between} onChange={() => toggleMarketType('between')} />
              <span>Between</span>
            </label>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-gray-900">
          <tr>
            <th className="px-2 py-1 text-left text-gray-400 font-bold border-b border-gray-700 bg-gray-900"></th>
            {dates.map((dk) => {
              const dt = parseLocalDate(dk);
              const isToday = dk === todayKey;
              const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
              const textCls = isToday
                ? 'text-yellow-400'
                : isWeekend
                  ? 'text-purple-400'
                  : 'text-gray-300';
              return (
                <th
                  key={dk}
                  className={`px-1.5 py-1 text-center border-b border-l border-gray-700 bg-gray-900 font-bold ${isWeekend ? 'bg-purple-900/20' : ''}`}
                >
                  <div className={`flex flex-col sm:flex-row items-center justify-center leading-tight gap-0.5 sm:gap-1 text-[10px] sm:whitespace-nowrap ${textCls}`}>
                    <span>{DAY_NAMES[dt.getDay()]}</span>
                    <span>{dt.getDate()} {MONTH_NAMES[dt.getMonth()]}</span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* Bought row */}
          <tr className="hover:bg-gray-800/50">
            <td className="px-2 py-1 font-bold text-red-400 border-b border-gray-700/50 whitespace-nowrap">Bought</td>
            {dates.map((dk) => {
              const v = dataByDate[dk]?.bought || 0;
              return (
                <td key={dk} className={`px-2 py-1 text-right border-b border-l border-gray-700 ${v > 0 ? 'text-red-400' : 'text-gray-600'}`}>
                  {v > 0 ? fmtUsd(-v) : '-'}
                </td>
              );
            })}
          </tr>
          {/* Sold row */}
          <tr className="hover:bg-gray-800/50">
            <td className="px-2 py-1 font-bold text-green-400 border-b border-gray-700/50 whitespace-nowrap">Sold</td>
            {dates.map((dk) => {
              const v = dataByDate[dk]?.sold || 0;
              return (
                <td key={dk} className={`px-2 py-1 text-right border-b border-l border-gray-700 ${v > 0 ? 'text-green-400' : 'text-gray-600'}`}>
                  {v > 0 ? fmtUsd(v) : '-'}
                </td>
              );
            })}
          </tr>
          {/* Net row */}
          <tr className="hover:bg-gray-800/50">
            <td className="px-2 py-1 font-bold text-white border-b border-gray-700/50 whitespace-nowrap">Net</td>
            {dates.map((dk) => {
              const b = dataByDate[dk]?.bought || 0;
              const s = dataByDate[dk]?.sold || 0;
              const net = s - b;
              const color = net === 0 ? 'text-gray-600' : net > 0 ? 'text-green-400' : 'text-red-400';
              return (
                <td key={dk} className={`px-2 py-1 text-right border-b border-l border-gray-700 font-bold ${color}`}>
                  {net === 0 ? '-' : fmtUsd(net)}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  );
}
