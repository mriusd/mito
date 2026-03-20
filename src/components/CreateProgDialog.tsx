import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { createProgArb, rebidProg } from '../api';
import { showToast } from '../utils/toast';
import { extractAssetFromMarket } from '../utils/format';
import { checkBackendAuth, sendCredsToBackend } from '../lib/clobClient';
import { ApiKeyConsentDialog } from './ApiKeyConsentDialog';
import type { Market, AssetName } from '../types';

const ASSETS: AssetName[] = ['BTC', 'ETH', 'SOL', 'XRP'];

interface LegState {
  id: number;
  asset: AssetName;
  type: 'above' | 'price';
  side: 'YES' | 'NO';
  dateIdx: number;
  strikeIdx: number;
  priceCents: string;
  entryMode: string;
  entryArg: string;
  entryMin: string;
  entryMax: string;
}

function getDateLabel(endDate: string): string {
  const ed = new Date(endDate);
  const h = (ed.getTime() - Date.now()) / 3600000;
  const da = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][ed.getDay()] + ' ' + ed.getDate();
  return h > 0 && h < 24 ? 'TODAY' : h >= 24 && h < 48 ? 'TMR' : da;
}

export function CreateProgDialog() {
  const open = useAppStore((s) => s.progDialogOpen);
  const setOpen = useAppStore((s) => s.setProgDialogOpen);
  const setProgDialogData = useAppStore((s) => s.setProgDialogData);
  const aboveMarkets = useAppStore((s) => s.aboveMarkets);
  const priceOnMarkets = useAppStore((s) => s.priceOnMarkets);

  const [legs, setLegs] = useState<LegState[]>([]);
  const [sizeMode, setSizeMode] = useState<'usd' | 'shares'>(
    (localStorage.getItem('mp-size-mode') as 'usd' | 'shares') || 'usd'
  );
  const [size, setSize] = useState(localStorage.getItem('mp-size') || '');
  const [expiryMin, setExpiryMin] = useState(localStorage.getItem('mp-expiry') || '150');
  const [autoSell, setAutoSell] = useState(true);
  const [autoSellMode, setAutoSellMode] = useState('bs1');
  const [autoSellSpread, setAutoSellSpread] = useState('10');
  const [autoSellPrice, setAutoSellPrice] = useState('');
  const [loop, setLoop] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const pendingCreateRef = useRef<(() => Promise<void>) | null>(null);

  // Initialize legs on open — read fresh state from store each time
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      // Read fresh values from store to avoid stale closures
      const state = useAppStore.getState();
      const curSidebarOutcome = state.sidebarOutcome;
      const curSelectedMarket = state.selectedMarket;
      const curAboveMarkets = state.aboveMarkets;
      const curPriceOnMarkets = state.priceOnMarkets;
      const curProgDialogData = state.progDialogData;

      if (curProgDialogData) {
        // Find matching date/strike indices for YES leg
        const yesAsset = curProgDialogData.yesAsset as AssetName;
        const noAsset = curProgDialogData.noAsset as AssetName;
        const yesMarkets = curAboveMarkets[yesAsset] || [];
        const noMarkets = curAboveMarkets[noAsset] || [];
        const yesEndDate = curProgDialogData.endDate;

        // Find YES date index
        const yesDates = Array.from(new Set(yesMarkets.filter(m => m.endDate && new Date(m.endDate).getTime() > Date.now()).map(m => m.endDate))).sort();
        const yesDateIdx = Math.max(0, yesDates.indexOf(yesEndDate));
        const yesStrikes = yesMarkets.filter(m => m.endDate === (yesDates[yesDateIdx] || yesDates[0]));
        const yesStrikeIdx = Math.max(0, yesStrikes.findIndex(m => m.id === curProgDialogData.yesMarket.id));

        const noDates = Array.from(new Set(noMarkets.filter(m => m.endDate && new Date(m.endDate).getTime() > Date.now()).map(m => m.endDate))).sort();
        const noDateIdx = Math.max(0, noDates.indexOf(yesEndDate));
        const noStrikes = noMarkets.filter(m => m.endDate === (noDates[noDateIdx] || noDates[0]));
        const noStrikeIdx = Math.max(0, noStrikes.findIndex(m => m.id === curProgDialogData.noMarket.id));

        setLegs([
          { id: 1, asset: yesAsset, type: 'above', side: 'YES', dateIdx: yesDateIdx, strikeIdx: yesStrikeIdx, priceCents: '', entryMode: 'manual', entryArg: '', entryMin: '', entryMax: '' },
          { id: 2, asset: noAsset, type: 'above', side: 'NO', dateIdx: noDateIdx, strikeIdx: noStrikeIdx, priceCents: '', entryMode: 'manual', entryArg: '', entryMin: '', entryMax: '' },
        ]);
      } else {
        // Use sidebar outcome and selected market asset/date/strike as defaults
        const defaultSide: 'YES' | 'NO' = curSidebarOutcome || 'YES';
        let defaultAsset: AssetName = 'BTC';
        let defaultType: 'above' | 'price' = 'above';
        let defaultDateIdx = 0;
        let defaultStrikeIdx = 0;

        if (curSelectedMarket) {
          const extracted = extractAssetFromMarket(curSelectedMarket);
          if (extracted) defaultAsset = extracted;

          // Determine market type
          const aboveList = curAboveMarkets[defaultAsset] || [];
          const priceList = curPriceOnMarkets[defaultAsset] || [];
          const inAbove = aboveList.some(m => m.id === curSelectedMarket.id);
          const inPrice = priceList.some(m => m.id === curSelectedMarket.id);
          defaultType = inPrice && !inAbove ? 'price' : 'above';

          // Find date index
          const markets = defaultType === 'above' ? aboveList : priceList;
          const now = Date.now();
          const dates = Array.from(new Set(markets.filter(m => m.endDate && new Date(m.endDate).getTime() > now).map(m => m.endDate))).sort();
          const mEndDate = curSelectedMarket.endDate || '';
          const dIdx = dates.indexOf(mEndDate);
          if (dIdx >= 0) defaultDateIdx = dIdx;

          // Find strike index
          const selectedDate = dates[defaultDateIdx] || dates[0] || '';
          const strikes = markets.filter(m => m.endDate === selectedDate).sort((a, b) => {
            const pa = parseFloat((a.groupItemTitle || '').replace(/[^0-9.-]/g, '')) || 0;
            const pb = parseFloat((b.groupItemTitle || '').replace(/[^0-9.-]/g, '')) || 0;
            return pa - pb;
          });
          const sIdx = strikes.findIndex(m => m.id === curSelectedMarket.id);
          if (sIdx >= 0) defaultStrikeIdx = sIdx;
        }

        setLegs([
          { id: Date.now(), asset: defaultAsset, type: defaultType, side: defaultSide, dateIdx: defaultDateIdx, strikeIdx: defaultStrikeIdx, priceCents: '', entryMode: 'manual', entryArg: '', entryMin: '', entryMax: '' },
        ]);
      }
    }
    prevOpenRef.current = open;
  }, [open]);

  // Get available dates for an asset+type combo
  const getDates = useCallback((asset: AssetName, type: string): string[] => {
    const markets = type === 'above' ? (aboveMarkets[asset] || []) : (priceOnMarkets[asset] || []);
    const dateSet = new Set<string>();
    const now = Date.now();
    for (const m of markets) {
      if (m.endDate && new Date(m.endDate).getTime() > now) {
        dateSet.add(m.endDate);
      }
    }
    return Array.from(dateSet).sort();
  }, [aboveMarkets, priceOnMarkets]);

  // Get available strikes for asset+type+date
  const getStrikes = useCallback((asset: AssetName, type: string, endDate: string): Market[] => {
    const markets = type === 'above' ? (aboveMarkets[asset] || []) : (priceOnMarkets[asset] || []);
    return markets.filter((m) => m.endDate === endDate).sort((a, b) => {
      const pa = parseFloat((a.groupItemTitle || '').replace(/[^0-9.-]/g, '')) || 0;
      const pb = parseFloat((b.groupItemTitle || '').replace(/[^0-9.-]/g, '')) || 0;
      return pa - pb;
    });
  }, [aboveMarkets, priceOnMarkets]);

  const updateLeg = (idx: number, updates: Partial<LegState>) => {
    setLegs((prev) => prev.map((l, i) => i === idx ? { ...l, ...updates } : l));
  };

  const addLeg = () => {
    setLegs((prev) => [
      ...prev,
      { id: Date.now(), asset: 'BTC', type: 'above', side: prev.length % 2 === 0 ? 'YES' : 'NO', dateIdx: 0, strikeIdx: 0, priceCents: '', entryMode: 'manual', entryArg: '', entryMin: '', entryMax: '' },
    ]);
  };

  const removeLeg = (idx: number) => {
    if (legs.length <= 1) return;
    setLegs((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleClose = () => {
    setOpen(false);
    setProgDialogData(null);
  };

  const toggleSizeMode = () => {
    const next = sizeMode === 'usd' ? 'shares' : 'usd';
    setSizeMode(next);
    localStorage.setItem('mp-size-mode', next);
  };

  const handleCreate = async () => {
    if (creating) return;
    const rawSize = parseFloat(size) || 0;
    if (rawSize <= 0) return showToast('Enter a size', 'error');
    if (legs.length < 1) return showToast('Add at least 1 leg', 'error');

    // Build leg data
    const legData: { asset: string; strike: string; tokenId: string; bsAnchor: string | null; vwapCondition: string | null }[] = [];
    const legPrices: number[] = [];
    let endDate: string | null = null;

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const dates = getDates(leg.asset, leg.type);
      const date = dates[leg.dateIdx] || dates[0];
      if (!date) return showToast(`Leg ${i + 1}: no date available`, 'error');
      const strikes = getStrikes(leg.asset, leg.type, date);
      const market = strikes[leg.strikeIdx] || strikes[0];
      if (!market) return showToast(`Leg ${i + 1}: no market available`, 'error');
      const tokenId = leg.side === 'YES' ? (market.clobTokenIds[0] || '') : (market.clobTokenIds[1] || '');
      if (!tokenId) return showToast(`Leg ${i + 1}: invalid token`, 'error');
      // Map entry mode to bsAnchor
      let bsAnchor: string | null = null;
      const mode = leg.entryMode;
      const arg = parseFloat(leg.entryArg) || 0;
      const entryMin = parseFloat(leg.entryMin) || 0;
      const entryMax = parseFloat(leg.entryMax) || 0;
      if (mode === 'bs1') bsAnchor = `bs1:${entryMin}:${entryMax || ''}`;
      else if (mode === 'bs2') bsAnchor = `bs2:${entryMin}:${entryMax || ''}`;
      else if (mode === 'bss') bsAnchor = `bss:${arg}`;
      else if (mode === 'px') bsAnchor = `px:${parseFloat(leg.priceCents) || 0}`;
      else if (mode.startsWith('bs1_') || mode.startsWith('bs2_')) bsAnchor = `${mode}:${arg}`;

      legData.push({ asset: leg.asset, strike: market.groupItemTitle || '', tokenId, bsAnchor, vwapCondition: null });
      const priceCents = parseFloat(leg.priceCents) || 0;
      legPrices.push(priceCents > 0 ? priceCents / 100 : 0);
      if (!endDate) endDate = date;
    }

    // Check if backend has API credentials before proceeding
    const backendAuthed = await checkBackendAuth();
    if (!backendAuthed) {
      // Store the create action and show consent dialog
      pendingCreateRef.current = async () => {
        await doCreate(legData, legPrices, endDate, rawSize);
      };
      setShowConsentDialog(true);
      return;
    }

    await doCreate(legData, legPrices, endDate, rawSize);
  };

  const doCreate = async (
    legData: { asset: string; strike: string; tokenId: string; bsAnchor: string | null; vwapCondition: string | null }[],
    legPrices: number[],
    endDate: string | null,
    rawSize: number,
  ) => {
    setCreating(true);
    try {
      const payload: Parameters<typeof createProgArb>[0] = {
        legs: legData,
        endDate,
        noOrders: true,
        expiryMinutes: parseInt(expiryMin) || 150,
        loop,
      };
      if (sizeMode === 'usd') {
        payload.dollarSize = rawSize;
      } else {
        payload.size = Math.floor(rawSize);
      }
      if (autoSell) {
        payload.autoSell = true;
        payload.autoSellMode = autoSellMode;
        if (autoSellMode === 'price') {
          const pv = parseFloat(autoSellPrice) || 0;
          payload.autoSellPrice = pv > 0 ? pv / 100 : null;
        }
        if (['bss', 'ent_pct', 'ent_price', 'bs1_pct', 'bs2_pct'].includes(autoSellMode)) {
          payload.autoSellSpread = parseFloat(autoSellSpread) || 10;
        }
      }

      localStorage.setItem('mp-size', size);
      localStorage.setItem('mp-expiry', expiryMin);

      const result = await createProgArb(payload);
      if (result.success && result.id) {
        showToast(`Smart order #${result.id} created (${legData.length} legs)`, 'success');
        // Place orders for legs with prices
        for (let i = 0; i < legPrices.length; i++) {
          if (legPrices[i] > 0) {
            try { await rebidProg(result.id, i, legPrices[i]); } catch { /* ignore */ }
          }
        }
        setOpen(false);
        setLegs([]);
      } else {
        showToast(result.error || 'Failed to create', 'error');
      }
    } catch (e: unknown) {
      showToast('Failed: ' + (e instanceof Error ? e.message : 'unknown'), 'error');
    }
    setCreating(false);
  };

  const handleConsentConfirm = async () => {
    try {
      await sendCredsToBackend();
      setShowConsentDialog(false);
      showToast('API credentials sent to backend', 'success');
      // Now execute the pending create
      if (pendingCreateRef.current) {
        await pendingCreateRef.current();
        pendingCreateRef.current = null;
      }
    } catch (err) {
      setShowConsentDialog(false);
      showToast('Failed to delegate API keys: ' + (err instanceof Error ? err.message : 'unknown'), 'error');
      pendingCreateRef.current = null;
    }
  };

  const handleConsentCancel = () => {
    setShowConsentDialog(false);
    pendingCreateRef.current = null;
  };

  if (!open) return null;

  const exitModeNeedsPrice = autoSellMode === 'price';
  const exitModeNeedsSpread = ['bss', 'ent_pct', 'ent_price', 'bs1_pct', 'bs2_pct'].includes(autoSellMode);

  return (
    <>
    <div className="fixed inset-0 bg-black/60 z-[50000] flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="bg-gray-800 rounded-lg p-5 max-w-md w-full mx-4 shadow-xl border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-bold text-emerald-400">Create Smart Order</div>
          <button onClick={handleClose} className="text-gray-500 hover:text-white text-lg">&times;</button>
        </div>

        <div className="space-y-3">
          {/* Legs */}
          {legs.map((leg, idx) => {
            const dates = getDates(leg.asset, leg.type);
            const selectedDate = dates[leg.dateIdx] || dates[0] || '';
            const strikes = getStrikes(leg.asset, leg.type, selectedDate);
            return (
              <div key={leg.id} className="border border-gray-700 rounded p-2">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-xs font-bold text-gray-300">Leg {idx + 1}</span>
                  <button onClick={() => updateLeg(idx, { side: 'YES' })}
                    className={`px-1.5 py-0 rounded text-[9px] font-bold ${leg.side === 'YES' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400'}`}>YES</button>
                  <button onClick={() => updateLeg(idx, { side: 'NO' })}
                    className={`px-1.5 py-0 rounded text-[9px] font-bold ${leg.side === 'NO' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-400'}`}>NO</button>
                  <span className="flex-1" />
                  {legs.length > 1 && (
                    <button onClick={() => removeLeg(idx)} className="text-gray-500 hover:text-red-400 text-xs">&times;</button>
                  )}
                </div>
                <div className="flex gap-1 mb-1">
                  <select value={leg.asset} onChange={(e) => updateLeg(idx, { asset: e.target.value as AssetName, dateIdx: 0, strikeIdx: 0 })}
                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white w-16" style={{ outline: 'none' }}>
                    {ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <select value={leg.type} onChange={(e) => updateLeg(idx, { type: e.target.value as 'above' | 'price', dateIdx: 0, strikeIdx: 0 })}
                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white w-20" style={{ outline: 'none' }}>
                    <option value="above">Above</option>
                    <option value="price">Between</option>
                  </select>
                  <select value={leg.dateIdx} onChange={(e) => updateLeg(idx, { dateIdx: parseInt(e.target.value), strikeIdx: 0 })}
                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white w-20" style={{ outline: 'none' }}>
                    {dates.map((d, i) => <option key={d} value={i}>{getDateLabel(d)}</option>)}
                  </select>
                  <select value={leg.strikeIdx} onChange={(e) => updateLeg(idx, { strikeIdx: parseInt(e.target.value) })}
                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-white flex-1 truncate" style={{ outline: 'none' }}>
                    {strikes.map((m, i) => <option key={m.id} value={i}>{m.groupItemTitle || m.question}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-1 text-[10px] flex-wrap">
                  <span className="text-gray-400 font-bold">Entry:</span>
                  <select value={leg.entryMode} onChange={(e) => updateLeg(idx, { entryMode: e.target.value })}
                    className="bg-gray-700 border border-gray-600 rounded px-1 py-0 text-[10px] text-white" style={{ outline: 'none' }}>
                    <option value="manual">Manual</option>
                    <option value="px">PX (fixed)</option>
                    <optgroup label="── AT BS ──">
                      <option value="bs1">BS1 min</option>
                      <option value="bs2">BS2 min</option>
                      <option value="bss">BS-Spread</option>
                    </optgroup>
                    <optgroup label="── ▼ BELOW BS ──">
                      <option value="bs1_minus_p">BS1 − ¢</option>
                      <option value="bs1_minus_pct">BS1 − %</option>
                      <option value="bs2_minus_p">BS2 − ¢</option>
                      <option value="bs2_minus_pct">BS2 − %</option>
                    </optgroup>
                    <optgroup label="── ▲ ABOVE BS ──">
                      <option value="bs1_plus_p">BS1 + ¢</option>
                      <option value="bs1_plus_pct">BS1 + %</option>
                      <option value="bs2_plus_p">BS2 + ¢</option>
                      <option value="bs2_plus_pct">BS2 + %</option>
                    </optgroup>
                  </select>
                  {(leg.entryMode === 'manual' || leg.entryMode === 'px') && (
                    <input type="text" value={leg.priceCents} onChange={(e) => updateLeg(idx, { priceCents: e.target.value })}
                      className="bg-gray-700 border border-gray-600 rounded px-2 py-0 text-xs text-white w-16 no-spin" style={{ outline: 'none' }}
                      placeholder="¢" />
                  )}
                  {leg.entryMode === 'bss' && (
                    <span className="flex items-center gap-0.5">
                      <input type="number" value={leg.entryArg || '10'} onChange={(e) => updateLeg(idx, { entryArg: e.target.value })}
                        className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-10 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
                      <span className="text-[9px] text-gray-500">%</span>
                    </span>
                  )}
                  {['bs1_minus_p', 'bs2_minus_p', 'bs1_plus_p', 'bs2_plus_p'].includes(leg.entryMode) && (
                    <span className="flex items-center gap-0.5">
                      <input type="number" value={leg.entryArg || '5'} onChange={(e) => updateLeg(idx, { entryArg: e.target.value })}
                        className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-12 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
                      <span className="text-[9px] text-gray-500">¢</span>
                    </span>
                  )}
                  {['bs1_minus_pct', 'bs2_minus_pct', 'bs1_plus_pct', 'bs2_plus_pct'].includes(leg.entryMode) && (
                    <span className="flex items-center gap-0.5">
                      <input type="number" value={leg.entryArg || '10'} onChange={(e) => updateLeg(idx, { entryArg: e.target.value })}
                        className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-10 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
                      <span className="text-[9px] text-gray-500">%</span>
                    </span>
                  )}
                  {['bs1', 'bs2'].includes(leg.entryMode) && (
                    <span className="flex items-center gap-0.5">
                      <span className="text-[9px] text-gray-500">min</span>
                      <input type="number" value={leg.entryMin || '0.1'} onChange={(e) => updateLeg(idx, { entryMin: e.target.value })}
                        className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-12 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
                      <span className="text-[9px] text-gray-500">¢ max</span>
                      <input type="number" value={leg.entryMax} onChange={(e) => updateLeg(idx, { entryMax: e.target.value })}
                        className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-12 text-[10px] text-white no-spin" style={{ outline: 'none' }} placeholder="--" />
                      <span className="text-[9px] text-gray-500">¢</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          <button onClick={addLeg} className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add Leg
          </button>

          {/* Size */}
          <div className="border-t border-gray-700 pt-2">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-gray-400">Size:</label>
              <button onClick={toggleSizeMode}
                className={`px-1.5 py-0.5 text-[10px] font-bold rounded transition ${sizeMode === 'usd' ? 'bg-yellow-700 text-yellow-200' : 'bg-blue-700 text-blue-200'}`}>
                {sizeMode === 'usd' ? 'USD' : 'Shares'}
              </button>
              <input type="number" value={size} onChange={(e) => setSize(e.target.value)}
                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 w-24 text-white text-sm font-bold no-spin" style={{ outline: 'none' }} />
              {sizeMode === 'usd' ? (
                <span className="flex gap-0.5">
                  {[5, 10, 25, 50, 100].map((d) => (
                    <button key={d} onClick={() => setSize(String((parseFloat(size) || 0) + d))}
                      className="px-1.5 py-0.5 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition">${d}</button>
                  ))}
                </span>
              ) : (
                <span className="flex gap-0.5">
                  {[100, 1000, 10000, 25000].map((d) => (
                    <button key={d} onClick={() => setSize(String((parseInt(size) || 0) + d))}
                      className="px-1.5 py-0.5 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition">
                      {d >= 1000 ? `${d / 1000}k` : d}
                    </button>
                  ))}
                </span>
              )}
            </div>
          </div>

          {/* Exit Settings */}
          {autoSell && (
            <div className="border-t border-gray-700 pt-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-yellow-400 font-bold">Exit:</span>
                <select value={autoSellMode} onChange={(e) => setAutoSellMode(e.target.value)}
                  className="bg-gray-700 border border-gray-600 rounded px-1 py-0 text-[10px] text-white" style={{ outline: 'none' }}>
                  <option value="price">Fixed Price</option>
                  <optgroup label="── AT BS ──">
                    <option value="bs1">BS1 max</option>
                    <option value="bs2">BS2 max</option>
                    <option value="bss">BS+Spread</option>
                  </optgroup>
                  <optgroup label="── ▲ ABOVE ENTRY ──">
                    <option value="ent_pct">Entry + %</option>
                    <option value="ent_price">Entry + ¢</option>
                  </optgroup>
                  <optgroup label="── ▼ BELOW BS ──">
                    <option value="bs1_pct">BS1 − %</option>
                    <option value="bs2_pct">BS2 − %</option>
                  </optgroup>
                </select>
                {exitModeNeedsPrice && (
                  <span className="flex items-center gap-1">
                    <input type="number" value={autoSellPrice} onChange={(e) => setAutoSellPrice(e.target.value)}
                      className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-14 text-[10px] text-white no-spin" style={{ outline: 'none' }} placeholder="¢" />
                    <span className="text-[10px] text-gray-500">¢</span>
                  </span>
                )}
                {exitModeNeedsSpread && (
                  <span className="flex items-center gap-0.5">
                    <input type="number" value={autoSellSpread} onChange={(e) => setAutoSellSpread(e.target.value)}
                      className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-10 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
                    <span className="text-[9px] text-gray-500">{autoSellMode === 'ent_price' ? '¢' : '%'}</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* General Settings */}
          <div className="border-t border-gray-700 pt-2">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-[10px] text-gray-400 flex items-center gap-1">
                Exp
                <input type="number" value={expiryMin} onChange={(e) => setExpiryMin(e.target.value)}
                  className="bg-gray-700 border border-gray-600 rounded px-1 py-0 w-12 text-[10px] text-white no-spin" style={{ outline: 'none' }} />
                min
              </label>
              <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
                <input type="checkbox" checked={autoSell} onChange={(e) => setAutoSell(e.target.checked)}
                  className="w-3 h-3 accent-yellow-500" /> Auto Exit
              </label>
              <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)}
                  className="w-3 h-3 accent-blue-500" /> Loop
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button onClick={handleClose}
              className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-xs font-medium transition">Cancel</button>
            <button onClick={handleCreate} disabled={creating}
              className={`px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 rounded text-xs font-medium transition ${creating ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {creating ? '...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
    <ApiKeyConsentDialog open={showConsentDialog} onConfirm={handleConsentConfirm} onCancel={handleConsentCancel} />
    </>
  );
}
