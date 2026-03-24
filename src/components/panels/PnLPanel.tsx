import { useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';

function getDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function fmtUsd(v: number): string {
  if (v === 0) return '-';
  const sign = v >= 0 ? '' : '-';
  const abs = Math.abs(v);
  return `${sign}$${abs.toFixed(2)}`;
}

export function PnLPanel() {
  const trades = useAppStore((s) => s.trades);

  const { dates, dataByDate } = useMemo(() => {
    const now = new Date();
    const today = getDateKey(now);

    // Generate 3 past + today + 3 future = 7 date columns
    const dates: string[] = [];
    for (let i = -3; i <= 3; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      dates.push(getDateKey(d));
    }

    // Bucket trades by date
    const dataByDate: Record<string, { bought: number; sold: number }> = {};
    for (const dk of dates) {
      dataByDate[dk] = { bought: 0, sold: 0 };
    }

    for (const trade of trades) {
      const ts = (trade as any).match_time || trade.timestamp || trade.created_at || trade.matchTime || '';
      if (!ts) continue;
      // Handle numeric timestamps (unix seconds or ms) and ISO strings
      let timeMs = 0;
      const num = typeof ts === 'number' ? ts : parseFloat(ts);
      if (!isNaN(num) && num > 0) {
        timeMs = num < 1e12 ? num * 1000 : num;
      } else {
        const parsed = new Date(ts);
        if (!isNaN(parsed.getTime())) timeMs = parsed.getTime();
      }
      if (timeMs === 0) continue;
      const dateKey = getDateKey(new Date(timeMs));

      if (!dataByDate[dateKey]) continue; // outside our 7-day window

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

    return { dates, today, dataByDate };
  }, [trades]);

  const todayKey = getDateKey(new Date());

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0">
      <div className="panel-header flex items-center gap-1 mb-2 cursor-grab">
        <h3 className="text-sm font-bold text-yellow-400">P&L</h3>
      </div>
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-gray-900">
          <tr>
            <th className="px-2 py-1 text-left text-gray-400 font-bold border-b border-gray-700 bg-gray-900"></th>
            {dates.map((dk) => {
              const isToday = dk === todayKey;
              return (
                <th
                  key={dk}
                  className={`px-2 py-1 text-center border-b border-gray-700 bg-gray-900 font-bold whitespace-nowrap ${isToday ? 'text-yellow-400' : 'text-gray-300'}`}
                >
                  {formatDateLabel(dk)}
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
                <td key={dk} className={`px-2 py-1 text-right border-b border-gray-700/50 ${v > 0 ? 'text-red-400' : 'text-gray-600'}`}>
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
                <td key={dk} className={`px-2 py-1 text-right border-b border-gray-700/50 ${v > 0 ? 'text-green-400' : 'text-gray-600'}`}>
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
                <td key={dk} className={`px-2 py-1 text-right border-b border-gray-700/50 font-bold ${color}`}>
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
