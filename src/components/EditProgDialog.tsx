import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  fetchProgTrades, fetchProgErrors, cancelProgArb, updateProgSize, updateProgExpiry,
  updateProgAutoSell, updateProgLoop, updateProgAnchor, fetchArbProgs, fetchOrderbook,
} from '../api';
import { useAppStore } from '../stores/appStore';
import { showToast } from '../utils/toast';
import { getTokenOutcome } from '../utils/format';
import type { ProgArb, ProgLeg } from '../types';

const AC: Record<string, string> = { BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400' };
const LC = ['text-green-400', 'text-red-400', 'text-purple-400'];

function fmtStrike(s: string): string {
  const n = parseFloat(s.replace(/[^0-9.-]/g, ''));
  if (isNaN(n)) return s;
  return n >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k' : n.toString();
}

function fmtDate(d?: string): { text: string; cls: string } {
  if (!d) return { text: '--', cls: 'text-gray-500' };
  const ed = new Date(d), h = (ed.getTime() - Date.now()) / 3600000;
  const da = ['Su','Mo','Tu','We','Th','Fr','Sa'][ed.getDay()];
  if (h > 0 && h < 24) return { text: 'TODAY', cls: 'text-red-400 font-bold' };
  if (h >= 24 && h < 48) return { text: 'TMR', cls: 'text-yellow-400 font-bold' };
  return { text: `${da} ${ed.getDate()}`, cls: ed.getDay() === 0 || ed.getDay() === 6 ? 'text-purple-400' : 'text-gray-400' };
}

function fmtAnchor(a: string): { label: string; cls: string } {
  if (!a) return { label: '--', cls: 'text-gray-600' };
  if (a.startsWith('bs1') || a.startsWith('bs2')) {
    const base = a.startsWith('bs1') ? 'BS1' : 'BS2';
    const bg = a.startsWith('bs1') ? 'bg-cyan-900/50 text-cyan-300' : 'bg-pink-900/50 text-pink-400';
    let suf = '';
    if (a.includes('+p:')) suf = ' +' + (parseFloat(a.split('+p:')[1]) || 5) + '¢';
    else if (a.includes('+pct:')) suf = ' +' + (parseFloat(a.split('+pct:')[1]) || 10) + '%';
    else if (a.includes('-p:')) suf = ' -' + (parseFloat(a.split('-p:')[1]) || 5) + '¢';
    else if (a.includes('-pct:')) suf = ' -' + (parseFloat(a.split('-pct:')[1]) || 10) + '%';
    const minV = a.includes(':min') ? parseFloat(a.split(':min')[1]) || 0 : 0;
    const maxV = a.includes(':max') ? parseFloat(a.split(':max')[1]) || 0 : 0;
    if (minV > 0) suf += ` ≥${minV}¢`;
    if (maxV > 0) suf += ` ≤${maxV}¢`;
    return { label: base + suf, cls: `text-[10px] px-1 rounded ${bg} font-bold` };
  }
  if (a.startsWith('px:')) return { label: `PX ${(parseFloat(a.split(':')[1]) * 100).toFixed(1)}¢`, cls: 'text-[10px] px-1 rounded bg-yellow-900/50 text-yellow-400 font-bold' };
  if (a.startsWith('bss:')) {
    const sp = parseFloat(a.split('bss:')[1]) || 10;
    let suf = '';
    const minV = a.includes(':min') ? parseFloat(a.split(':min')[1]) || 0 : 0;
    const maxV = a.includes(':max') ? parseFloat(a.split(':max')[1]) || 0 : 0;
    if (minV > 0) suf += ` ≥${minV}¢`;
    if (maxV > 0) suf += ` ≤${maxV}¢`;
    return { label: `BSS ${sp}%${suf}`, cls: 'text-[10px] px-1 rounded bg-orange-900/50 text-orange-400 font-bold' };
  }
  return { label: '--', cls: 'text-gray-600' };
}

function parseAnchorToEdit(anchorVal: string) {
  let mode = 'manual', minVal = '0', maxVal = '', arg = '5', bss = '10', px = '';
  if (anchorVal.includes(':min')) { const afterMin = anchorVal.split(':min')[1] || '0'; minVal = afterMin.split(':max')[0]; }
  if (anchorVal.includes(':max')) { maxVal = anchorVal.split(':max')[1]; }
  if (anchorVal.startsWith('bs1')) {
    if (anchorVal.includes('+p:')) { mode = 'bs1_plus_p'; arg = String(parseFloat(anchorVal.split('+p:')[1]) || 5); }
    else if (anchorVal.includes('+pct:')) { mode = 'bs1_plus_pct'; arg = String(parseFloat(anchorVal.split('+pct:')[1]) || 10); }
    else if (anchorVal.includes('-p:')) { mode = 'bs1_minus_p'; arg = String(parseFloat(anchorVal.split('-p:')[1]) || 5); }
    else if (anchorVal.includes('-pct:')) { mode = 'bs1_minus_pct'; arg = String(parseFloat(anchorVal.split('-pct:')[1]) || 10); }
    else mode = 'bs1';
  } else if (anchorVal.startsWith('bs2')) {
    if (anchorVal.includes('+p:')) { mode = 'bs2_plus_p'; arg = String(parseFloat(anchorVal.split('+p:')[1]) || 5); }
    else if (anchorVal.includes('+pct:')) { mode = 'bs2_plus_pct'; arg = String(parseFloat(anchorVal.split('+pct:')[1]) || 10); }
    else if (anchorVal.includes('-p:')) { mode = 'bs2_minus_p'; arg = String(parseFloat(anchorVal.split('-p:')[1]) || 5); }
    else if (anchorVal.includes('-pct:')) { mode = 'bs2_minus_pct'; arg = String(parseFloat(anchorVal.split('-pct:')[1]) || 10); }
    else mode = 'bs2';
  } else if (anchorVal.startsWith('px:')) { mode = 'px'; px = (parseFloat(anchorVal.split(':')[1]) * 100).toFixed(1); }
  else if (anchorVal.startsWith('bss:')) { mode = 'bss'; bss = String(parseFloat(anchorVal.split('bss:')[1]) || 10); }
  return { mode, minVal, maxVal, arg, bss, px };
}

function buildAnchorString(mode: string, arg: string, minVal: string, maxVal: string, bss: string, px: string): { anchor: string | null; label: string } {
  let anchor: string | null = null;
  let label = 'Manual';
  if (mode === 'bs1' || mode === 'bs2') { anchor = mode; label = mode.toUpperCase(); }
  else if (mode === 'bs1_plus_p' || mode === 'bs2_plus_p') { const b = mode.startsWith('bs1') ? 'bs1' : 'bs2'; const a = parseFloat(arg) || 5; anchor = `${b}+p:${a}`; label = `${b.toUpperCase()}+${a}¢`; }
  else if (mode === 'bs1_plus_pct' || mode === 'bs2_plus_pct') { const b = mode.startsWith('bs1') ? 'bs1' : 'bs2'; const a = parseFloat(arg) || 10; anchor = `${b}+pct:${a}`; label = `${b.toUpperCase()}+${a}%`; }
  else if (mode === 'bs1_minus_p' || mode === 'bs2_minus_p') { const b = mode.startsWith('bs1') ? 'bs1' : 'bs2'; const a = parseFloat(arg) || 5; anchor = `${b}-p:${a}`; label = `${b.toUpperCase()}-${a}¢`; }
  else if (mode === 'bs1_minus_pct' || mode === 'bs2_minus_pct') { const b = mode.startsWith('bs1') ? 'bs1' : 'bs2'; const a = parseFloat(arg) || 10; anchor = `${b}-pct:${a}`; label = `${b.toUpperCase()}-${a}%`; }
  else if (mode === 'px') { const c = parseFloat(px); if (isNaN(c) || c <= 0 || c >= 100) return { anchor: null, label: 'invalid' }; anchor = 'px:' + (c / 100); label = `PX ${c.toFixed(1)}¢`; }
  else if (mode === 'bss') { const s = parseFloat(bss) || 10; anchor = 'bss:' + s; label = `BSS ${s}%`; }
  if (anchor && mode !== 'manual' && mode !== 'px') {
    const mn = parseFloat(minVal) || 0;
    const mx = parseFloat(maxVal) || 0;
    anchor += ':min' + mn + (mx > 0 ? ':max' + mx : '');
    if (mn > 0) label += ` ≥${mn}¢`;
    if (mx > 0) label += ` ≤${mx}¢`;
  }
  return { anchor, label };
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `${dateStr} ${timeStr}`;
}

function fmtElapsed(ms: number): string {
  const age = Date.now() - ms;
  if (age < 60000) return '<1m';
  if (age < 3600000) return Math.floor(age / 60000) + 'm';
  if (age < 86400000) return Math.floor(age / 3600000) + 'h';
  return Math.floor(age / 86400000) + 'd';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

function stopAll(e: React.MouseEvent | React.PointerEvent) { e.stopPropagation(); }

export function EditProgDialog() {
  const initialProg = useAppStore((s) => s.editProgArb);
  const setEditProgArb = useAppStore((s) => s.setEditProgArb);
  const setProgArbs = useAppStore((s) => s.setProgArbs);
  const marketLookup = useAppStore((s) => s.marketLookup);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);

  const [prog, setProg] = useState<ProgArb | null>(null);
  const [rawTrades, setRawTrades] = useState<AnyRec[]>([]);
  const [progOrders, setProgOrders] = useState<AnyRec[]>([]);
  const [progErrors, setProgErrors] = useState<AnyRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'trades' | 'orders' | 'errors'>('trades');
  const [editingAnchor, setEditingAnchor] = useState<number | null>(null);
  const [aeMode, setAeMode] = useState('manual');
  const [aeArg, setAeArg] = useState('5');
  const [aeMin, setAeMin] = useState('0');
  const [aeMax, setAeMax] = useState('');
  const [aeBss, setAeBss] = useState('10');
  const [aePx, setAePx] = useState('');
  const [legOrderbooks, setLegOrderbooks] = useState<Record<number, { bestBid: number }>>({});
  const [editingInv, setEditingInv] = useState(false);
  const [invVal, setInvVal] = useState('');

  const [sizeVal, setSizeVal] = useState('');
  const [expiryVal, setExpiryVal] = useState('150');
  const [autoSell, setAutoSell] = useState(false);
  const [autoSellMode, setAutoSellMode] = useState('bs1');
  const [autoSellPrice, setAutoSellPrice] = useState('');
  const [autoSellSpread, setAutoSellSpread] = useState('10');
  const [loopEnabled, setLoopEnabled] = useState(false);

  const onClose = useCallback(() => setEditProgArb(null), [setEditProgArb]);

  const onRefresh = useCallback(async () => {
    try {
      const data = await fetchArbProgs('active,filled,closed') as { progs?: ProgArb[] };
      if (data.progs) setProgArbs(data.progs as never[]);
    } catch { /* ignore */ }
  }, [setProgArbs]);

  const progId = initialProg ? Math.round(initialProg.id) : 0;

  const reload = useCallback(async () => {
    if (!progId) return;
    try {
      const [data, errData] = await Promise.all([fetchProgTrades(progId), fetchProgErrors(progId)]);
      if (data.prog) {
        const p = data.prog as ProgArb;
        setProg(p);
        setSizeVal(String(p.dollar_size || p.size || 0));
        setExpiryVal(String(p.expiry_minutes || 150));
        setAutoSell(p.auto_sell || false);
        setAutoSellMode(p.auto_sell_mode || 'bs1');
        setAutoSellPrice(p.auto_sell_price ? String((p.auto_sell_price * 100).toFixed(1)) : '');
        setAutoSellSpread(String(p.auto_sell_spread || 10));
        setLoopEnabled(p.loop || false);
      }
      setRawTrades((data.rawTrades || []) as AnyRec[]);
      setProgOrders((data.progOrders || []) as AnyRec[]);
      setProgErrors((errData.errors || []) as AnyRec[]);
      // Fetch orderbooks per leg for Sell column
      const progLegs = (data.prog as ProgArb)?.legs || [];
      const obResults: Record<number, { bestBid: number }> = {};
      await Promise.all(progLegs.map(async (l: ProgLeg, idx: number) => {
        try {
          const ob = await fetchOrderbook(l.token_id);
          const bids = (ob.bids || []).filter((b: { price: string }) => parseFloat(b.price) > 0).sort((a: { price: string }, b: { price: string }) => parseFloat(b.price) - parseFloat(a.price));
          obResults[idx] = { bestBid: bids.length > 0 ? parseFloat(bids[0].price) : 0 };
        } catch { obResults[idx] = { bestBid: 0 }; }
      }));
      setLegOrderbooks(obResults);
    } catch { /* ignore */ }
  }, [progId]);

  useEffect(() => {
    if (!initialProg) { setProg(null); return; }
    setProg(initialProg);
    setSizeVal(String(initialProg.dollar_size || initialProg.size || 0));
    setExpiryVal(String(initialProg.expiry_minutes || 150));
    setAutoSell(initialProg.auto_sell || false);
    setAutoSellMode(initialProg.auto_sell_mode || 'bs1');
    setAutoSellPrice(initialProg.auto_sell_price ? String((initialProg.auto_sell_price * 100).toFixed(1)) : '');
    setAutoSellSpread(String(initialProg.auto_sell_spread || 10));
    setLoopEnabled(initialProg.loop || false);
    setLoading(true);
    setTab('trades');
    setEditingAnchor(null);
    setEditingInv(false);
    reload().then(() => setLoading(false));
  }, [initialProg, reload]);

  if (!initialProg || !prog) return null;

  const isDollar = !!prog.dollar_size;
  const legs: ProgLeg[] = prog.legs || [];
  const isExpired = prog.end_date && new Date(prog.end_date).getTime() < Date.now();
  const displayStatus = prog.status === 'active' && isExpired ? 'EXPIRED' : (prog.status || '').toUpperCase();
  const statusColor = displayStatus === 'EXPIRED' ? 'text-orange-400' : prog.status === 'cancelled' ? 'text-red-400' : prog.status === 'closed' ? 'text-gray-400' : 'text-cyan-400';
  const dl = fmtDate(prog.end_date);
  const totalInv = legs.reduce((s, l) => s + (l.computed_filled || 0), 0);
  const totalInvCost = legs.reduce((s, l) => s + (l.computed_filled || 0) * (l.computed_fill_price || 0), 0);

  const orderLegMap: Record<string, number> = {};
  const orderSideMap: Record<string, string> = {};
  for (const o of progOrders) { orderLegMap[o.order_id] = o.leg; orderSideMap[o.order_id] = o.side || 'BUY'; }

  const p = prog as AnyRec;
  const sumBuyShares = p.bought_shares || 0;
  const sumSellShares = p.sold_shares || 0;
  const sumBuyUsd = p.bought_usd || 0;
  const sumSellUsd = p.sold_usd || 0;
  const avgBuy = sumBuyShares > 0 ? (sumBuyUsd / sumBuyShares * 100).toFixed(1) + '¢' : '--';
  const avgSell = sumSellShares > 0 ? (sumSellUsd / sumSellShares * 100).toFixed(1) + '¢' : '--';
  const pnl = sumSellUsd - sumBuyUsd;
  const pnlColor = pnl > 0 ? 'text-green-400' : pnl < 0 ? 'text-red-400' : 'text-gray-400';

  const handleSaveSize = async () => { const v = parseFloat(sizeVal) || 0; if (v <= 0) return; const ok = isDollar ? await updateProgSize(progId, undefined, v) : await updateProgSize(progId, Math.floor(v)); showToast(ok ? `Size → ${isDollar ? '$' : ''}${v}` : 'Size save failed', ok ? 'success' : 'error'); };
  const handleSaveExpiry = async () => { const v = parseInt(expiryVal) || 150; const ok = await updateProgExpiry(progId, v); showToast(ok ? `Expiry → ${v} min` : 'Expiry save failed', ok ? 'success' : 'error'); };
  const handleSaveAutoSell = async () => {
    const price = autoSellMode === 'price' ? (parseFloat(autoSellPrice) || 0) / 100 : null;
    let spread: number | null = null;
    if (['bss', 'ent_pct', 'ent_price', 'bs1_pct', 'bs2_pct'].includes(autoSellMode)) spread = parseFloat(autoSellSpread) || 10;
    const ok = await updateProgAutoSell(progId, { autoSell, mode: autoSellMode, price: price && price > 0 ? price : null, spread });
    showToast(ok ? `Auto-sell → ${autoSell ? autoSellMode : 'off'}` : 'Auto-sell save failed', ok ? 'success' : 'error');
  };
  const handleSaveLoop = async (val: boolean) => { setLoopEnabled(val); const ok = await updateProgLoop(progId, val); showToast(ok ? `Loop → ${val ? 'on' : 'off'}` : 'Loop save failed', ok ? 'success' : 'error'); };
  const handleCancel = async () => { if (!confirm(`Cancel smart order #${progId}?`)) return; const r = await cancelProgArb(progId); if (r.success) { showToast(`Smart order #${progId} cancelled`, 'success'); onRefresh(); onClose(); } else showToast(r.error || 'Cancel failed', 'error'); };

  const openAnchorEdit = (legIdx: number) => {
    const leg = legs[legIdx];
    const parsed = parseAnchorToEdit(leg?.bs_anchor || '');
    setAeMode(parsed.mode); setAeArg(parsed.arg); setAeMin(parsed.minVal); setAeMax(parsed.maxVal); setAeBss(parsed.bss); setAePx(parsed.px);
    setEditingAnchor(legIdx);
  };

  const confirmAnchorEdit = async (legIdx: number) => {
    const { anchor, label } = buildAnchorString(aeMode, aeArg, aeMin, aeMax, aeBss, aePx);
    if (label === 'invalid') { showToast('PX price must be 0.1–99.9¢', 'error'); return; }
    const ok = await updateProgAnchor(progId, legIdx, anchor);
    if (ok) { showToast(`#${progId} L${legIdx} anchor → ${label}`, 'success'); setEditingAnchor(null); reload(); }
    else showToast('Anchor update failed', 'error');
  };

  const isBsMode = (m: string) => m !== 'manual' && m !== 'px';
  const exitNeedsPrice = autoSellMode === 'price';
  const exitNeedsSpread = ['bss', 'ent_pct', 'ent_price', 'bs1_pct', 'bs2_pct'].includes(autoSellMode);
  const tabCls = (_: string, active: boolean) => `px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${active ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-500'}`;

  return createPortal(
    <div className="fixed inset-0 bg-black/60 z-[50000] flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-gray-800 rounded-lg p-5 max-w-lg w-full mx-4 shadow-xl border border-gray-700 text-white"
        onMouseDown={stopAll} onPointerDown={stopAll}>
        {/* Title */}
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold text-cyan-400">
            Smart Order #{progId} <span className={`text-xs ml-1 ${statusColor}`}>{displayStatus}</span>
            {(prog.status !== 'cancelled' && prog.status !== 'closed') && (
              <button onClick={handleCancel} className="ml-2 px-2 py-0.5 text-[10px] bg-red-900/50 hover:bg-red-800 text-red-400 hover:text-white rounded transition font-bold">Cancel</button>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">&times;</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-6 w-6 border-2 border-cyan-400 border-t-transparent rounded-full" />
          </div>
        ) : (<>
          {/* Summary row */}
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-2 flex-wrap">
            <span className={dl.cls}>{dl.text}</span> · <span className="text-[10px] text-gray-400">Size:</span>
            <input type="number" value={sizeVal} onChange={(e) => setSizeVal(e.target.value)} onBlur={handleSaveSize}
              className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-16 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
            · <span className="text-[10px] text-gray-400">INV:</span>
            {editingInv ? (
              <span className="flex items-center gap-0.5">
                <input type="number" value={invVal} onChange={(e) => setInvVal(e.target.value)} autoFocus
                  className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-16 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
                <button onClick={async () => { const v = parseInt(invVal) || 0; const ok = await updateProgSize(progId, v); if (ok) { showToast(`INV → ${v}`, 'success'); setEditingInv(false); reload(); } else showToast('Save failed', 'error'); }} className="text-[9px] px-1 py-0 rounded bg-green-700 hover:bg-green-600 text-white font-bold">✓</button>
                <button onClick={() => setEditingInv(false)} className="text-[9px] px-1 py-0 rounded bg-gray-700 text-gray-400 hover:text-white">✕</button>
              </span>
            ) : (
              <span className="text-white text-[11px] font-bold cursor-pointer hover:underline" onClick={() => { setInvVal(String(totalInv)); setEditingInv(true); }}>{totalInv > 0 ? totalInv.toLocaleString() : '0'}</span>
            )}
            · <span className="text-[10px] text-gray-400">INV$:</span> <span className="text-yellow-400 text-[11px] font-bold">${totalInvCost > 0 ? totalInvCost.toFixed(2) : '0'}</span>
          </div>

          {/* Settings row */}
          <div className="flex items-center gap-2 mb-3 flex-wrap text-[10px]">
            <span className="text-gray-400">Exp:</span>
            <input type="number" value={expiryVal} onChange={(e) => setExpiryVal(e.target.value)} onBlur={handleSaveExpiry}
              className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-12 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
            <span className="text-gray-500">min</span>
            <span className="text-gray-600">|</span>
            <label className="flex items-center gap-1 text-gray-400 cursor-pointer"><input type="checkbox" checked={autoSell} onChange={(e) => setAutoSell(e.target.checked)} className="w-3 h-3 accent-yellow-500" /> Auto Exit</label>
            <label className="flex items-center gap-1 text-gray-400 cursor-pointer"><input type="checkbox" checked={loopEnabled} onChange={(e) => handleSaveLoop(e.target.checked)} className="w-3 h-3 accent-blue-500" /> Loop</label>
            {autoSell && (<>
              <select value={autoSellMode} onChange={(e) => setAutoSellMode(e.target.value)} className="bg-gray-700 border border-gray-600 rounded px-1 py-0 text-[10px] text-white" style={{ outline: 'none' }}>
                <option value="price">Fixed Price</option>
                <optgroup label="── AT BS ──"><option value="bs1">BS1 max</option><option value="bs2">BS2 max</option><option value="bss">BS+Spread</option></optgroup>
                <optgroup label="── ▲ ABOVE ENTRY ──"><option value="ent_pct">Entry + %</option><option value="ent_price">Entry + ¢</option></optgroup>
                <optgroup label="── ▼ BELOW BS ──"><option value="bs1_pct">BS1 − %</option><option value="bs2_pct">BS2 − %</option></optgroup>
              </select>
              {exitNeedsPrice && <input type="number" value={autoSellPrice} onChange={(e) => setAutoSellPrice(e.target.value)} className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-14 text-[10px] text-white no-spin" style={{ outline: 'none' }} placeholder="¢" />}
              {exitNeedsSpread && <span className="flex items-center gap-0.5"><input type="number" value={autoSellSpread} onChange={(e) => setAutoSellSpread(e.target.value)} className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-10 text-[10px] text-white no-spin" style={{ outline: 'none' }} /><span className="text-[9px] text-gray-500">{autoSellMode === 'ent_price' ? '¢' : '%'}</span></span>}
              <button onClick={handleSaveAutoSell} className="px-1.5 py-0 text-[9px] bg-yellow-800 hover:bg-yellow-700 text-yellow-300 rounded transition">Save</button>
            </>)}
          </div>

          {/* Legs table */}
          <table className="w-full text-[11px] mb-3">
            <thead><tr className="text-gray-500 border-b border-gray-700">
              <th className="text-left py-0.5 px-1">Leg</th><th className="px-1"></th><th className="text-left px-1">Anchor</th><th className="text-right px-1">Quote</th><th className="text-right px-1 text-cyan-600">BS1</th><th className="text-right px-1 text-pink-600">BS2</th><th className="text-right px-1">Inv</th><th className="text-right px-1">Sell</th>
            </tr></thead>
            <tbody>
              {legs.map((leg, i) => {
                const filled = leg.computed_filled || 0;
                const isFilled = isDollar ? (filled > 0 && !leg.order_id) : (prog.size > 0 && (prog.size - filled) <= 1);
                const fillPrice = leg.computed_fill_price ? (leg.computed_fill_price * 100).toFixed(1) : '?';
                const anc = fmtAnchor(leg.bs_anchor || '');
                let quoteStr: string;
                if (isFilled) quoteStr = `FILLED ${fillPrice}¢`;
                else if (leg.order_id) quoteStr = 'active';
                else quoteStr = '--';
                const quoteColor = isFilled ? 'text-cyan-300' : leg.order_id ? 'text-white' : 'text-gray-600';
                const legAny = leg as AnyRec;
                const bs1 = legAny.bs1_prob != null ? (legAny.bs1_prob * 100).toFixed(1) : '-';
                const bs2 = legAny.bs2_prob != null ? (legAny.bs2_prob * 100).toFixed(1) : '-';
                const ob = legOrderbooks[i];
                const bestBid = ob?.bestBid || 0;
                const sellStr = filled > 0 && bestBid > 0 ? (bestBid * 100).toFixed(1) + '¢' : '--';
                const sellColor = filled > 0 && bestBid > 0 ? 'text-yellow-300' : 'text-gray-600';
                return (
                  <tr key={i} className="border-b border-gray-800">
                    <td className="py-0.5 px-1">
                      <span className={`${LC[i] || 'text-gray-400'} font-bold mr-1`}>L{i}</span>
                      <span className={`${AC[leg.asset] || 'text-gray-300'} cursor-pointer hover:underline`} onClick={() => {
                        const m = marketLookup[leg.token_id];
                        if (m) {
                          setSelectedMarket(m);
                          setSidebarOutcome(getTokenOutcome(leg.token_id, marketLookup) === 'NO' ? 'NO' : 'YES');
                          setSidebarOpen(true);
                        }
                      }}>{leg.asset} &gt;{fmtStrike(leg.strike)}</span>
                    </td>
                    <td className="px-1">{(() => { const o = getTokenOutcome(leg.token_id, marketLookup); return o === 'NO' ? <span className="text-[8px] px-0.5 rounded bg-red-900/50 text-red-400">N</span> : <span className="text-[8px] px-0.5 rounded bg-green-900/50 text-green-400">Y</span>; })()}</td>
                    <td className="px-1">
                      <span className={`${anc.cls} cursor-pointer hover:brightness-125`} onClick={() => openAnchorEdit(i)}>{anc.label}</span>
                      {editingAnchor === i && (
                        <div className="mt-1">
                          <div className="flex items-center gap-0.5 flex-wrap">
                            <select value={aeMode} onChange={(e) => setAeMode(e.target.value)} className="bg-gray-700 border border-gray-600 rounded px-1 py-0 text-[10px] text-white" style={{ outline: 'none' }}>
                              <option value="manual">Manual</option>
                              <option value="px">PX (fixed price)</option>
                              <optgroup label="── AT BS ──"><option value="bs1">BS1 min</option><option value="bs2">BS2 min</option><option value="bss">BS-Spread</option></optgroup>
                              <optgroup label="── ▼ BELOW BS (discount) ──"><option value="bs1_minus_p">BS1 − ¢</option><option value="bs1_minus_pct">BS1 − %</option><option value="bs2_minus_p">BS2 − ¢</option><option value="bs2_minus_pct">BS2 − %</option></optgroup>
                              <optgroup label="── ▲ ABOVE BS (premium) ──"><option value="bs1_plus_p">BS1 + ¢</option><option value="bs1_plus_pct">BS1 + %</option><option value="bs2_plus_p">BS2 + ¢</option><option value="bs2_plus_pct">BS2 + %</option></optgroup>
                            </select>
                            {isBsMode(aeMode) && (
                              <span className="flex items-center gap-0.5">
                                <span className="text-[10px] text-gray-500">min</span>
                                <input type="number" value={aeMin} onChange={(e) => setAeMin(e.target.value)} min="0.1" max="99" step="0.1" className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-10 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
                                <span className="text-[10px] text-gray-500">¢ max</span>
                                <input type="number" value={aeMax} onChange={(e) => setAeMax(e.target.value)} min="0.1" max="99" step="0.1" placeholder="--" className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-10 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
                                <span className="text-[10px] text-gray-500">¢</span>
                              </span>
                            )}
                            {(aeMode.includes('plus') || aeMode.includes('minus')) && (
                              <span className="flex items-center gap-0.5">
                                <input type="number" value={aeArg} onChange={(e) => setAeArg(e.target.value)} min="0.1" max="200" step="0.1" className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-10 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
                                <span className="text-[10px] text-gray-500">{aeMode.endsWith('_pct') ? '%' : '¢'}</span>
                              </span>
                            )}
                            {aeMode === 'bss' && (
                              <span className="flex items-center gap-0.5">
                                <input type="number" value={aeBss} onChange={(e) => setAeBss(e.target.value)} min="1" max="50" step="1" className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-10 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
                                <span className="text-[10px] text-gray-500">%</span>
                              </span>
                            )}
                            {aeMode === 'px' && (
                              <span className="flex items-center gap-0.5">
                                <input type="text" value={aePx} onChange={(e) => setAePx(e.target.value)} placeholder="¢" className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-12 text-[10px] text-yellow-400 font-mono" style={{ outline: 'none' }} />
                                <span className="text-[10px] text-gray-500">¢</span>
                              </span>
                            )}
                            <button onClick={() => confirmAnchorEdit(i)} className="text-[9px] px-1.5 py-0.5 rounded bg-green-700 hover:bg-green-600 text-white font-bold">✓</button>
                            <button onClick={() => setEditingAnchor(null)} className="text-[9px] px-1 py-0.5 rounded bg-gray-700 text-gray-400 hover:text-white">✕</button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className={`text-right px-1 ${quoteColor}`}>{isFilled ? <span className="text-[9px] px-1 py-0.5 rounded bg-cyan-900/40">{quoteStr}</span> : quoteStr}</td>
                    <td className="text-right px-1 text-cyan-300">{bs1}</td>
                    <td className="text-right px-1 text-pink-400">{bs2}</td>
                    <td className={`text-right px-1 ${filled > 0 ? 'text-cyan-400' : 'text-gray-500'}`}>{filled}</td>
                    <td className={`text-right px-1 ${sellColor}`}>{sellStr}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Buy/Sell summary */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] mt-1 mb-1 px-1 py-1 bg-gray-800/50 rounded border border-gray-700/50">
            <span className="text-gray-500">Bought <span className="text-white font-bold">{sumBuyShares.toLocaleString()}</span> sh @ <span className="text-white">{avgBuy}</span> = <span className="text-white">${sumBuyUsd.toFixed(2)}</span></span>
            <span className="text-gray-500">Sold <span className="text-white font-bold">{sumSellShares.toLocaleString()}</span> sh @ <span className="text-white">{avgSell}</span> = <span className="text-white">${sumSellUsd.toFixed(2)}</span></span>
            <span className="text-gray-500">PnL <span className={`${pnlColor} font-bold`}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span></span>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-2 mb-1">
            <button className={tabCls('trades', tab === 'trades')} onClick={() => setTab('trades')}>Trades ({rawTrades.length})</button>
            <button className={tabCls('orders', tab === 'orders')} onClick={() => setTab('orders')}>Orders ({progOrders.length})</button>
            <button className={`${tabCls('errors', tab === 'errors')} ${progErrors.length > 0 && tab !== 'errors' ? '!bg-red-900/50 !text-red-400' : ''}`} onClick={() => setTab('errors')}>Errors ({progErrors.length})</button>
          </div>

          {/* Trades panel */}
          {tab === 'trades' && (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {rawTrades.length === 0 ? <div className="text-gray-500 text-center py-2 text-xs">No trades yet</div> : (
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-gray-800 z-10"><tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-0.5 px-1">Time</th><th className="text-left px-1">Leg</th><th className="text-left px-1">Side</th><th className="text-right px-1">Price</th><th className="text-right px-1">Size</th><th className="text-right px-1">Cost</th><th className="text-left px-1">Role</th>
                  </tr></thead>
                  <tbody>{rawTrades.map((t, i) => {
                    let tradeMs = 0;
                    if (t.match_time) { tradeMs = Number(t.match_time); if (tradeMs < 1e12) tradeMs *= 1000; }
                    else if (t.created_at) tradeMs = new Date(t.created_at + 'Z').getTime();
                    const isMaker = orderLegMap[t.maker_order_id] !== undefined;
                    const matchedId = isMaker ? t.maker_order_id : t.taker_order_id;
                    const leg = orderLegMap[matchedId] ?? '?';
                    const knownSide = orderSideMap[matchedId];
                    let side = knownSide || t.side || '?';
                    let price = parseFloat(t.price) || 0;
                    let size = parseFloat(t.size) || 0;
                    if (isMaker) { price = parseFloat(t.maker_price) || price; size = parseFloat(t.matched_amount) || size; if (!knownSide) { side = t.side === 'BUY' ? 'SELL' : 'BUY'; } }
                    const cost = price * size;
                    return (
                      <tr key={i} className="border-b border-gray-800">
                        <td className="py-0.5 px-1 text-gray-400">{tradeMs > 0 ? fmtTime(tradeMs) : ''}{tradeMs > 0 ? <span className="text-gray-500 ml-1">{fmtElapsed(tradeMs)}</span> : ''}</td>
                        <td className={`px-1 ${LC[Number(leg)] || 'text-gray-400'} font-bold`}>{leg}</td>
                        <td className={`px-1 ${side === 'SELL' ? 'text-red-400' : 'text-cyan-400'}`}>{side}</td>
                        <td className="text-right px-1 text-white">{(price * 100).toFixed(1)}¢</td>
                        <td className="text-right px-1 text-white">{size}</td>
                        <td className="text-right px-1 text-white">${cost.toFixed(2)}</td>
                        <td className={`px-1 ${isMaker ? 'text-cyan-400' : 'text-yellow-400'}`}>{isMaker ? 'maker' : 'taker'}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </div>
          )}

          {/* Orders panel */}
          {tab === 'orders' && (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {progOrders.length === 0 ? <div className="text-gray-500 text-center py-2 text-xs">No orders yet</div> : (
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-gray-800 z-10"><tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-0.5 px-1">Time</th><th className="text-left px-1">Leg</th><th className="text-left px-1">Side</th><th className="text-right px-1">Price</th><th className="text-right px-1">Size</th><th className="text-right px-1">USD</th><th className="text-right px-1">Filled</th><th className="text-left px-1">Status</th>
                  </tr></thead>
                  <tbody>{progOrders.map((o, i) => {
                    const time = new Date(o.created_at + 'Z');
                    const dateStr = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                    const priceCents = (parseFloat(o.price) * 100).toFixed(1);
                    const orderUsd = parseFloat(o.price) * parseFloat(o.size);
                    const fillPrice = o.fill_price ? (parseFloat(o.fill_price) * 100).toFixed(1) + '¢' : '';
                    const statusColor2 = o.status === 'active' ? 'text-cyan-400' : o.status === 'cancelled' ? 'text-gray-500' : 'text-emerald-400';
                    return (
                      <tr key={i} className="border-b border-gray-800">
                        <td className="py-0.5 px-1 text-gray-400">{dateStr} {timeStr}</td>
                        <td className={`px-1 ${LC[Number(o.leg)] || 'text-gray-400'} font-bold`}>{o.leg}</td>
                        <td className={`px-1 ${(o.side || 'BUY') === 'SELL' ? 'text-red-400' : 'text-cyan-400'}`}>{o.side || 'BUY'}</td>
                        <td className="text-right px-1 text-white">{priceCents}¢</td>
                        <td className="text-right px-1 text-white">{o.size}</td>
                        <td className="text-right px-1 text-gray-400">${orderUsd >= 10 ? orderUsd.toFixed(0) : orderUsd.toFixed(2)}</td>
                        <td className="text-right px-1 text-white">{o.size_filled || 0}{fillPrice ? ` @ ${fillPrice}` : ''}</td>
                        <td className={`px-1 ${statusColor2}`}>{o.status}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </div>
          )}

          {/* Errors panel */}
          {tab === 'errors' && (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {progErrors.length === 0 ? <div className="text-gray-500 text-center py-2 text-xs">No errors</div> : (
                <table className="w-full text-[10px]">
                  <thead className="sticky top-0 bg-gray-800 z-10"><tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-0.5 px-1">Time</th><th className="text-left px-1">Leg</th><th className="text-left px-1">Error</th>
                  </tr></thead>
                  <tbody>{progErrors.map((e, i) => {
                    const time = new Date(e.created_at + 'Z');
                    const dateStr = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                    return (
                      <tr key={i} className="border-b border-gray-800">
                        <td className="py-0.5 px-1 text-gray-400 whitespace-nowrap">{dateStr} {timeStr}</td>
                        <td className={`px-1 ${LC[Number(e.leg_index)] || 'text-gray-400'} font-bold`}>{e.leg_index ?? '?'}</td>
                        <td className="px-1 text-red-400">{e.error}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </div>
          )}
        </>)}
      </div>
    </div>,
    document.body
  );
}
