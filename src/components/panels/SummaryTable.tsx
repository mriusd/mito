import React, { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import { fetchPnlSummary } from '../../api';
import { extractAssetFromMarket } from '../../utils/format';
// import { RefreshCw } from 'lucide-react';

interface PnlEntry { pnl: number; cost: number }
type PnlMap = Record<string, Record<string, PnlEntry>>;

export function SummaryTable() {
  const positions = useAppStore((s) => s.positions);
  const marketLookup = useAppStore((s) => s.marketLookup);
  const allMarkets = useAppStore((s) => s.aboveMarkets);
  const priceOnMarkets = useAppStore((s) => s.priceOnMarkets);
  const showPast = useAppStore((s) => s.showPast);

  const [tab, _setTab] = useState<'cost' | 'pnl'>('cost');
  const [pnlData, setPnlData] = useState<PnlMap | null>(null);
  const openPnlDrilldown = useAppStore((s) => s.openPnlDrilldown);

  useEffect(() => {
    if (tab === 'pnl' && !pnlData) {
      fetchPnlSummary()
        .then((d) => setPnlData((d.pnlMap || {}) as PnlMap))
        .catch(() => {});
    }
  }, [tab, pnlData]);

  // Tab switching hidden — PNL tab removed for now
  // const handleSetTab = (t: 'cost' | 'pnl') => {
  //   setTab(t);
  //   localStorage.setItem('polymarket-summary-tab', t);
  // };

  // const handleRefreshPnl = async () => {
  //   try {
  //     const d = await fetchPnlSummary();
  //     setPnlData((d.pnlMap || {}) as PnlMap);
  //   } catch { /* ignore */ }
  // };

  const assets = ['BTC', 'ETH', 'SOL', 'XRP'];
  const assetColors: Record<string, string> = {
    BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400',
  };

  const now = Date.now();
  const todayStr = new Date().toISOString().split('T')[0];

  // Collect all market dates from all market tables
  const allDates = useMemo(() => {
    const dateMap = new Map<string, string>();
    const addMarkets = (markets: Record<string, Array<{ endDate: string }>>) => {
      for (const arr of Object.values(markets)) {
        for (const m of arr) {
          if (m.endDate) {
            const key = m.endDate.split('T')[0];
            if (!dateMap.has(key)) dateMap.set(key, m.endDate);
          }
        }
      }
    };
    addMarkets(allMarkets as Record<string, Array<{ endDate: string }>>);
    addMarkets(priceOnMarkets as Record<string, Array<{ endDate: string }>>);
    // Also add dates from PnL data
    if (pnlData) {
      for (const asset of Object.keys(pnlData)) {
        for (const ed of Object.keys(pnlData[asset])) {
          const key = ed.split('T')[0];
          if (!dateMap.has(key)) dateMap.set(key, ed);
        }
      }
    }
    return Array.from(dateMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, endDate]) => endDate);
  }, [allMarkets, priceOnMarkets, pnlData]);

  // Filter dates
  const dates = useMemo(() => {
    if (tab === 'pnl') {
      const fiveDaysAgo = now - 5 * 24 * 60 * 60 * 1000;
      return allDates.filter((d) => new Date(d).getTime() >= fiveDaysAgo);
    }
    if (!showPast) {
      return allDates.filter((d) => new Date(d).getTime() >= now);
    }
    return allDates;
  }, [allDates, tab, showPast, now]);

  // Build cost map
  const costMap: Record<string, Record<string, number>> = {};
  for (const a of assets) costMap[a] = {};
  if (tab === 'cost') {
    for (const pos of positions) {
      if ((pos.size || 0) <= 0) continue;
      const tokenId = pos.asset || '';
      const market = marketLookup[tokenId];
      if (!market) continue;
      const asset = extractAssetFromMarket(market);
      if (!asset) continue;
      const endDate = market.endDate || '';
      if (!endDate) continue;
      const cost = (pos.avgPrice || 0) * (pos.size || 0);
      costMap[asset][endDate] = (costMap[asset][endDate] || 0) + cost;
    }
  }

  // Build PnL map from backend data
  const pnlMap: Record<string, Record<string, number>> = {};
  const pnlCostMap: Record<string, Record<string, number>> = {};
  const pnlEndDateMap: Record<string, Record<string, string[]>> = {};
  for (const a of assets) { pnlMap[a] = {}; pnlCostMap[a] = {}; pnlEndDateMap[a] = {}; }
  if (tab === 'pnl' && pnlData) {
    for (const asset of assets) {
      const assetPnl = pnlData[asset] || {};
      for (const [pnlEndDate, vals] of Object.entries(assetPnl)) {
        const pnlDateStr = pnlEndDate.split('T')[0];
        for (const d of dates) {
          if (d.split('T')[0] === pnlDateStr) {
            pnlMap[asset][d] = (pnlMap[asset][d] || 0) + (vals.pnl || 0);
            pnlCostMap[asset][d] = (pnlCostMap[asset][d] || 0) + (vals.cost || 0);
            if (!pnlEndDateMap[asset][d]) pnlEndDateMap[asset][d] = [];
            if (!pnlEndDateMap[asset][d].includes(pnlEndDate)) pnlEndDateMap[asset][d].push(pnlEndDate);
          }
        }
      }
    }
  }


  // Compute totals
  const dateTotals: Record<string, number> = {};
  const dateCostTotals: Record<string, number> = {};
  const assetTotals: Record<string, number> = {};
  const assetCostTotals: Record<string, number> = {};
  let grandTotal = 0;
  let grandCostTotal = 0;

  for (const asset of assets) {
    assetTotals[asset] = 0;
    assetCostTotals[asset] = 0;
    for (const d of dates) {
      const val = tab === 'pnl' ? (pnlMap[asset][d] || 0) : (costMap[asset][d] || 0);
      const cellCost = tab === 'pnl' ? (pnlCostMap[asset]?.[d] || 0) : 0;
      assetTotals[asset] += val;
      assetCostTotals[asset] += cellCost;
      dateTotals[d] = (dateTotals[d] || 0) + val;
      dateCostTotals[d] = (dateCostTotals[d] || 0) + cellCost;
      grandTotal += val;
      grandCostTotal += cellCost;
    }
  }

  // const costTabCls = tab === 'cost' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-500 hover:text-gray-300';
  // const pnlTabCls = tab === 'pnl' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-500 hover:text-gray-300';
  const isPnl = tab === 'pnl';

  const dateHeader = (d: string, idx: number) => {
    const dt = new Date(d);
    const dayOfWeek = dt.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayAbbr = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dayOfWeek];
    const isToday = d.split('T')[0] === todayStr;
    const headerColor = isToday ? 'text-emerald-300' : isWeekend ? 'text-purple-400' : 'text-gray-500';
    const dateBg = isToday ? 'bg-emerald-900/30' : idx % 2 === 0 ? 'bg-gray-700/20' : '';
    return { label: `${dayAbbr} ${dt.getDate()}`, headerColor, dateBg, isToday };
  };

  const dateBgCls = (d: string, idx: number) => {
    const isToday = d.split('T')[0] === todayStr;
    return isToday ? 'bg-emerald-900/30' : idx % 2 === 0 ? 'bg-gray-700/20' : '';
  };

  const content = (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3">
      <div className="panel-header">
        <h3 className="text-sm font-bold text-gray-300 mb-2 flex items-center justify-between">
          <span className="no-drag flex items-center gap-1">
            <svg className="inline w-3.5 h-3.5 mr-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>
            Summary
          </span>
        </h3>
      </div>
      <div className="panel-body overflow-x-auto text-xs">
        {dates.length === 0 ? (
          <div className="text-gray-500 text-center py-2">No data</div>
        ) : (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="py-1 px-1.5 text-left font-medium">Asset</th>
                {dates.map((d, i) => {
                  const h = dateHeader(d, i);
                  return (
                    <th key={d} className={`py-1 px-1.5 text-right font-medium ${h.headerColor} ${h.dateBg}`} colSpan={isPnl ? 2 : 1}>
                      {h.label}
                    </th>
                  );
                })}
                <th className="py-1 px-1 text-right font-medium text-gray-400" colSpan={isPnl ? 2 : 1}>Total</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => {
                const at = assetTotals[asset] || 0;
                const act = assetCostTotals[asset] || 0;
                const hasData = isPnl
                  ? dates.some((d) => Math.abs(pnlMap[asset][d] || 0) >= 0.005)
                  : dates.some((d) => (costMap[asset][d] || 0) > 0);
                if (!hasData && Math.abs(at) < 0.005) return null;
                return (
                  <tr key={asset} className="border-b border-gray-700/50">
                    <td className={`py-0.5 px-1 ${assetColors[asset]} font-bold`}>{asset}</td>
                    {dates.map((d, i) => {
                      const bg = dateBgCls(d, i);
                      const val = isPnl ? (pnlMap[asset][d] || 0) : (costMap[asset][d] || 0);
                      const cellCost = isPnl ? (pnlCostMap[asset]?.[d] || 0) : 0;
                      if (isPnl) {
                        if (Math.abs(val) >= 0.005) {
                          const pnlColor = val >= 0 ? 'text-green-400' : 'text-red-400';
                          const sign = val >= 0 ? '+' : '';
                          const roe = cellCost > 0 ? (val / cellCost * 100) : 0;
                          const roeStr = cellCost > 0 ? `${roe >= 0 ? '+' : ''}${roe.toFixed(0)}%` : '';
                          const roeColor = roe >= 0 ? 'text-green-400' : 'text-red-400';
                          const origDates = pnlEndDateMap[asset]?.[d] || [];
                          return (<React.Fragment key={d}><td className={`py-0.5 px-1.5 text-right ${pnlColor} ${bg} cursor-pointer hover:underline`} onClick={() => openPnlDrilldown(asset, origDates)}>{sign}${Math.abs(val).toFixed(2)}</td>
                            <td className={`py-0.5 pr-1.5 text-right ${roeColor} ${bg}`}>{roeStr}</td></React.Fragment>);
                        }
                        return (<React.Fragment key={d}><td className={`py-0.5 px-1.5 text-right text-gray-600 ${bg}`}>-</td>
                          <td className={`py-0.5 pr-1.5 text-right text-gray-600 ${bg}`}></td></React.Fragment>);
                      }
                      return (
                        <td key={d} className={`py-0.5 px-1.5 text-right ${val > 0 ? 'text-gray-300' : 'text-gray-600'} ${bg}`}>
                          {val > 0 ? `$${Math.round(val).toLocaleString()}` : '-'}
                        </td>
                      );
                    })}
                    {/* Asset total */}
                    {isPnl ? (
                      Math.abs(at) >= 0.005 ? (<>
                        <td className={`py-0.5 px-1.5 text-right font-bold ${at >= 0 ? 'text-green-400' : 'text-red-400'}`}>{at >= 0 ? '+' : ''}${Math.abs(at).toFixed(2)}</td>
                        <td className={`py-0.5 pr-1.5 text-right font-bold ${act > 0 ? (at / act * 100 >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-600'}`}>{act > 0 ? `${at / act * 100 >= 0 ? '+' : ''}${(at / act * 100).toFixed(0)}%` : ''}</td>
                      </>) : (<>
                        <td className="py-0.5 px-1.5 text-right text-gray-600">-</td>
                        <td className="py-0.5 pr-1.5 text-right text-gray-600"></td>
                      </>)
                    ) : (
                      <td className={`py-0.5 px-1 text-right font-bold ${at > 0 ? 'text-white' : 'text-gray-600'}`}>
                        {at > 0 ? `$${Math.round(at).toLocaleString()}` : '-'}
                      </td>
                    )}
                  </tr>
                );
              })}
              {/* Total row */}
              <tr className="border-t border-gray-600 font-bold">
                <td className="py-0.5 px-1.5 text-gray-400">Total</td>
                {dates.map((d, i) => {
                  const bg = dateBgCls(d, i);
                  const total = dateTotals[d] || 0;
                  const totalCost = dateCostTotals[d] || 0;
                  if (isPnl) {
                    if (Math.abs(total) >= 0.005) {
                      const pnlColor = total >= 0 ? 'text-green-400' : 'text-red-400';
                      const roe = totalCost > 0 ? (total / totalCost * 100) : 0;
                      const roeStr = totalCost > 0 ? `${roe >= 0 ? '+' : ''}${roe.toFixed(0)}%` : '';
                      const roeColor = roe >= 0 ? 'text-green-400' : 'text-red-400';
                      return (<React.Fragment key={d}><td className={`py-0.5 px-1.5 text-right ${pnlColor} ${bg}`}>{total >= 0 ? '+' : ''}${Math.abs(total).toFixed(2)}</td>
                        <td className={`py-0.5 pr-1.5 text-right ${roeColor} ${bg}`}>{roeStr}</td></React.Fragment>);
                    }
                    return (<React.Fragment key={d}><td className={`py-0.5 px-1.5 text-right text-gray-600 ${bg}`}>-</td>
                      <td className={`py-0.5 pr-1.5 text-right text-gray-600 ${bg}`}></td></React.Fragment>);
                  }
                  if (total > 0) {
                    const totalColor = 'text-white';
                    return <td key={d} className={`py-0.5 px-1.5 text-right ${totalColor} ${bg}`}>${Math.round(total).toLocaleString()}</td>;
                  }
                  return <td key={d} className={`py-0.5 px-1.5 text-right text-gray-600 ${bg}`}>-</td>;
                })}
                {/* Grand total */}
                {isPnl ? (<>
                  <td className={`py-0.5 px-1.5 text-right ${grandTotal >= 0 ? 'text-green-400' : 'text-red-400'}`}>{grandTotal >= 0 ? '+' : ''}${Math.abs(grandTotal).toFixed(2)}</td>
                  <td className={`py-0.5 pr-1.5 text-right font-bold ${grandCostTotal > 0 ? (grandTotal / grandCostTotal * 100 >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-600'}`}>{grandCostTotal > 0 ? `${grandTotal / grandCostTotal * 100 >= 0 ? '+' : ''}${(grandTotal / grandCostTotal * 100).toFixed(0)}%` : ''}</td>
                </>) : (
                  <td className="py-0.5 px-1 text-right text-yellow-400">${Math.round(grandTotal).toLocaleString()}</td>
                )}
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  return content;
}
