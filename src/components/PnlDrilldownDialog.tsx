import { useState, useEffect, useCallback } from 'react';
import { fetchPnlDrilldown, fetchProgTrades } from '../api';
import type { DrilldownProg } from '../api';
import { useAppStore } from '../stores/appStore';
import type { ProgArb } from '../types';

const ASSET_COLORS: Record<string, string> = {
  BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400',
};

interface PnlDrilldownDialogProps {
  open: boolean;
  asset: string;
  endDates: string[];
  onClose: () => void;
}

export function PnlDrilldownDialog({ open, asset, endDates, onClose }: PnlDrilldownDialogProps) {
  const [progs, setProgs] = useState<DrilldownProg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
  const setEditProgArb = useAppStore((s) => s.setEditProgArb);

  const handleProgClick = useCallback(async (progId: number) => {
    try {
      const data = await fetchProgTrades(progId);
      if (data.prog) {
        setEditProgArb(data.prog as ProgArb);
      }
    } catch { /* ignore */ }
  }, [setEditProgArb]);

  const load = useCallback(async () => {
    if (!asset || endDates.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const allProgs: DrilldownProg[] = [];
      for (const ed of endDates) {
        const d = await fetchPnlDrilldown(asset, ed);
        if (d.progs) allProgs.push(...d.progs);
      }
      setProgs(allProgs);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [asset, endDates]);

  useEffect(() => {
    if (open) load();
    else setProgs([]);
  }, [open, load]);

  if (!open) return null;

  const filtered = hideEmpty ? progs.filter(p => (p.bought_usd + p.sold_usd) > 0) : progs;

  // Totals
  let tBoughtSh = 0, tBoughtUsd = 0, tSoldSh = 0, tSoldUsd = 0, tVol = 0, tPnl = 0, tInv = 0, tInvCost = 0;
  for (const p of filtered) {
    tBoughtSh += p.bought_shares; tBoughtUsd += p.bought_usd;
    tSoldSh += p.sold_shares; tSoldUsd += p.sold_usd;
    tVol += p.bought_usd + p.sold_usd; tPnl += p.pnl;
    tInv += (p.inv || 0); tInvCost += (p.inv_cost || 0);
  }
  const tAvgBuy = tBoughtSh > 0 ? (tBoughtUsd / tBoughtSh * 100).toFixed(1) : '--';
  const tAvgSell = tSoldSh > 0 ? (tSoldUsd / tSoldSh * 100).toFixed(1) : '--';

  const ed0 = endDates[0] ? new Date(endDates[0]) : null;
  const dayAbbr = ed0 ? ['Su','Mo','Tu','We','Th','Fr','Sa'][ed0.getDay()] : '';
  const dayNum = ed0 ? ed0.getDate() : '';

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[49999] flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-800 rounded-lg p-5 max-w-5xl w-full mx-4 shadow-xl border border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold text-cyan-400 flex items-center gap-2">
            Drilldown ·{' '}
            <span className={ASSET_COLORS[asset] || 'text-cyan-400'}>{asset}</span>{' '}
            <span className="text-gray-400">{dayAbbr} {dayNum}</span>
            <label className="ml-3 flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer font-normal">
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
                className="w-3 h-3 accent-cyan-500"
              />
              Hide empty
            </label>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">×</button>
        </div>

        <div className="overflow-x-auto overflow-y-auto max-h-72 text-[10px]">
          {loading && <div className="text-gray-500 text-center py-4">Loading...</div>}
          {error && <div className="text-red-400 text-center py-4">Failed: {error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div className="text-gray-500 text-center py-4">
              No smart orders{hideEmpty && progs.length > filtered.length ? ' (all empty)' : ''}
            </div>
          )}
          {!loading && !error && filtered.length > 0 && (
            <table className="w-full whitespace-nowrap">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-1 px-1">ID</th>
                  <th className="text-left px-1">Strike</th>
                  <th className="text-left px-1">St</th>
                  <th className="text-right px-1">Size</th>
                  <th className="text-right px-1">INV</th>
                  <th className="text-right px-1">INV$</th>
                  <th className="text-center px-1">Lp</th>
                  <th className="text-center px-1">AE</th>
                  <th className="text-right px-1">B.Sh</th>
                  <th className="text-right px-1">Avg</th>
                  <th className="text-right px-1">B.$</th>
                  <th className="text-right px-1">S.Sh</th>
                  <th className="text-right px-1">Avg</th>
                  <th className="text-right px-1">S.$</th>
                  <th className="text-right px-1">Vol</th>
                  <th className="text-right px-1">PnL</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const avgBuy = p.bought_shares > 0 ? (p.bought_usd / p.bought_shares * 100).toFixed(1) : '--';
                  const avgSell = p.sold_shares > 0 ? (p.sold_usd / p.sold_shares * 100).toFixed(1) : '--';
                  const vol = p.bought_usd + p.sold_usd;
                  const pnlColor = p.pnl > 0 ? 'text-green-400' : p.pnl < 0 ? 'text-red-400' : 'text-gray-500';
                  const statusColor = p.status === 'closed'
                    ? (p.close_reason === 'claim' ? 'text-green-400' : p.close_reason === 'expiry' ? 'text-red-400' : 'text-gray-400')
                    : p.status === 'cancelled' ? 'text-red-400' : 'text-cyan-400';
                  const statusLabel = p.status === 'closed' ? (p.close_reason || 'closed') : p.status;
                  const sizeStr = p.isDollar ? `$${p.size}` : String(p.size);

                  return (
                    <tr key={p.id} className="border-b border-gray-800 cursor-pointer hover:bg-gray-700/30" onClick={() => handleProgClick(p.id)}>
                      <td className="py-0.5 px-1 text-gray-400 font-mono">#{p.id}</td>
                      <td className="px-1 text-gray-300">{p.strikes}</td>
                      <td className={`px-1 ${statusColor}`}>{statusLabel}</td>
                      <td className="text-right px-1 text-gray-400">{sizeStr}</td>
                      <td className="text-right px-1 text-white font-bold">{p.inv || 0}</td>
                      <td className="text-right px-1 text-yellow-400">${(p.inv_cost || 0).toFixed(2)}</td>
                      <td className="text-center px-1">{p.loop ? <span className="text-blue-400">✓</span> : <span className="text-gray-600">–</span>}</td>
                      <td className="text-center px-1">{p.auto_sell ? <span className="text-yellow-400">✓</span> : <span className="text-gray-600">–</span>}</td>
                      <td className="text-right px-1 text-gray-400">{p.bought_shares}</td>
                      <td className="text-right px-1 text-gray-400">{avgBuy}¢</td>
                      <td className="text-right px-1 text-gray-400">${p.bought_usd.toFixed(2)}</td>
                      <td className="text-right px-1 text-gray-400">{p.sold_shares}</td>
                      <td className="text-right px-1 text-gray-400">{avgSell}¢</td>
                      <td className="text-right px-1 text-gray-400">${p.sold_usd.toFixed(2)}</td>
                      <td className="text-right px-1 text-gray-300">${vol.toFixed(2)}</td>
                      <td className={`text-right px-1 ${pnlColor} font-bold`}>{p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}</td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr className="border-t border-gray-600 font-bold">
                  <td className="py-0.5 px-1 text-gray-400" colSpan={3}>
                    Total ({filtered.length}{hideEmpty && progs.length > filtered.length ? `/${progs.length}` : ''})
                  </td>
                  <td className="text-right px-1"></td>
                  <td className="text-right px-1 text-white">{tInv}</td>
                  <td className="text-right px-1 text-yellow-400">${tInvCost.toFixed(2)}</td>
                  <td className="text-center px-1"></td>
                  <td className="text-center px-1"></td>
                  <td className="text-right px-1 text-gray-300">{tBoughtSh}</td>
                  <td className="text-right px-1 text-gray-300">{tAvgBuy}¢</td>
                  <td className="text-right px-1 text-gray-300">${tBoughtUsd.toFixed(2)}</td>
                  <td className="text-right px-1 text-gray-300">{tSoldSh}</td>
                  <td className="text-right px-1 text-gray-300">{tAvgSell}¢</td>
                  <td className="text-right px-1 text-gray-300">${tSoldUsd.toFixed(2)}</td>
                  <td className="text-right px-1 text-white">${tVol.toFixed(2)}</td>
                  <td className={`text-right px-1 ${tPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {tPnl >= 0 ? '+' : ''}${tPnl.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
