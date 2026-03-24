import { useState, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { formatPriceShort, ASSET_COLORS } from '../../utils/format';
import { Zap } from 'lucide-react';

export function SignalsTable() {
  const signals = useAppStore((s) => s.signals);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const makerMode = useAppStore((s) => s.signalMakerMode);
  const setMakerModeGlobal = useAppStore((s) => s.setSignalMakerMode);
  const signalsOnGrid = useAppStore((s) => s.signalsOnGrid);
  const setSignalsOnGrid = useAppStore((s) => s.setSignalsOnGrid);

  const handleMarketClick = useCallback((market: typeof signals[0]['market'], outcome: 'YES' | 'NO' = 'YES') => {
    setSelectedMarket(market);
    setSidebarOutcome(outcome);
    setSidebarOpen(true);
  }, [setSelectedMarket, setSidebarOutcome, setSidebarOpen]);

  const [showToday, setShowToday] = useState(
    localStorage.getItem('polymarket-signal-today') !== 'false'
  );
  const [showTomorrow, setShowTomorrow] = useState(
    localStorage.getItem('polymarket-signal-tomorrow') !== 'false'
  );
  const [marketTypeFilter, setMarketTypeFilter] = useState(
    localStorage.getItem('polymarket-signal-market-type') || 'ALL'
  );
  const [pctChangeFilter, setPctChangeFilter] = useState(
    localStorage.getItem('polymarket-signal-pct-change') || ''
  );
  const [maxPriceFilter, setMaxPriceFilter] = useState(
    localStorage.getItem('polymarket-signal-max-price') || ''
  );
  const [assetFilter, setAssetFilter] = useState(
    localStorage.getItem('polymarket-table-asset-filter') || 'ALL'
  );
  const [sortCol, setSortCol] = useState<'date' | 'diff' | null>('diff');
  const [sortAsc, setSortAsc] = useState(true);

  // Helper: check if a date is TODAY or TOMORROW
  const isToday = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  };
  const isTomorrow = (dateStr: string) => {
    const d = new Date(dateStr);
    const tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    return d.toDateString() === tmr.toDateString();
  };

  const toggleSort = (col: 'date' | 'diff') => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  };

  const filtered = signals.filter((s) => {
    if (assetFilter !== 'ALL' && s.asset !== assetFilter) return false;
    // Date filters: if unchecked, hide those signals
    if (!showToday && isToday(s.endDate)) return false;
    if (!showTomorrow && isTomorrow(s.endDate)) return false;
    if (marketTypeFilter === 'above' && s.tableType !== 'above') return false;
    if (marketTypeFilter === 'price' && s.tableType !== 'price') return false;
    if (marketTypeFilter === 'hit' && s.tableType !== 'hit') return false;
    // % filter: use the active diff based on mode
    const activeDiffPct = makerMode ? Math.abs(s.bidDiffPct) : Math.abs(s.diffPct);
    if (pctChangeFilter && activeDiffPct < parseFloat(pctChangeFilter)) return false;
    // Max price filter: use bid or ask price based on mode
    const displayPriceCents = makerMode ? s.bidPrice * 100 : s.price * 100;
    if (maxPriceFilter && displayPriceCents > parseFloat(maxPriceFilter)) return false;
    return true;
  }).sort((a, b) => {
    if (!sortCol) return 0;
    let cmp = 0;
    if (sortCol === 'date') {
      cmp = new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
    } else if (sortCol === 'diff') {
      // Sort by the displayed diff value: cents in maker mode, bid/ask % otherwise
      const diffA = makerMode ? (a.bidPrice * 100 - a.bsPrice * 100) : a.diffPct;
      const diffB = makerMode ? (b.bidPrice * 100 - b.bsPrice * 100) : b.diffPct;
      cmp = diffA - diffB;
    }
    return sortAsc ? cmp : -cmp;
  });

  const toggleShowToday = () => {
    const v = !showToday;
    setShowToday(v);
    localStorage.setItem('polymarket-signal-today', v ? 'true' : 'false');
  };
  const toggleShowTomorrow = () => {
    const v = !showTomorrow;
    setShowTomorrow(v);
    localStorage.setItem('polymarket-signal-tomorrow', v ? 'true' : 'false');
  };

  const assets = ['ALL', 'BTC', 'ETH', 'SOL', 'XRP'];
  const assetColors: Record<string, string> = { ALL: 'text-white', BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400' };

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3">
      <div className="panel-header">
        <h3 className="text-sm font-bold text-yellow-400 mb-2 flex items-center justify-between">
          <span>
            <Zap className="inline w-3.5 h-3.5 mr-1" />
            Signals
          </span>
          <div className="flex gap-1 items-center">
            <label className="flex items-center gap-0.5 text-[9px] text-red-400 cursor-pointer">
              <input type="checkbox" checked={showToday} onChange={toggleShowToday} className="w-3 h-3" />TDY
            </label>
            <label className="flex items-center gap-0.5 text-[9px] text-yellow-400 cursor-pointer">
              <input type="checkbox" checked={showTomorrow} onChange={toggleShowTomorrow} className="w-3 h-3" />TMR
            </label>
            <select
              value={marketTypeFilter}
              onChange={(e) => { setMarketTypeFilter(e.target.value); localStorage.setItem('polymarket-signal-market-type', e.target.value); }}
              className="bg-gray-700 text-white text-[9px] px-0.5 py-0 rounded border border-gray-600 h-[22px]"
            >
              <option value="ALL">All</option>
              <option value="above">Above</option>
              <option value="price">Between</option>
              <option value="hit">Hit</option>
            </select>
            <label className="flex items-center gap-0.5 text-[9px] text-cyan-400 cursor-pointer" title="Show signals in the markets table grid">
              <input type="checkbox" checked={signalsOnGrid} onChange={(e) => setSignalsOnGrid(e.target.checked)} className="w-3 h-3" />Grid
            </label>
            <select
              value={makerMode ? 'maker' : 'taker'}
              onChange={(e) => { setMakerModeGlobal(e.target.value === 'maker'); }}
              className="bg-gray-700 text-white text-[9px] px-0.5 py-0 rounded border border-gray-600 h-[22px]"
            >
              <option value="taker">Taker</option>
              <option value="maker">Maker</option>
            </select>
            <label className="flex items-center gap-0.5 text-[9px] text-gray-400">
              %<input
                type="number"
                value={pctChangeFilter}
                onChange={(e) => { setPctChangeFilter(e.target.value); localStorage.setItem('polymarket-signal-pct-change', e.target.value); }}
                placeholder="0"
                className="w-8 bg-gray-700 text-white text-[9px] px-0.5 rounded border border-gray-600 text-center no-spin h-[22px]"
              />
            </label>
            <label className="flex items-center gap-0.5 text-[9px] text-gray-400">
              ¢<input
                type="number"
                value={maxPriceFilter}
                onChange={(e) => { setMaxPriceFilter(e.target.value); localStorage.setItem('polymarket-signal-max-price', e.target.value); }}
                placeholder="0"
                className="w-8 bg-gray-700 text-white text-[9px] px-0.5 rounded border border-gray-600 text-center no-spin h-[22px]"
              />
            </label>
            <select
              value={assetFilter}
              onChange={(e) => { setAssetFilter(e.target.value); localStorage.setItem('polymarket-table-asset-filter', e.target.value); }}
              className={`bg-gray-700 text-[9px] font-bold rounded px-1 py-0 border border-gray-600 h-[22px] ${assetColors[assetFilter] || 'text-white'}`}
              style={{ outline: 'none' }}
            >
              {assets.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </h3>
      </div>
      <div className="panel-body text-xs">
        {filtered.length === 0 ? (
          <div className="text-gray-500 text-center py-4">No signals</div>
        ) : (
          <div className="overflow-y-auto max-h-full">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left px-1 py-0.5">Asset</th>
                  <th className="text-left px-1 py-0.5 cursor-pointer select-none" onClick={() => toggleSort('date')}>Date{sortCol === 'date' ? (sortAsc ? ' ▲' : ' ▼') : ''}</th>
                  <th className="text-left px-1 py-0.5">Market</th>
                  <th className="text-center px-1 py-0.5">Side</th>
                  <th className="text-right px-1 py-0.5">BS</th>
                  <th className="text-right px-1 py-0.5">{makerMode ? 'Bid' : 'Ask'}</th>
                  <th className="text-right px-1 py-0.5 cursor-pointer select-none" onClick={() => toggleSort('diff')}>Diff{sortCol === 'diff' ? (sortAsc ? ' ▲' : ' ▼') : ''}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((sig, i) => {
                  const acol = ASSET_COLORS[sig.asset] || 'text-gray-400';
                  // Date formatting matching HTML
                  const endD = new Date(sig.endDate);
                  const hoursUntil = (endD.getTime() - Date.now()) / 3600000;
                  const dayAbbr = ['Su','Mo','Tu','We','Th','Fr','Sa'][endD.getDay()];
                  const isWeekend2 = endD.getDay() === 0 || endD.getDay() === 6;
                  let dateStr: string, dateColor: string;
                  if (hoursUntil > 0 && hoursUntil < 24) { dateStr = 'TODAY'; dateColor = 'text-red-400 font-bold'; }
                  else if (hoursUntil >= 24 && hoursUntil < 48) { dateStr = 'TMR'; dateColor = 'text-yellow-400 font-bold'; }
                  else { dateStr = dayAbbr + ' ' + endD.getDate(); dateColor = isWeekend2 ? 'text-purple-400' : 'text-gray-400'; }
                  // Market label: "{asset} >{strike}" with formatPriceShort
                  const strikeLabel = formatPriceShort(sig.priceStr);
                  const isSelected = selectedMarket && selectedMarket.id === sig.market.id;
                  const rowHighlight = isSelected ? 'bg-blue-900/40' : '';
                  // Display price: bid in maker/BID mode, ask otherwise
                  const displayPrice = makerMode ? sig.bidPrice * 100 : sig.price * 100;
                  // Display diff: maker mode shows cents (bid - BS), taker shows %
                  let displayDiff: string;
                  if (makerMode) {
                    displayDiff = (sig.bidPrice * 100 - sig.bsPrice * 100).toFixed(1) + '¢';
                  } else {
                    displayDiff = sig.diffPct.toFixed(1) + '%';
                  }
                  return (
                    <tr key={i} className={`hover:bg-gray-700/30 cursor-pointer border-b border-gray-700/30 ${rowHighlight}`} onClick={() => handleMarketClick(sig.market, sig.origSide)}>
                      <td className={`px-1 py-0.5 font-bold ${acol}`}>{sig.asset}</td>
                      <td className={`px-1 py-0.5 ${dateColor} whitespace-nowrap`}>{dateStr}</td>
                      <td className={`px-1 py-0.5 ${acol} whitespace-nowrap truncate max-w-[100px] hover:underline`}>{sig.asset} {strikeLabel}</td>
                      <td className={`text-center px-1 py-0.5 font-bold ${sig.origSide === 'YES' ? 'text-green-400' : 'text-red-400'}`}>{sig.origSide}</td>
                      <td className="text-right px-1 py-0.5 text-gray-300">{(sig.bsPrice * 100).toFixed(1)}</td>
                      <td className="text-right px-1 py-0.5 text-gray-300">{displayPrice.toFixed(1)}¢</td>
                      <td className="text-right px-1 py-0.5 text-green-400 font-bold">{displayDiff}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
