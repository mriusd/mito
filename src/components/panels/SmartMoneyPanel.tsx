import { useCallback, useEffect, useMemo, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { fetchSmartMoneySignals } from '../../api';
import { useAppStore } from '../../stores/appStore';
import type { Market, SmartMoneySignalMarket } from '../../types';

function formatUsd(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = d.getDate();
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${day} ${month}`;
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
                <th className="text-left px-1 py-0.5">End</th>
                <th className="text-left px-1 py-0.5">Market</th>
                <th className="text-center px-1 py-0.5">Dir</th>
                <th className="text-right px-1 py-0.5">Smart</th>
                <th className="text-right px-1 py-0.5">Exp</th>
                <th className="text-right px-1 py-0.5">Shares</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
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
                    <td className="px-1 py-0.5 font-bold text-gray-200">{row.asset || '-'}</td>
                    <td className="px-1 py-0.5 text-gray-400 whitespace-nowrap">{formatDateShort(row.endDate)}</td>
                    <td className="px-1 py-0.5 text-gray-300 truncate max-w-[220px]">{row.question || row.marketId}</td>
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
