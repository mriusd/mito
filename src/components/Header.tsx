import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
import { RefreshCw, Clock, Settings, Plus } from 'lucide-react';
import logoSvg from '../assets/logo.svg';
import { HelpTooltip } from './HelpTooltip';
import { WalletButton } from './WalletButton';
import { useAppStore } from '../stores/appStore';
import { saveSetting } from '../api';
import type { PanelType } from '../types';

const ALL_PANEL_TYPES: { type: PanelType; title: string; multi?: boolean }[] = [
  { type: 'asset-BTC', title: 'Market Grid', multi: true },
  // { type: 'arbs', title: 'Hedges' },
  // { type: 'summary', title: 'Summary' },
  { type: 'signals', title: 'Signals' },
  { type: 'trades-positions-orders', title: 'Trades/Positions/Orders' },
  { type: 'pnl', title: 'P&L' },
  { type: 'updown-overview', title: 'Up/Down Markets' },
  { type: 'chat', title: 'Chat' },
];

interface HeaderProps {
  onRefresh: () => Promise<void>;
}

export function Header({ onRefresh }: HeaderProps) {
  const { isConnected: walletConnected } = useAccount();
  const vwapCandles = useAppStore((s) => s.vwapCandles);
  const setVwapCandles = useAppStore((s) => s.setVwapCandles);
  const vwapCorrection = useAppStore((s) => s.vwapCorrection);
  const setVwapCorrection = useAppStore((s) => s.setVwapCorrection);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);
  const setBsTimeOffsetHours = useAppStore((s) => s.setBsTimeOffsetHours);
  const cashBalance = useAppStore((s) => s.cashBalance);
  const positions = useAppStore((s) => s.positions);
  const layouts = useAppStore((s) => s.layouts);
  const setLayouts = useAppStore((s) => s.setLayouts);
  const addPanel = useAppStore((s) => s.addPanel);

  const [refreshing, setRefreshing] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [showOrderDialog, setShowOrderDialog] = useState(() => localStorage.getItem('signing-dialog-hidden') !== 'true');

  // Close add menu / settings on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleAddPanel = useCallback(
    (type: PanelType, title: string) => {
      const id = type + '-' + Date.now();
      const isAsset = type.startsWith('asset-');
      if (layouts) {
        const newLayouts: Record<string, unknown[]> = {};
        for (const [bp, lay] of Object.entries(layouts)) {
          const items = lay as { i: string; x: number; y: number; w: number; h: number }[];
          const maxY = items.reduce((m, l) => Math.max(m, l.y + l.h), 0);
          newLayouts[bp] = [
            ...items,
            { i: id, x: 0, y: maxY, w: isAsset ? 12 : 24, h: isAsset ? 8 : 6, minW: 4, minH: 3 },
          ];
        }
        setLayouts(newLayouts as any);
      }
      addPanel({ id, type, title });
      setShowAddMenu(false);
    },
    [addPanel, layouts, setLayouts]
  );


  // Portfolio value
  const portfolioValue = positions.reduce((sum, p) => {
    const size = p.size || 0;
    const price = p.curPrice || 0;
    return sum + size * price;
  }, 0);

  // Local state for VWAP inputs to avoid clamping mid-type
  const [vwapCandlesLocal, setVwapCandlesLocal] = useState(String(vwapCandles));
  const [vwapCorrLocal, setVwapCorrLocal] = useState(String(vwapCorrection));

  // Sync local state when store changes externally
  useEffect(() => { setVwapCandlesLocal(String(vwapCandles)); }, [vwapCandles]);
  useEffect(() => { setVwapCorrLocal(String(vwapCorrection)); }, [vwapCorrection]);

  const commitVwapCandles = useCallback(() => {
    const v = Math.max(5, Math.min(1440, parseInt(vwapCandlesLocal) || 60));
    setVwapCandlesLocal(String(v));
    setVwapCandles(v);
    saveSetting('vwapCandles', v);
  }, [vwapCandlesLocal, setVwapCandles]);

  const commitVwapCorr = useCallback(() => {
    const v = Math.max(0, Math.min(10, parseFloat(vwapCorrLocal.replace(',', '.')) || 0));
    setVwapCorrLocal(String(v));
    setVwapCorrection(v);
    saveSetting('vwapCorrection', v);
  }, [vwapCorrLocal, setVwapCorrection]);

  return (
    <header className="mb-1">
      <div className="flex items-center gap-2">
        {/* Brand */}
        <div className="flex items-center gap-1.5 h-[28px]">
          <img src={logoSvg} alt="logo" className="h-5 w-5" />
          <span className="text-sm font-bold text-white tracking-tight">Mito</span>
        </div>

        <div className="flex-1" />

        {/* B-S Time Offset Slider */}
        <div className="flex items-center gap-1 bg-gray-800/50 rounded px-2 h-[28px] min-w-0 w-[min(34vw,260px)]">
          <Clock className={`w-3.5 h-3.5 ${bsTimeOffsetHours > 0 ? 'text-yellow-400' : 'text-gray-500'}`} />
          <span className={`text-[9px] ${bsTimeOffsetHours > 0 ? 'text-yellow-400 font-bold' : 'text-gray-500'}`}>
            +{bsTimeOffsetHours}h
          </span>
          <HelpTooltip text={"Time Machine — slide to see how B-S probability values will change in the future.\n\nSince Black-Scholes probabilities depend on the time remaining until expiration, this slider lets you fast-forward by up to 72 hours. As time to expiry shrinks, probabilities shift — markets near the strike become more sensitive and move toward 0 or 100.\n\nUse this to preview how your positions and potential entries will look as expiry approaches, helping you plan trades ahead of time."} />
          <div className="min-w-0 flex-1">
            <input
              type="range"
              min="0"
              max="72"
              value={bsTimeOffsetHours}
              step="1"
              className="vol-slider w-full min-w-0"
              onChange={(e) => setBsTimeOffsetHours(parseInt(e.target.value))}
            />
          </div>
        </div>

        {/* VWAP Candle Count + Correction */}
        <div className="flex items-center gap-1 bg-gray-800/50 rounded px-2 h-[28px]">
          <span className="text-[9px] text-gray-500">VWAP</span>
          <HelpTooltip text={"VWAP (Volume Weighted Average Price) is the average price weighted by volume over a given period.\n\nThe VWAP price is used as the underlying price when calculating Black-Scholes probabilities.\n\nThe first input sets the lookback window in minutes (how many 1-minute candles to use).\n\nThe ± correction is applied to the set price ranges to account for VWAP deviation from live price. For example, if a range is set to 600-700 but the 700 is expected to be a wick, setting ± to 0.5 will calculate the B-S probability at the range edge minus 0.5%, accounting for the fact that a short wick won't move the B-S probability significantly.\n\nTo use the live price instead of VWAP, set both values to 0."} />
          <input
            type="text"
            inputMode="numeric"
            value={vwapCandlesLocal}
            className="text-[11px] text-gray-300 bg-gray-700 border border-gray-600 rounded px-1 w-12 outline-none text-center"
            onChange={(e) => setVwapCandlesLocal(e.target.value)}
            onBlur={commitVwapCandles}
            onKeyDown={(e) => { if (e.key === 'Enter') commitVwapCandles(); }}
          />
          <span className="text-[9px] text-gray-500">m</span>
          <span className="text-[9px] text-gray-500 ml-1">±</span>
          <input
            type="text"
            inputMode="decimal"
            value={vwapCorrLocal}
            className="text-[11px] text-gray-300 bg-gray-700 border border-gray-600 rounded px-1 w-14 outline-none text-center"
            onChange={(e) => setVwapCorrLocal(e.target.value)}
            onBlur={commitVwapCorr}
            onKeyDown={(e) => { if (e.key === 'Enter') commitVwapCorr(); }}
          />
          <span className="text-[9px] text-gray-500">%</span>
        </div>

        <button
          onClick={async () => {
            if (refreshing) return;
            setRefreshing(true);
            try { await onRefresh(); } finally { setRefreshing(false); }
          }}
          disabled={refreshing}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-3 rounded text-xs font-medium transition flex items-center gap-1 h-[28px]"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        {/* Add Pane */}
        <div className="relative" ref={addMenuRef}>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white rounded px-2 text-xs font-medium transition border border-gray-600 h-[28px] whitespace-nowrap flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Panel
          </button>
          {showAddMenu && (
            <div className="absolute right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px] z-50">
              {ALL_PANEL_TYPES.map((t) => (
                  <button
                    key={t.type}
                    onClick={() => handleAddPanel(t.type, t.title)}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-gray-700 transition"
                  >
                    {t.title}
                  </button>
              ))}
            </div>
          )}
        </div>

        {/* Settings */}
        <div className="relative" ref={settingsRef}>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white rounded px-1.5 transition border border-gray-600 h-[28px] flex items-center"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          {showSettings && (
            <div className="absolute right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-2 px-3 min-w-[200px] z-50">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showOrderDialog}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setShowOrderDialog(v);
                    localStorage.setItem('signing-dialog-hidden', v ? 'false' : 'true');
                  }}
                  className="accent-blue-500"
                />
                <span className="text-xs text-gray-300">Show place order dialog</span>
              </label>
            </div>
          )}
        </div>


        {/* Portfolio Value & Cash */}
        {walletConnected && (
          <a
            href="https://polymarket.com/portfolio?r=mito"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-gray-800/50 rounded px-2 h-[28px] hover:bg-gray-700/50 cursor-pointer transition"
          >
            <span className="text-[10px] text-gray-400">Val</span>
            <span className="text-xs font-bold text-green-400">${portfolioValue.toFixed(2)}</span>
            <span className="text-[10px] text-gray-400">Cash</span>
            <span className="text-xs font-bold text-blue-400">${cashBalance.toFixed(2)}</span>
            <HelpTooltip text="Val: Total value of your open positions on Polymarket. Cash: Available USDC balance in your Polymarket wallet." />
          </a>
        )}

        {/* Wallet Connect */}
        <WalletButton />
      </div>
    </header>
  );
}
