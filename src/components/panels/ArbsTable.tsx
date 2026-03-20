import { useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../stores/appStore';
import { formatPriceShort, ASSET_COLORS } from '../../utils/format';
import type { ArbOpportunity } from '../../types';
import { Maximize2 } from 'lucide-react';

function ArbInfoPopover({ arb, anchor, onMouseEnter, onMouseLeave }: { arb: ArbOpportunity; anchor: HTMLElement; onMouseEnter?: () => void; onMouseLeave?: () => void }) {
  const priceData = useAppStore((s) => s.priceData);
  const assetParts = arb.asset.split('/');
  const yesAsset = assetParts[0] || '';
  const noAsset = assetParts[1] || assetParts[0] || '';
  const yesStrike = arb.yesMarket?.groupItemTitle || '';
  const noStrike = arb.noMarket?.groupItemTitle || '';
  const yFmt = formatPriceShort(yesStrike.includes('>') ? yesStrike : '>' + yesStrike).replace(/^>/, '');
  const nFmt = formatPriceShort(noStrike.includes('>') ? noStrike : '>' + noStrike).replace(/^>/, '');
  const yesStrikeVal = parseFloat(yesStrike.replace(/[>$,]/g, ''));
  const noStrikeVal = parseFloat(noStrike.replace(/[>$,]/g, ''));
  const yesLive = priceData[yesAsset + 'USDT' as keyof typeof priceData]?.price || 0;
  const noLive = priceData[noAsset + 'USDT' as keyof typeof priceData]?.price || 0;
  const yesAbove = yesLive >= yesStrikeVal;
  const noAbove = noLive >= noStrikeVal;
  const s1 = yesAbove && !noAbove;
  const s2 = yesAbove && noAbove;
  const s3 = !yesAbove && !noAbove;
  const s4 = !yesAbove && noAbove;
  const yesPrice = arb.yesPrice * 100;
  const noPrice = arb.noPrice * 100;
  const total = yesPrice + noPrice;
  const edge = 100 - total;
  const lossCost = yesPrice > 0 && noPrice > 0 ? (total / 100).toFixed(2) : '?';
  const yesPct = yesLive > 0 ? ((yesStrikeVal - yesLive) / yesLive) * 100 : 0;
  const noPct = noLive > 0 ? ((noStrikeVal - noLive) / noLive) * 100 : 0;
  const yCol = ASSET_COLORS[yesAsset] || '';
  const nCol = ASSET_COLORS[noAsset] || '';
  const now = <span className="text-yellow-300 font-bold ml-1">◄ NOW</span>;

  const rect = anchor.getBoundingClientRect();
  const left = Math.min(rect.right + 6, window.innerWidth - 320);
  const top = Math.max(10, rect.top - 10);

  return (
    <div className="fixed z-[9999] bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-xl max-w-sm text-[10px] text-white" style={{ left, top }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div>BUY YES <span className={`${yCol} font-bold`}>{yesAsset} &gt;{yFmt}</span> @ <span className="text-green-300">{yesPrice.toFixed(1)}¢</span> <span className="text-gray-500">({yesPct >= 0 ? '+' : ''}{yesPct.toFixed(1)}%)</span></div>
      <div>BUY NO <span className={`${nCol} font-bold`}>{noAsset} &gt;{nFmt}</span> @ <span className="text-red-300">{noPrice.toFixed(1)}¢</span> <span className="text-gray-500">({noPct >= 0 ? '+' : ''}{noPct.toFixed(1)}%)</span></div>
      <div className="text-gray-400 mt-1">Total: <span className="text-white">{total.toFixed(1)}¢</span> · Edge: <span className="text-emerald-400">{edge.toFixed(1)}¢</span></div>
      <div className="mt-1.5 space-y-0.5 border-t border-gray-700 pt-1.5">
        <div className={`text-emerald-400 ${s1 ? 'bg-emerald-400/10 rounded px-1 -mx-1' : ''}`}>✓ <span className={yCol}>{yesAsset}</span> above {yFmt} AND <span className={nCol}>{noAsset}</span> below {nFmt} → both pay, +$2{s1 && now}</div>
        <div className={`text-gray-300 ${s2 ? 'bg-gray-500/10 rounded px-1 -mx-1' : ''}`}>≈ <span className={yCol}>{yesAsset}</span> above {yFmt} AND <span className={nCol}>{noAsset}</span> above {nFmt} → YES pays, +$1{s2 && now}</div>
        <div className={`text-gray-300 ${s3 ? 'bg-gray-500/10 rounded px-1 -mx-1' : ''}`}>≈ <span className={yCol}>{yesAsset}</span> below {yFmt} AND <span className={nCol}>{noAsset}</span> below {nFmt} → NO pays, +$1{s3 && now}</div>
        <div className={`text-red-400 ${s4 ? 'bg-red-400/10 rounded px-1 -mx-1' : ''}`}>✗ <span className={yCol}>{yesAsset}</span> below {yFmt} AND <span className={nCol}>{noAsset}</span> above {nFmt} → both lose, -${lossCost}{s4 && now}</div>
      </div>
    </div>
  );
}

export function HedgesTable() {
  const arbs = useAppStore((s) => s.arbs);

  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const setArbDialogArb = useAppStore((s) => s.setArbDialogArb);
  const arbMatchMult = useAppStore((s) => s.arbMatchMult);
  const setArbMatchMult = useAppStore((s) => s.setArbMatchMult);
  const priceData = useAppStore((s) => s.priceData);

  const [hoverArb, setHoverArb] = useState<ArbOpportunity | null>(null);
  const [hoverAnchor, setHoverAnchor] = useState<HTMLElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInfoEnter = useCallback((arb: ArbOpportunity, el: HTMLElement) => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setHoverArb(arb);
    setHoverAnchor(el);
  }, []);
  const handleInfoLeave = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => { setHoverArb(null); setHoverAnchor(null); }, 200);
  }, []);
  const handlePopoverEnter = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  }, []);
  const handlePopoverLeave = handleInfoLeave;

  const handleMarketClick = useCallback((market: typeof arbs[0]['yesMarket'], outcome: 'YES' | 'NO' = 'YES') => {
    setSelectedMarket(market);
    setSidebarOutcome(outcome);
    setSidebarOpen(true);
  }, [setSelectedMarket, setSidebarOutcome, setSidebarOpen]);

  const handleArbClick = useCallback((arb: ArbOpportunity) => {
    setArbDialogArb(arb);
  }, [setArbDialogArb]);

  const [yesFilter, setYesFilter] = useState(localStorage.getItem('polymarket-arb-yes-filter') || 'ALL');
  const [noFilter, setNoFilter] = useState(localStorage.getItem('polymarket-arb-no-filter') || 'ALL');
  const [minPct, setMinPct] = useState(localStorage.getItem('polymarket-arb-min-pct') || '');
  const [shareQty, setShareQty] = useState(localStorage.getItem('polymarket-arb-share-qty') || '');
  const [dateFilter, setDateFilter] = useState(localStorage.getItem('polymarket-arb-date-filter') || 'ALL');
  const [priceMode, setPriceMode] = useState(localStorage.getItem('polymarket-arb-price-mode') || 'ASK');
  const [diffMode, setDiffMode] = useState(localStorage.getItem('polymarket-arb-diff-mode') || 'OB');

  // Multi-column sort: array of { column, direction } — both Date and Diff can be active
  const [arbSort, setArbSort] = useState<{ column: string; direction: 'asc' | 'desc' }[]>(() => {
    try {
      const saved = localStorage.getItem('polymarket-arb-sort');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return [{ column: 'diff', direction: 'asc' }];
  });

  const toggleSort = useCallback((col: string) => {
    setArbSort(prev => {
      const idx = prev.findIndex(s => s.column === col);
      let next: typeof prev;
      if (idx >= 0) {
        // Already sorting by this column — toggle direction or remove
        const cur = prev[idx];
        if (cur.direction === 'asc') {
          next = prev.map((s, i) => i === idx ? { ...s, direction: 'desc' as const } : s);
        } else {
          // Remove this column from sort
          next = prev.filter((_, i) => i !== idx);
          if (next.length === 0) next = [{ column: col, direction: 'asc' }];
        }
      } else {
        // Add this column to sort
        next = [...prev, { column: col, direction: col === 'date' ? 'asc' : 'asc' }];
      }
      localStorage.setItem('polymarket-arb-sort', JSON.stringify(next));
      return next;
    });
  }, []);

  const sortIcon = useCallback((col: string) => {
    const idx = arbSort.findIndex(s => s.column === col);
    if (idx < 0) return '';
    const arrow = arbSort[idx].direction === 'asc' ? '▲' : '▼';
    const num = arbSort.length > 1 ? `${idx + 1}` : '';
    return ` ${arrow}${num}`;
  }, [arbSort]);

  const arbAssets = ['ALL', 'BTC', 'ETH', 'SOL', 'XRP'];
  const arbColors: Record<string, string> = { ALL: 'text-white', ...ASSET_COLORS };

  const displayArbs = arbs;

  // Filter arbs
  const filtered = useMemo(() => {
    const minPctNum = parseFloat(minPct) || 0;
    let result = displayArbs.filter((a) => {
      const parts = a.asset.split('/');
      const yA = parts[0] || '';
      const nA = parts[1] || parts[0] || '';
      if (yesFilter !== 'ALL' && yA !== yesFilter) return false;
      if (noFilter !== 'ALL' && nA !== noFilter) return false;
      if (minPctNum > 0 && (Math.abs(a.yesPct) < minPctNum || Math.abs(a.noPct) < minPctNum)) return false;
      if (dateFilter !== 'ALL' && a.endDate) {
        const now = new Date();
        const todayStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toDateString();
        const tmrStr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toDateString();
        const ds = new Date(a.endDate).toDateString();
        if (dateFilter === 'TODAY' && ds !== todayStr) return false;
        if (dateFilter === 'TMR' && ds !== tmrStr) return false;
      }
      return true;
    });
    // Multi-column sort
    if (arbSort.length > 0) {
      result = [...result].sort((a, b) => {
        for (const s of arbSort) {
          const dir = s.direction === 'asc' ? 1 : -1;
          let cmp = 0;
          switch (s.column) {
            case 'date': {
              const ta = a.endDate ? new Date(a.endDate).getTime() : 0;
              const tb = b.endDate ? new Date(b.endDate).getTime() : 0;
              cmp = (ta - tb) * dir; break;
            }
            case 'diff': {
              const yaP = priceMode === 'BID' ? (a.yesBidPrice||0) : a.yesPrice * 100;
              const naP = priceMode === 'BID' ? (a.noBidPrice||0) : a.noPrice * 100;
              const ybP = priceMode === 'BID' ? (b.yesBidPrice||0) : b.yesPrice * 100;
              const nbP = priceMode === 'BID' ? (b.noBidPrice||0) : b.noPrice * 100;
              const da = 100 - yaP - naP;
              const db = 100 - ybP - nbP;
              cmp = (da - db) * dir; break;
            }
            case 'yesPct': cmp = ((a.yesPct || 0) - (b.yesPct || 0)) * dir; break;
            case 'noPct': cmp = ((a.noPct || 0) - (b.noPct || 0)) * dir; break;
            case 'yesPrice': {
              const ya = priceMode === 'BID' ? (a.yesBidPrice||0) : a.yesPrice * 100;
              const yb = priceMode === 'BID' ? (b.yesBidPrice||0) : b.yesPrice * 100;
              cmp = (ya - yb) * dir; break;
            }
            case 'noPrice': {
              const na = priceMode === 'BID' ? (a.noBidPrice||0) : a.noPrice * 100;
              const nb = priceMode === 'BID' ? (b.noBidPrice||0) : b.noPrice * 100;
              cmp = (na - nb) * dir; break;
            }
            case 'yesBs': cmp = ((a.yesBs ?? -999) - (b.yesBs ?? -999)) * dir; break;
            case 'noBs': cmp = ((a.noBs ?? -999) - (b.noBs ?? -999)) * dir; break;
            case 'maxSize': cmp = ((a.maxSize || 0) - (b.maxSize || 0)) * dir; break;
          }
          if (cmp !== 0) return cmp;
        }
        return 0;
      });
    }
    return result;
  }, [displayArbs, yesFilter, noFilter, minPct, dateFilter, arbSort, priceMode]);

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3">
      <div className="panel-header">
        <h3 className="text-sm font-bold text-gray-300 mb-2 flex items-center justify-between">
          <span>
            <Maximize2 className="inline w-3.5 h-3.5 mr-1 text-emerald-400" />
            <span className="text-emerald-400">Hedges</span>
            {' '}<span className="text-xs text-gray-500">({filtered.length})</span>
          </span>
          <div className="flex gap-1 items-center">
            <span className="text-[9px] text-gray-500">Y:</span>
            <select
              value={yesFilter}
              onChange={(e) => { setYesFilter(e.target.value); localStorage.setItem('polymarket-arb-yes-filter', e.target.value); }}
              className={`bg-gray-700 text-[9px] font-bold rounded px-1 py-0 border border-gray-600 h-[22px] ${arbColors[yesFilter] || 'text-white'}`}
              style={{ outline: 'none' }}
            >
              {arbAssets.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <span className="text-[9px] text-gray-500">N:</span>
            <select
              value={noFilter}
              onChange={(e) => { setNoFilter(e.target.value); localStorage.setItem('polymarket-arb-no-filter', e.target.value); }}
              className={`bg-gray-700 text-[9px] font-bold rounded px-1 py-0 border border-gray-600 h-[22px] ${arbColors[noFilter] || 'text-white'}`}
              style={{ outline: 'none' }}
            >
              {arbAssets.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <span className="text-[9px] text-gray-500">%≥</span>
            <input
              type="number"
              value={minPct}
              onChange={(e) => { setMinPct(e.target.value); localStorage.setItem('polymarket-arb-min-pct', e.target.value); }}
              className="bg-gray-700 text-[9px] font-bold rounded px-1 py-0 border border-gray-600 text-white w-8 h-[22px] no-spin"
              style={{ outline: 'none' }}
              placeholder="0"
            />
            <span className="text-[9px] text-gray-500">Qty</span>
            <input
              type="number"
              value={shareQty}
              onChange={(e) => { setShareQty(e.target.value); localStorage.setItem('polymarket-arb-share-qty', e.target.value); }}
              className="bg-gray-700 text-[9px] font-bold rounded px-1 py-0 border border-gray-600 text-white w-10 h-[22px] no-spin"
              style={{ outline: 'none' }}
              placeholder="0"
            />
            <select
              value={dateFilter}
              onChange={(e) => { setDateFilter(e.target.value); localStorage.setItem('polymarket-arb-date-filter', e.target.value); }}
              className="bg-gray-700 text-[9px] font-bold rounded px-1 py-0 border border-gray-600 text-white h-[22px]"
              style={{ outline: 'none' }}
            >
              <option value="ALL">ALL</option>
              <option value="TODAY">TODAY</option>
              <option value="TMR">TMR</option>
            </select>
            <select
              value={priceMode}
              onChange={(e) => { setPriceMode(e.target.value); localStorage.setItem('polymarket-arb-price-mode', e.target.value); }}
              className="bg-gray-700 text-[9px] font-bold rounded px-1 py-0 border border-gray-600 text-white h-[22px]"
              style={{ outline: 'none' }}
            >
              <option value="ASK">ASK</option>
              <option value="BID">BID</option>
            </select>
            <select
              value={diffMode}
              onChange={(e) => { setDiffMode(e.target.value); localStorage.setItem('polymarket-arb-diff-mode', e.target.value); }}
              className={`bg-gray-700 text-[9px] font-bold rounded px-1 py-0 border border-gray-600 h-[22px] ${diffMode === 'BS1' ? 'text-cyan-300' : diffMode === 'BS2' ? 'text-pink-400' : 'text-white'}`}
              style={{ outline: 'none' }}
            >
              <option value="OB">OB</option>
              <option value="BS1">BS1</option>
              <option value="BS2">BS2</option>
            </select>
            <span className="text-[9px] text-gray-500 ml-1">Δ</span>
            <span className={`text-[9px] font-bold ${arbMatchMult !== 1 ? 'text-yellow-400' : 'text-gray-500'}`}>{arbMatchMult.toFixed(1)}x</span>
            <input
              type="range"
              min="1"
              max="3"
              step="0.1"
              value={arbMatchMult}
              onChange={(e) => setArbMatchMult(parseFloat(e.target.value))}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              className="w-12 h-3 accent-emerald-500"
            />
          </div>
        </h3>
      </div>
      <div className="panel-body text-xs flex flex-col min-h-0">
        {filtered.length === 0 ? (
          <div className="text-gray-500 text-center py-4">No arb opportunities</div>
        ) : (<>
          {/* Info popover — rendered via portal so it's not clipped by overflow */}
          {hoverArb && hoverAnchor && createPortal(
            <ArbInfoPopover arb={hoverArb} anchor={hoverAnchor} onMouseEnter={handlePopoverEnter} onMouseLeave={handlePopoverLeave} />,
            document.body
          )}
          {/* Fixed header */}
          <table className="w-full text-[11px] table-fixed">
            <colgroup><col style={{width:'18px'}}/><col style={{width:'42px'}}/><col style={{width:'100px'}}/><col style={{width:'30px'}}/><col style={{width:'32px'}}/><col style={{width:'42px'}}/><col style={{width:'100px'}}/><col style={{width:'30px'}}/><col style={{width:'32px'}}/><col style={{width:'42px'}}/><col style={{width:'48px'}}/><col style={{width:'38px'}}/><col style={{width:'38px'}}/></colgroup>
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="px-0"></th>
                <th className="text-left py-0.5 px-1 cursor-pointer hover:text-white select-none whitespace-nowrap" onClick={() => toggleSort('date')}>Date{sortIcon('date')}</th>
                <th className="text-left py-0.5 px-1">Yes</th>
                <th className="text-right py-0.5 px-1 cursor-pointer hover:text-white select-none whitespace-nowrap" onClick={() => toggleSort('yesPct')}>Y%{sortIcon('yesPct')}</th>
                <th className="text-right py-0.5 px-1 cursor-pointer hover:text-white select-none whitespace-nowrap" onClick={() => toggleSort('yesPrice')}>Y¢{sortIcon('yesPrice')}</th>
                <th className="text-right py-0.5 px-1 cursor-pointer hover:text-white select-none whitespace-nowrap" onClick={() => toggleSort('yesBs')}>Ybs{sortIcon('yesBs')}</th>
                <th className="text-left py-0.5 px-1 border-l border-gray-600">No</th>
                <th className="text-right py-0.5 px-1 cursor-pointer hover:text-white select-none whitespace-nowrap" onClick={() => toggleSort('noPct')}>N%{sortIcon('noPct')}</th>
                <th className="text-right py-0.5 px-1 cursor-pointer hover:text-white select-none whitespace-nowrap" onClick={() => toggleSort('noPrice')}>N¢{sortIcon('noPrice')}</th>
                <th className="text-right py-0.5 px-1 cursor-pointer hover:text-white select-none whitespace-nowrap" onClick={() => toggleSort('noBs')}>Nbs{sortIcon('noBs')}</th>
                <th className="text-right py-0.5 px-1 border-l border-gray-600 cursor-pointer hover:text-white select-none whitespace-nowrap" onClick={() => toggleSort('diff')}>Diff{sortIcon('diff')}</th>
                <th className="text-right py-0.5 px-1 cursor-pointer hover:text-white select-none whitespace-nowrap" onClick={() => toggleSort('maxSize')}>Size{sortIcon('maxSize')}</th>
                <th className="px-0"></th>
              </tr>
            </thead>
          </table>
          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto min-h-0">
          <table className="w-full text-[11px] table-fixed">
            <colgroup><col style={{width:'18px'}}/><col style={{width:'42px'}}/><col style={{width:'100px'}}/><col style={{width:'30px'}}/><col style={{width:'32px'}}/><col style={{width:'42px'}}/><col style={{width:'100px'}}/><col style={{width:'30px'}}/><col style={{width:'32px'}}/><col style={{width:'42px'}}/><col style={{width:'48px'}}/><col style={{width:'38px'}}/><col style={{width:'38px'}}/></colgroup>
            <tbody>
                {filtered.map((arb, i) => {
                  // Date formatting matching HTML
                  let dateStr = '', dateColor = 'text-gray-400';
                  if (arb.endDate) {
                    const endD = new Date(arb.endDate);
                    const hoursUntil = (endD.getTime() - Date.now()) / 3600000;
                    const dayAbbr = ['Su','Mo','Tu','We','Th','Fr','Sa'][endD.getDay()];
                    const isWeekend = endD.getDay() === 0 || endD.getDay() === 6;
                    if (hoursUntil > 0 && hoursUntil < 24) { dateStr = 'TODAY'; dateColor = 'text-red-400 font-bold'; }
                    else if (hoursUntil >= 24 && hoursUntil < 48) { dateStr = 'TMR'; dateColor = 'text-yellow-400 font-bold'; }
                    else { dateStr = dayAbbr + ' ' + endD.getDate(); dateColor = isWeekend ? 'text-purple-400' : 'text-gray-400'; }
                  }
                  // Yes/No asset + strike
                  const assetParts = arb.asset.split('/');
                  const yesAsset = assetParts[0] || '';
                  const noAsset = assetParts[1] || assetParts[0] || '';
                  const yesStrike = arb.yesMarket?.groupItemTitle || '';
                  const noStrike = arb.noMarket?.groupItemTitle || '';
                  const yesLabel = yesAsset + ' ' + formatPriceShort(yesStrike.includes('>') ? yesStrike : '>' + yesStrike);
                  const noLabel = noAsset + ' ' + formatPriceShort(noStrike.includes('>') ? noStrike : '>' + noStrike);
                  const yesTokenId = arb.yesMarket?.clobTokenIds?.[0] || '';
                  const noTokenId = arb.noMarket?.clobTokenIds?.[1] || '';
                  const yesColor = ASSET_COLORS[yesAsset] || 'text-gray-300';
                  const noColor = ASSET_COLORS[noAsset] || 'text-gray-300';
                  const dispYesPrice = priceMode === 'BID' ? (arb.yesBidPrice || 0) : arb.yesPrice * 100;
                  const dispNoPrice = priceMode === 'BID' ? (arb.noBidPrice || 0) : arb.noPrice * 100;
                  const diff = 100 - dispYesPrice - dispNoPrice;
                  const diffColor = diff > 5 ? 'text-green-400 font-bold' : diff > 2 ? 'text-green-300' : diff > 0 ? 'text-yellow-300' : 'text-red-400';
                  // Pick BS value based on diffMode
                  let dispYesBs: number | null;
                  let dispNoBs: number | null;
                  if (diffMode === 'BS1') {
                    dispYesBs = arb.yesBs1;
                    dispNoBs = arb.noBs1;
                  } else if (diffMode === 'BS2') {
                    dispYesBs = arb.yesBs2;
                    dispNoBs = arb.noBs2;
                  } else {
                    dispYesBs = arb.yesBs;
                    dispNoBs = arb.noBs;
                  }
                  // Check if current prices put this arb in the losing scenario
                  // Losing = YES asset below its strike AND NO asset above its strike → both legs lose
                  const yesStrikeVal = parseFloat(yesStrike.replace(/[>$,]/g, ''));
                  const noStrikeVal = parseFloat(noStrike.replace(/[>$,]/g, ''));
                  const yesLive = priceData[yesAsset + 'USDT' as keyof typeof priceData]?.price || 0;
                  const noLive = priceData[noAsset + 'USDT' as keyof typeof priceData]?.price || 0;
                  const isLosing = yesLive > 0 && noLive > 0 && yesLive < yesStrikeVal && noLive >= noStrikeVal;

                  const isYesSelected = selectedMarket && selectedMarket.id === arb.yesMarket?.id;
                  const isNoSelected = selectedMarket && selectedMarket.id === arb.noMarket?.id;
                  const rowHighlight = isYesSelected || isNoSelected ? 'bg-blue-900/40' : isLosing ? 'bg-red-900/20' : '';
                  const isSameAsset = yesAsset === noAsset;
                  return (
                    <tr key={arb.id || i} className={`hover:bg-gray-700/30 border-b border-gray-700/30 ${rowHighlight}`}>
                      <td
                        className="px-0 text-center cursor-pointer"
                        onMouseEnter={!isSameAsset ? (e) => handleInfoEnter(arb, e.currentTarget as HTMLElement) : undefined}
                        onMouseLeave={!isSameAsset ? handleInfoLeave : undefined}
                      >
                        {isSameAsset ? (
                          <span className="text-gray-600"><svg className="w-3 h-3 inline pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></span>
                        ) : (
                          <span className="text-gray-500 hover:text-cyan-400 transition">
                            <svg className="w-3 h-3 inline pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                          </span>
                        )}
                      </td>
                      <td className={`py-0.5 px-1 ${dateColor} whitespace-nowrap`}>{dateStr}</td>
                      <td className={`py-0.5 px-1 ${yesColor} whitespace-nowrap truncate cursor-pointer hover:underline`} onClick={() => handleMarketClick(arb.yesMarket, 'YES')}>{yesLabel}</td>
                      <td className={`text-right py-0.5 px-1 ${arb.yesPct >= 0 ? 'text-gray-500' : 'text-gray-400'}`}>{arb.yesPct >= 0 ? '+' : ''}{arb.yesPct.toFixed(0)}%</td>
                      <td
                        className="text-right py-0.5 px-1 text-green-300 ob-trigger cursor-pointer"
                        data-token-id={yesTokenId}
                        data-market-title={`${yesLabel} (YES)`}
                        data-asset={yesAsset}
                        data-strike={yesStrike}
                        data-end-date={arb.endDate || ''}
                      >{dispYesPrice.toFixed(1)}</td>
                      <td className={`text-right py-0.5 px-1 ${diffMode === 'BS1' ? 'text-cyan-300' : diffMode === 'BS2' ? 'text-pink-400' : 'text-white'}`}>{dispYesBs !== null ? (dispYesBs < 0.1 ? '0.0' : dispYesBs.toFixed(1)) : '-'}</td>
                      <td className={`py-0.5 px-1 ${noColor} whitespace-nowrap truncate cursor-pointer hover:underline border-l border-gray-600`} onClick={() => handleMarketClick(arb.noMarket, 'NO')}>{noLabel}</td>
                      <td className={`text-right py-0.5 px-1 ${arb.noPct >= 0 ? 'text-gray-500' : 'text-gray-400'}`}>{arb.noPct >= 0 ? '+' : ''}{arb.noPct.toFixed(0)}%</td>
                      <td
                        className="text-right py-0.5 px-1 text-red-300 ob-trigger cursor-pointer"
                        data-token-id={noTokenId}
                        data-market-title={`${noLabel} (NO)`}
                        data-asset={noAsset}
                        data-strike={noStrike}
                        data-end-date={arb.endDate || ''}
                      >{dispNoPrice.toFixed(1)}</td>
                      <td className={`text-right py-0.5 px-1 ${diffMode === 'BS1' ? 'text-cyan-300' : diffMode === 'BS2' ? 'text-pink-400' : 'text-white'}`}>{dispNoBs !== null ? (dispNoBs < 0.1 ? '0.0' : dispNoBs.toFixed(1)) : '-'}</td>
                      <td className={`text-right py-0.5 px-1 ${diffColor} border-l border-gray-600`}>{diff.toFixed(1)}¢</td>
                      <td className="text-right py-0.5 px-1 text-gray-300">{arb.maxSize > 0 ? (arb.maxSize >= 1000 ? (arb.maxSize / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : arb.maxSize) : '-'}</td>
                      <td className="py-0.5 px-0 text-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleArbClick(arb); }}
                          className="px-1 py-0 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-bold rounded transition"
                        >ARB</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>)}
      </div>
    </div>
  );
}
