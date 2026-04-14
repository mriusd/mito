import { useCallback, useEffect, useMemo, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { fetchSmartMoneySignals } from '../../api';
import { useAppStore } from '../../stores/appStore';
import type { Market, SmartMoneySignalMarket } from '../../types';
import { ASSET_COLORS, formatPriceShort, getSignalTablePriceStr } from '../../utils/format';

function formatUsd(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function signalTableDateStyle(endDate: string): { dateStr: string; dateColor: string } {
  const endD = new Date(endDate);
  if (Number.isNaN(endD.getTime())) return { dateStr: '-', dateColor: 'text-gray-400' };
  const hoursUntil = (endD.getTime() - Date.now()) / 3600000;
  const dayAbbr = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][endD.getDay()];
  const isWeekend2 = endD.getDay() === 0 || endD.getDay() === 6;
  if (hoursUntil > 0 && hoursUntil < 24) return { dateStr: 'TODAY', dateColor: 'text-red-400 font-bold' };
  if (hoursUntil >= 24 && hoursUntil < 48) return { dateStr: 'TMR', dateColor: 'text-yellow-400 font-bold' };
  return {
    dateStr: dayAbbr + ' ' + endD.getDate(),
    dateColor: isWeekend2 ? 'text-purple-400' : 'text-gray-400',
  };
}

function directionToOutcome(direction: string): 'YES' | 'NO' {
  return direction === 'YES' || direction === 'UP' ? 'YES' : 'NO';
}

export function SmartMoneyPanel() {
  const marketLookup = useAppStore((s) => s.marketLookup);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);

  const [rows, setRows] = useState<SmartMoneySignalMarket[]>([]);
  const [threshold, setThreshold] = useState<number>(60);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      try {
        const data = await fetchSmartMoneySignals();
        if (cancelled) return;
        setRows(Array.isArray(data.markets) ? data.markets : []);
        setThreshold(typeof data.threshold === 'number' ? data.threshold : 60);
        setCount(typeof data.count === 'number' ? data.count : 0);
        setError('');
      } catch {
        if (!cancelled) setError('Failed to load smart money');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load(true);
    const id = window.setInterval(() => void load(false), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const marketsById = useMemo(() => {
    const map = new Map<string, Market>();
    for (const m of Object.values(marketLookup)) {
      if (m?.id && !map.has(m.id)) map.set(m.id, m);
    }
    return map;
  }, [marketLookup]);

  const openMarket = useCallback((row: SmartMoneySignalMarket) => {
    const market = marketsById.get(row.marketId);
    if (!market) return;
    setSelectedMarket(market);
    setSidebarOutcome(directionToOutcome(row.direction));
    setSidebarOpen(true);
  }, [marketsById, setSelectedMarket, setSidebarOutcome, setSidebarOpen]);

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0">
      <div className="panel-header flex items-center justify-between gap-2 mb-2 cursor-grab">
        <h3 className="text-sm font-bold text-yellow-400 flex items-center gap-1">
          <GraduationCap className="w-3.5 h-3.5" />
          Smart Money
        </h3>
        <div className="text-[9px] text-gray-500">
          WR {threshold}%+ | {count} mkts
        </div>
      </div>

      <div className="panel-body text-xs overflow-x-auto overflow-y-auto flex-1 min-h-0">
        {loading && rows.length === 0 ? (
          <div className="text-gray-500 text-center py-4">Loading...</div>
        ) : error && rows.length === 0 ? (
          <div className="text-red-400 text-center py-4">{error}</div>
        ) : rows.length === 0 ? (
          <div className="text-gray-500 text-center py-4">No smart money signals</div>
        ) : (
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-gray-900 z-10">
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left px-1 py-0.5">Asset</th>
                <th className="text-left px-1 py-0.5">Date</th>
                <th className="text-left px-1 py-0.5">Market</th>
                <th className="text-center px-1 py-0.5">Dir</th>
                <th className="text-right px-1 py-0.5">Smart</th>
                <th className="text-right px-1 py-0.5">Exp</th>
                <th className="text-right px-1 py-0.5">Shares</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const acol = ASSET_COLORS[row.asset] || 'text-gray-400';
                const { dateStr, dateColor } = signalTableDateStyle(row.endDate);
                const m = marketsById.get(row.marketId);
                const rawPriceStr = m ? getSignalTablePriceStr(m, marketLookup) : (row.priceStr || '');
                const strikeLabel = rawPriceStr ? formatPriceShort(rawPriceStr) : '—';
                const dirOutcome = directionToOutcome(row.direction);
                const dirColor = dirOutcome === 'YES' ? 'text-green-400' : 'text-red-400';
                const barPct = Math.max(2, Math.min(98, Number.isFinite(row.barPct) ? row.barPct : (50 + (row.provenSMS || 0) * 50)));
                const canOpen = marketsById.has(row.marketId);
                return (
                  <tr
                    key={row.marketId}
                    onClick={() => openMarket(row)}
                    className={`border-b border-gray-700/30 ${canOpen ? 'hover:bg-gray-700/30 cursor-pointer' : 'opacity-80'}`}
                    title={canOpen ? 'Open market in sidebar' : 'Market not in current lookup'}
                  >
                    <td className={`px-1 py-0.5 font-bold ${acol}`}>{row.asset || '-'}</td>
                    <td className={`px-1 py-0.5 ${dateColor} whitespace-nowrap`}>{dateStr}</td>
                    <td
                      className={`px-1 py-0.5 ${acol} whitespace-nowrap truncate max-w-[100px] hover:underline cursor-pointer`}
                      onClick={(e) => { e.stopPropagation(); openMarket(row); }}
                    >
                      {row.asset || '-'} {strikeLabel}
                    </td>
                    <td className={`px-1 py-0.5 text-center font-bold ${dirColor}`}>{row.direction}</td>
                    <td className="px-1 py-0.5">
                      <div className="h-[6px] bg-gray-700 rounded-full overflow-hidden flex">
                        <div className="bg-yellow-400/75 h-full transition-all" style={{ width: `${barPct}%` }} />
                        <div className="bg-purple-400/75 h-full flex-1" />
                      </div>
                      <div className="text-[8px] text-gray-500 mt-0.5 text-right">{row.smartWalletCount || 0}w</div>
                    </td>
                    <td className="px-1 py-0.5 text-right text-cyan-300">{formatUsd(row.smartExposure || 0)}</td>
                    <td className="px-1 py-0.5 text-right text-gray-300">{Math.round(row.totalShares || 0).toLocaleString()}</td>
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
