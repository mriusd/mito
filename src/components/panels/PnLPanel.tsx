import { useMemo, useState, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { Trade } from '../../types';

const PNL_BUCKET_KEY = 'polybot-pnl-bucket-mode';

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

function tradeTokenId(trade: Trade): string {
  return trade.asset_id || trade.asset || trade.token_id || trade.market || '';
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

export function PnLPanel() {
  const trades = useAppStore((s) => s.trades);
  const marketLookup = useAppStore((s) => s.marketLookup);

  const [bucketMode, setBucketMode] = useState<PnlBucketMode>(() => {
    const saved = localStorage.getItem(PNL_BUCKET_KEY);
    return saved === 'market' ? 'market' : 'trade';
  });

  const setBucket = useCallback((mode: PnlBucketMode) => {
    setBucketMode(mode);
    localStorage.setItem(PNL_BUCKET_KEY, mode);
  }, []);

  const { dates, dataByDate } = useMemo(() => {
    const now = new Date();

    // 3 calendar days before today through 7 after (inclusive of today), oldest → newest
    const DAYS_PAST = 3;
    const DAYS_FUTURE = 7;
    const dates: string[] = [];
    for (let i = -DAYS_PAST; i <= DAYS_FUTURE; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      dates.push(getDateKey(d));
    }

    const dataByDate: Record<string, { bought: number; sold: number }> = {};
    for (const dk of dates) {
      dataByDate[dk] = { bought: 0, sold: 0 };
    }

    const dateSet = new Set(dates);

    for (const trade of trades) {
      const timeMs = getTradeTimeMs(trade);
      if (timeMs === 0) continue;

      let dateKey: string | null = null;
      if (bucketMode === 'trade') {
        dateKey = getDateKey(new Date(timeMs));
      } else {
        const tid = tradeTokenId(trade);
        const market = tid ? marketLookup[tid] : undefined;
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
  }, [trades, marketLookup, bucketMode]);

  const todayKey = getDateKey(new Date());

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0">
      <div className="panel-header flex items-center justify-between gap-2 mb-2 cursor-grab flex-wrap">
        <h3 className="text-sm font-bold text-yellow-400">P&L</h3>
        <div
          className="flex items-center rounded border border-gray-600 overflow-hidden text-[9px] font-bold shrink-0 cursor-default"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
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
