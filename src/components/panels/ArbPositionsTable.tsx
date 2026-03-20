import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../stores/appStore';
import { fetchArbProgs, fetchPnlDrilldownAll, cancelProgArb } from '../../api';
import type { DrilldownProg } from '../../api';
import { getTokenOutcome } from '../../utils/format';
import type { Market, ProgArb } from '../../types';

const assetColor: Record<string, string> = { BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400' };

function ColTip({ label, tip, className }: { label: string; tip: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!hover || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left + r.width / 2 });
  }, [hover]);
  return (
    <>
      <span ref={ref} className={className} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>{label}</span>
      {hover && createPortal(
        <div className="fixed z-[9999] px-2 py-1 rounded bg-gray-700 border border-gray-600 text-gray-200 text-[9px] font-normal whitespace-nowrap shadow-lg pointer-events-none" style={{ top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}>{tip}</div>,
        document.body
      )}
    </>
  );
}

function getDateDisplay(endDate: string | undefined): { label: string; color: string } {
  if (!endDate) return { label: '--', color: 'text-gray-500' };
  const dt = new Date(endDate);
  const h = (dt.getTime() - Date.now()) / 3600000;
  const da = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dt.getDay()];
  if (h > 0 && h < 24) return { label: 'TODAY', color: 'text-red-400 font-bold' };
  if (h >= 24 && h < 48) return { label: 'TMR', color: 'text-yellow-400 font-bold' };
  const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
  return { label: `${da} ${dt.getDate()}`, color: isWeekend ? 'text-purple-400' : 'text-gray-400' };
}

function formatStrike(strike: string): string {
  const cleaned = strike.replace(/\$/g, '').replace(/,/g, '');
  const n = parseFloat(cleaned);
  if (isNaN(n)) return strike;
  if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k';
  return n.toString();
}

function classifyProg(p: ProgArb): string {
  const legs = p.legs || [];
  if (p.loop) return 'loop';
  if (legs.some((l) => l.bs_anchor)) return 'anc';
  return 'other';
}


export function ArbPositionsTable() {
  const progArbs = useAppStore((s) => s.progArbs) as ProgArb[];
  const setProgArbs = useAppStore((s) => s.setProgArbs);
  const marketLookup = useAppStore((s) => s.marketLookup);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);

  const handleMarketClick = useCallback((tokenId: string, outcome: 'YES' | 'NO') => {
    const market = marketLookup[tokenId];
    if (!market) return;
    setSelectedMarket(market as Market);
    setSidebarOutcome(outcome);
    setSidebarOpen(true);
  }, [marketLookup, setSelectedMarket, setSidebarOutcome, setSidebarOpen]);

  const [tab, setTab] = useState<'prog' | 'history'>(() => {
    const saved = localStorage.getItem('polymarket-arb-panel-tab');
    if (saved === 'history' || saved === 'summary') return 'history';
    return 'prog';
  });
  const [loading, setLoading] = useState(false);
  const [progFilter, setProgFilter] = useState(localStorage.getItem('progFilter') || 'all');
  const [sortCol, setSortCol] = useState(localStorage.getItem('arbSortCol') || 'date');
  const [sortDir, setSortDir] = useState(parseInt(localStorage.getItem('arbSortDir') || '1'));
  const [drilldownProgs, setDrilldownProgs] = useState<DrilldownProg[] | null>(null);
  const [hideEmpty, setHideEmpty] = useState(true);
  const setEditProgArb = useAppStore((s) => s.setEditProgArb);

  useEffect(() => { loadProgs(); }, []);

  useEffect(() => {
    if (tab === 'history' && !drilldownProgs) {
      fetchPnlDrilldownAll().then((d) => setDrilldownProgs(d.progs || [])).catch(() => {});
    }
  }, [tab, drilldownProgs]);

  const loadProgs = async () => {
    setLoading(true);
    try {
      const data = await fetchArbProgs('active,filled,closed') as { progs?: ProgArb[] };
      if (data.progs) setProgArbs(data.progs as never[]);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleEditProg = (p: ProgArb) => {
    setEditProgArb(p);
  };

  const handleCancelProg = async (progId: number) => {
    if (!confirm(`Cancel smart order #${progId}?`)) return;
    try {
      const result = await cancelProgArb(progId);
      if (result.success) {
        await loadProgs();
      }
    } catch { /* ignore */ }
  };

  const handleSetTab = (t: 'prog' | 'history') => {
    setTab(t);
    localStorage.setItem('polymarket-arb-panel-tab', t);
  };

  const handleSetProgFilter = (f: string) => {
    setProgFilter(f);
    localStorage.setItem('progFilter', f);
  };


  const toggleSort = (col: string) => {
    if (sortCol === col) {
      const nd = -sortDir;
      setSortDir(nd);
      localStorage.setItem('arbSortDir', String(nd));
    } else {
      setSortCol(col);
      const nd = col === 'date' ? 1 : -1;
      setSortDir(nd);
      localStorage.setItem('arbSortCol', col);
      localStorage.setItem('arbSortDir', String(nd));
    }
  };

  const now = Date.now();
  const isExpired = (p: ProgArb) => p.end_date && new Date(p.end_date).getTime() < now;

  // Filter progs
  let filteredProgs: ProgArb[];
  filteredProgs = progArbs.filter((p) => !isExpired(p) && p.status !== 'closed' && p.status !== 'cancelled');

  if (tab === 'prog' && progFilter !== 'all') {
    filteredProgs = filteredProgs.filter((p) => classifyProg(p) === progFilter);
  }

  // Sort
  filteredProgs = [...filteredProgs].sort((a, b) => {
    if (sortCol === 'id') return (a.id - b.id) * sortDir;
    if (sortCol === 'size') return (a.size - b.size) * sortDir;
    const da = a.end_date ? new Date(a.end_date).getTime() : Infinity;
    const db = b.end_date ? new Date(b.end_date).getTime() : Infinity;
    return (da - db) * sortDir;
  });

  const tabCls = (t: string) =>
    tab === t
      ? 'px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-600 text-white'
      : 'px-2 py-0.5 text-[10px] font-bold rounded bg-gray-700 text-gray-400 hover:text-white';

  const filterCls = (active: boolean, bg: string) =>
    active ? `px-1 py-0 text-[8px] font-bold rounded ${bg} text-white` : 'px-1 py-0 text-[8px] font-bold rounded bg-gray-700/50 text-gray-500 hover:text-gray-300';

  const sortArrow = (col: string) => sortCol === col ? (sortDir === 1 ? '▲' : '▼') : '';
  const hCls = 'text-gray-500 py-0.5 px-1 cursor-pointer hover:text-white select-none';

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0">
      <div className="panel-header">
        <h3 className="text-sm font-bold text-gray-300 mb-1 flex items-center">
          <svg className="inline w-3.5 h-3.5 mr-1 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
          <span className="text-cyan-400">Smart Orders</span>
          <span className="no-drag flex gap-1 ml-2">
            <button onClick={() => handleSetTab('prog')} className={tabCls('prog')}>Active</button>
            <button onClick={() => handleSetTab('history')} className={tabCls('history')}>History</button>
          </span>
          {tab === 'prog' && (
            <span className="no-drag flex gap-0.5 ml-1">
              {[{ id: 'all', label: 'All' }, { id: 'anc', label: 'Anc' }, { id: 'loop', label: 'Loop' }].map((f) => (
                <button key={f.id} onClick={() => handleSetProgFilter(f.id)} className={filterCls(progFilter === f.id, 'bg-cyan-700')}>{f.label}</button>
              ))}
            </span>
          )}
          <span className="flex-1" />
          <button onClick={loadProgs} className="no-drag text-gray-500 hover:text-white transition" title="Refresh">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>
          </button>
        </h3>
      </div>

      <div className="panel-body text-[11px] flex-1 min-h-0 overflow-y-auto">
        {loading && <div className="text-gray-500 text-center py-4 pulse">Loading...</div>}

        {/* Prog / Closed tabs */}
        {!loading && tab === 'prog' && (
          filteredProgs.length === 0 ? (
            <div className="text-gray-500 text-center py-2 text-[10px]">
              {tab === 'prog' ? 'No active smart orders' : 'No closed/expired smart orders'}
            </div>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-gray-900 z-10">
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className={`${hCls} text-left`} style={{ width: 14 }} onClick={() => toggleSort('id')}>ID{sortArrow('id')}</th>
                  <th className={`${hCls} text-left`} onClick={() => toggleSort('date')}>Date{sortArrow('date')}</th>
                  <th className={`${hCls} text-left`} onClick={() => toggleSort('size')}>Leg{sortArrow('size')}</th>
                  <th className={`${hCls} text-right`}>Quote</th>
                  <th className={`${hCls} text-right`}>Inv</th>
                  <th className={`${hCls} text-right`}>Cost</th>
                  <th className="py-0.5 px-1" style={{ width: 20 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredProgs.map((p) => {
                  const legs = p.legs || [];
                  const dd = getDateDisplay(p.end_date);

                  // Tags
                  const autoTag = p.auto;
                  const loopTag = p.loop;

                  // Compute total effective quote
                  let totalEffective = 0;
                  let allLegsHavePrice = true;
                  for (const leg of legs) {
                    const fillPx = leg.computed_fill_price || 0;
                    const legFilled = leg.computed_filled || 0;
                    const isFilled = p.dollar_size ? (legFilled > 0 && !leg.order_id) : (p.size - legFilled) <= 1;
                    const effective = isFilled && fillPx > 0 ? fillPx : 0;
                    if (effective <= 0) allLegsHavePrice = false;
                    totalEffective += effective;
                  }
                  const totalQuoteStr = allLegsHavePrice ? (totalEffective * 100).toFixed(1) + '¢' : '--';
                  const edgeVal = allLegsHavePrice && legs.length > 1 ? 100 - totalEffective * 100 : null;
                  const edgeStr = edgeVal !== null ? edgeVal.toFixed(1) + '¢' : null;
                  const edgeColor = edgeVal !== null ? (edgeVal > 4 ? 'text-green-400' : edgeVal > 0 ? 'text-yellow-400' : 'text-red-400') : '';

                  // Total invested
                  const totalInv = legs.reduce((s, l) => s + (l.computed_filled || 0), 0);

                  // Size display
                  const sizeDisplay = p.dollar_size ? `$${p.dollar_size >= 1 ? p.dollar_size.toFixed(0) : p.dollar_size.toFixed(2)}` : String(p.size);

                  // Anchor tags
                  const anchorTags = legs.map((l) => {
                    const a = l.bs_anchor || '';
                    if (a.startsWith('bs1')) return '①';
                    if (a.startsWith('bs2')) return '②';
                    if (a.startsWith('px:')) return 'Ⓟ';
                    if (a.startsWith('bss:')) return 'Ⓢ';
                    return '';
                  }).filter(Boolean).join('');

                  // PnL for closed
                  const pnl = (p.revenue || 0) - (p.cost || 0);
                  const _pnlColor = pnl >= 0 ? 'text-green-400' : 'text-red-400';

                  return (
                    <React.Fragment key={p.id}>
                      {/* Header row */}
                      <tr className="border-b border-gray-700 bg-gray-800/50">
                        <td className="py-0.5 px-1 text-gray-500 font-mono whitespace-nowrap cursor-pointer" onClick={() => handleEditProg(p)}>
                          <span>{`#${p.id}`}</span>
                          {!!autoTag && <span className="text-[7px] px-0.5 rounded bg-emerald-900/60 text-emerald-400 ml-0.5">{`A${p.spread || ''}`}</span>}
                          {!!loopTag && <span className="text-[7px] px-0.5 rounded bg-blue-900/60 text-blue-400 ml-0.5">↻</span>}
                        </td>
                        <td className={`px-1 ${dd.color} whitespace-nowrap`}>{dd.label}</td>
                        <td className="px-1 text-gray-400 whitespace-nowrap">
                          {sizeDisplay}
                          {anchorTags && <span className="text-cyan-400 text-[8px] ml-0.5">{anchorTags}</span>}
                        </td>
                        <td className="text-right px-1 text-gray-400 whitespace-nowrap">
                          {totalQuoteStr}
                          {edgeStr && <span className={`ml-1 ${edgeColor}`}>{edgeStr}</span>}
                        </td>
                        <td className="text-right px-1 text-gray-400">{totalInv > 0 ? totalInv : ''}</td>
                        <td className="text-right px-1 text-gray-400">{p.cost > 0 ? `$${p.cost.toFixed(0)}` : ''}</td>
                        <td className="px-1 whitespace-nowrap">
                          <button onClick={() => handleCancelProg(p.id)} className="text-gray-500 hover:text-red-400" title="Cancel">✕</button>
                        </td>
                      </tr>
                      {/* Sub-rows per leg */}
                      {legs.map((leg) => {
                        const outcome = getTokenOutcome(leg.token_id, marketLookup) || 'YES';
                        const isNo = outcome === 'NO';
                        const legFilled = leg.computed_filled || 0;
                        const isFilled = p.dollar_size ? (legFilled > 0 && !leg.order_id) : (p.size - legFilled) <= 1;
                        const fillPriceStr = leg.computed_fill_price ? (leg.computed_fill_price * 100).toFixed(1) : '?';
                        const filledColor = legFilled > 0 ? 'text-cyan-400' : 'text-gray-500';
                        const legLabel = `${leg.asset} >${formatStrike(leg.strike)}`;

                        return (
                          <tr key={`${p.id}-${leg.leg_index}`} className="border-b border-gray-800 hover:bg-gray-700/30">
                            <td className="px-1"></td>
                            <td className="px-1"></td>
                            <td
                              className={`px-1 ${assetColor[leg.asset] || 'text-gray-300'} whitespace-nowrap truncate cursor-pointer hover:underline`}
                              onClick={() => handleMarketClick(leg.token_id, isNo ? 'NO' : 'YES')}
                            >
                              {isNo
                                ? <span className="text-[8px] px-0.5 rounded bg-red-900/50 text-red-400">N</span>
                                : <span className="text-[8px] px-0.5 rounded bg-green-900/50 text-green-400">Y</span>
                              }
                              {' '}{legLabel}
                            </td>
                            <td className="text-right px-1 whitespace-nowrap">
                              {isFilled ? (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-cyan-900/40 text-cyan-300">FILLED {fillPriceStr}¢</span>
                              ) : leg.order_id ? (
                                <span className="text-green-400">active</span>
                              ) : (
                                <span className="text-gray-600">--</span>
                              )}
                            </td>
                            <td className={`text-right px-1 ${filledColor}`}>{legFilled > 0 ? legFilled : ''}</td>
                            <td className="text-right px-1"></td>
                            <td className="px-1"></td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {/* Summary tab — drilldown-style per-prog list */}
        {!loading && tab === 'history' && (() => {
          if (!drilldownProgs) return <div className="text-gray-500 text-center py-2 text-[10px]">Loading...</div>;
          const filtered = hideEmpty ? drilldownProgs.filter(p => (p.bought_usd + p.sold_usd) > 0) : drilldownProgs;
          if (filtered.length === 0) return <div className="text-gray-500 text-center py-2 text-[10px]">No data{hideEmpty && drilldownProgs.length > 0 ? ' (all empty)' : ''}</div>;

          // Totals
          let tBoughtSh = 0, tBoughtUsd = 0, tSoldSh = 0, tSoldUsd = 0, tVol = 0, tPnl = 0, tInv = 0, tInvCost = 0;
          for (const p of filtered) {
            tBoughtSh += p.bought_shares; tBoughtUsd += p.bought_usd; tSoldSh += p.sold_shares; tSoldUsd += p.sold_usd;
            tVol += p.bought_usd + p.sold_usd; tPnl += p.pnl; tInv += (p.inv || 0); tInvCost += (p.inv_cost || 0);
          }
          const tAvgBuy = tBoughtSh > 0 ? (tBoughtUsd / tBoughtSh * 100).toFixed(1) : '--';
          const tAvgSell = tSoldSh > 0 ? (tSoldUsd / tSoldSh * 100).toFixed(1) : '--';
          const totalPnlColor = tPnl > 0 ? 'text-green-400' : tPnl < 0 ? 'text-red-400' : 'text-gray-500';

          // Group by end_date for date headers
          let lastDate = '';

          return (<>
            <div className="text-[10px] mb-1 px-1 flex items-center gap-3 text-gray-400">
              <span>{filtered.length}{hideEmpty && drilldownProgs.length > filtered.length ? `/${drilldownProgs.length}` : ''} progs</span>
              <span>Vol: <span className="text-white">${tVol.toFixed(2)}</span></span>
              <span>PnL: <span className={`font-bold ${totalPnlColor}`}>{tPnl >= 0 ? '+' : ''}${tPnl.toFixed(2)}</span></span>
              <span className="flex-1" />
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} className="w-3 h-3 accent-cyan-500" />
                <span className="text-gray-500">Hide empty</span>
              </label>
            </div>
            <table className="w-full text-[10px] whitespace-nowrap">
              <thead className="sticky top-0 bg-gray-900 z-10"><tr className="text-gray-500 border-b border-gray-700">
                {[
                  { label: 'ID', tip: 'Smart order ID', cls: 'text-left py-0.5' },
                  { label: 'Strike', tip: 'Strike prices for each leg', cls: 'text-left' },
                  { label: 'St', tip: 'Status: active, closed (claim/expiry), or cancelled', cls: 'text-left' },
                  { label: 'Size', tip: 'Order size (shares or dollar amount)', cls: 'text-right' },
                  { label: 'INV', tip: 'Current inventory — shares held (bought minus sold)', cls: 'text-right' },
                  { label: 'INV$', tip: 'Inventory cost — USD spent on current holdings', cls: 'text-right' },
                  { label: 'Lp', tip: 'Loop enabled — auto-rebuy after fills', cls: 'text-center' },
                  { label: 'AE', tip: 'Auto-sell enabled', cls: 'text-center' },
                  { label: 'B.Sh', tip: 'Total shares bought', cls: 'text-right' },
                  { label: 'Avg', tip: 'Average buy price in cents', cls: 'text-right' },
                  { label: 'B.$', tip: 'Total USD spent buying', cls: 'text-right' },
                  { label: 'S.Sh', tip: 'Total shares sold', cls: 'text-right' },
                  { label: 'Avg', tip: 'Average sell price in cents', cls: 'text-right' },
                  { label: 'S.$', tip: 'Total USD received from selling', cls: 'text-right' },
                  { label: 'Vol', tip: 'Total volume — bought USD + sold USD', cls: 'text-right' },
                  { label: 'PnL', tip: 'Profit/Loss — sold USD minus bought USD', cls: 'text-right' },
                ].map((h, i) => (
                  <th key={i} className={`${h.cls} px-1`}>
                    <ColTip label={h.label} tip={h.tip} className="cursor-help border-b border-dotted border-gray-600" />
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.map((p) => {
                  const avgBuy = p.bought_shares > 0 ? (p.bought_usd / p.bought_shares * 100).toFixed(1) : '--';
                  const avgSell = p.sold_shares > 0 ? (p.sold_usd / p.sold_shares * 100).toFixed(1) : '--';
                  const vol = p.bought_usd + p.sold_usd;
                  const pnlColor = p.pnl > 0 ? 'text-green-400' : p.pnl < 0 ? 'text-red-400' : 'text-gray-500';
                  const statusColor = p.status === 'closed' ? (p.close_reason === 'claim' ? 'text-green-400' : p.close_reason === 'expiry' ? 'text-red-400' : 'text-gray-400') : p.status === 'cancelled' ? 'text-red-400' : 'text-cyan-400';
                  const statusLabel = p.status === 'closed' ? (p.close_reason || 'closed') : p.status;
                  const sizeStr = p.isDollar ? `$${p.size}` : String(p.size);
                  const loopBadge = p.loop ? <span className="text-blue-400">✓</span> : <span className="text-gray-600">–</span>;
                  const aeBadge = p.auto_sell ? <span className="text-yellow-400">✓</span> : <span className="text-gray-600">–</span>;

                  // Date separator row
                  let dateRow: React.ReactNode = null;
                  const ed = p.end_date || '';
                  if (ed !== lastDate) {
                    lastDate = ed;
                    const dt = ed ? new Date(ed) : null;
                    const dateLabel = dt ? dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—';
                    dateRow = (
                      <tr key={`date-${ed}`} className="bg-gray-700/40">
                        <td colSpan={16} className="py-0.5 px-1 text-gray-300 font-bold text-[10px]">{dateLabel}</td>
                      </tr>
                    );
                  }

                  return (
                    <React.Fragment key={p.id}>
                      {dateRow}
                      <tr className="border-b border-gray-800 cursor-pointer hover:bg-gray-700/30" onClick={() => setEditProgArb({ id: p.id } as ProgArb)}>
                        <td className="py-0.5 px-1 text-gray-400 font-mono">#{p.id}</td>
                        <td className={`px-1 ${assetColor[p.asset || ''] || 'text-gray-300'}`}>{p.strikes}</td>
                        <td className={`px-1 ${statusColor}`}>{statusLabel}</td>
                        <td className="text-right px-1 text-gray-400">{sizeStr}</td>
                        <td className="text-right px-1 text-white font-bold">{p.inv || 0}</td>
                        <td className="text-right px-1 text-yellow-400">${(p.inv_cost || 0).toFixed(2)}</td>
                        <td className="text-center px-1">{loopBadge}</td>
                        <td className="text-center px-1">{aeBadge}</td>
                        <td className="text-right px-1 text-gray-400">{p.bought_shares}</td>
                        <td className="text-right px-1 text-gray-400">{avgBuy}¢</td>
                        <td className="text-right px-1 text-gray-400">${p.bought_usd.toFixed(2)}</td>
                        <td className="text-right px-1 text-gray-400">{p.sold_shares}</td>
                        <td className="text-right px-1 text-gray-400">{avgSell}¢</td>
                        <td className="text-right px-1 text-gray-400">${p.sold_usd.toFixed(2)}</td>
                        <td className="text-right px-1 text-gray-300">${vol.toFixed(2)}</td>
                        <td className={`text-right px-1 ${pnlColor} font-bold`}>{p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}</td>
                      </tr>
                    </React.Fragment>
                  );
                })}
                {/* Totals row */}
                <tr className="border-t border-gray-600 font-bold sticky bottom-0 bg-gray-900">
                  <td className="py-0.5 px-1 text-gray-400" colSpan={3}>Total ({filtered.length}{hideEmpty && drilldownProgs.length > filtered.length ? `/${drilldownProgs.length}` : ''})</td>
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
                  <td className={`text-right px-1 ${totalPnlColor}`}>{tPnl >= 0 ? '+' : ''}${tPnl.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </>);
        })()}
      </div>

    </div>
  );
}
