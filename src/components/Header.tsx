import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
import { RefreshCw, Clock, Settings, Plus, Github, Send } from 'lucide-react';
import logoSvg from '../assets/logo.svg';
import { HelpTooltip } from './HelpTooltip';
import { WalletButton } from './WalletButton';
import { useAppStore } from '../stores/appStore';
import { saveSetting } from '../api';
import { gridSizeFromDefaultLayoutMins } from '../lib/defaultLayouts';
import type { PanelType } from '../types';
import { PrivateKeyImportDialog, getStoredPrivateKey } from './PrivateKeyImportDialog';

const IS_DEV = import.meta.env.DEV;

const ALL_PANEL_TYPES: { type: PanelType; title: string; multi?: boolean; devOnly?: boolean }[] = [
  { type: 'asset-BTC', title: 'Market Grid', multi: true },
  // { type: 'arbs', title: 'Hedges' },
  // { type: 'summary', title: 'Summary' },
  { type: 'signals', title: 'Signals' },
  { type: 'smart-money', title: 'Smart Money' },
  { type: 'trades-positions-orders', title: 'Trades/Positions/Orders' },
  { type: 'pnl', title: 'P&L' },
  { type: 'updown-overview', title: 'Up/Down Markets' },
  { type: 'updown-hud', title: 'UpOrDown HUD' },
  { type: 'relative-chart', title: 'Relative Chart' },
  { type: 'perp-bot', title: 'Perp Bot', devOnly: true },
  { type: 'price-forecast', title: 'Price Forecast' },
  { type: 'binance-chart', title: 'Asset Candle Chart', multi: true },
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
  const setPanels = useAppStore((s) => s.setPanels);
  const setLayouts = useAppStore((s) => s.setLayouts);
  const addPanel = useAppStore((s) => s.addPanel);

  const [refreshing, setRefreshing] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [showOrderDialog, setShowOrderDialog] = useState(true);
  const [isNarrowScreen, setIsNarrowScreen] = useState(() => window.innerWidth < 1200);

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

  useEffect(() => {
    const onResize = () => setIsNarrowScreen(window.innerWidth < 1200);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleAddPanel = useCallback(
    (type: PanelType, title: string) => {
      const id = type + '-' + Date.now();
      if (layouts) {
        const newLayouts: Record<string, unknown[]> = {};
        for (const [bp, lay] of Object.entries(layouts)) {
          const items = lay as { i: string; x: number; y: number; w: number; h: number }[];
          const maxY = items.reduce((m, l) => Math.max(m, l.y + l.h), 0);
          const { w, h } = gridSizeFromDefaultLayoutMins(type, bp);
          newLayouts[bp] = [
            ...items,
            { i: id, x: 0, y: maxY, w, h, minW: 1, minH: 1 },
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
    <header className="mb-1 relative z-[220]">
      <div className="flex items-center gap-2">
        {/* Brand */}
        <div className="flex items-center gap-1.5 h-[28px] flex-shrink-0 min-w-0">
          <img src={logoSvg} alt="logo" className="h-5 w-5 flex-shrink-0 min-w-5 min-h-5" />
          <span className="text-sm font-bold text-white tracking-tight max-[424px]:hidden">Mito</span>
        </div>

        <div className="flex-1" />

        {/* B-S Time Offset Slider */}
        <div className="max-[767px]:hidden flex items-center gap-1 bg-gray-800/50 rounded px-2 h-[28px] min-w-0 w-[min(34vw,260px)]">
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
        {!isNarrowScreen && (
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
        )}

        <button
          onClick={async () => {
            if (refreshing) return;
            setRefreshing(true);
            try { await onRefresh(); } finally { setRefreshing(false); }
          }}
          disabled={refreshing}
          className="max-[999px]:hidden bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-3 rounded text-xs font-medium transition flex items-center gap-1 h-[28px]"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        {/* Add Pane */}
        <div className="relative" ref={addMenuRef}>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white rounded px-2 max-[639px]:px-1.5 text-xs font-medium transition border border-gray-600 h-[28px] whitespace-nowrap flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            <span className="max-[639px]:hidden">Panel</span>
          </button>
          {showAddMenu && (
            <div className="absolute right-0 max-[639px]:left-0 max-[639px]:right-auto mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px] w-[min(220px,calc(100vw-16px))] z-50">
              {ALL_PANEL_TYPES.filter((t) => !t.devOnly || IS_DEV).map((t) => (
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
            <div className="absolute right-0 max-[639px]:left-0 max-[639px]:right-auto mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-2 px-3 min-w-[200px] w-[min(260px,calc(100vw-16px))] z-[260]">
              {isNarrowScreen && (
                <div className="mb-2 pb-2 border-b border-gray-700">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-[10px] text-gray-400 font-semibold">VWAP</span>
                    <HelpTooltip text={"VWAP (Volume Weighted Average Price) is the average price weighted by volume over a given period.\n\nThe VWAP price is used as the underlying price when calculating Black-Scholes probabilities.\n\nThe first input sets the lookback window in minutes (how many 1-minute candles to use).\n\nThe ± correction is applied to the set price ranges to account for VWAP deviation from live price. For example, if a range is set to 600-700 but the 700 is expected to be a wick, setting ± to 0.5 will calculate the B-S probability at the range edge minus 0.5%, accounting for the fact that a short wick won't move the B-S probability significantly.\n\nTo use the live price instead of VWAP, set both values to 0."} />
                  </div>
                  <div className="flex items-center gap-1">
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
                </div>
              )}
              <div className="mb-2 pb-2 border-b border-gray-700 min-[768px]:hidden">
                <div className="flex items-center gap-1 mb-1">
                  <Clock className={`w-3.5 h-3.5 ${bsTimeOffsetHours > 0 ? 'text-yellow-400' : 'text-gray-500'}`} />
                  <span className={`text-[10px] ${bsTimeOffsetHours > 0 ? 'text-yellow-400 font-bold' : 'text-gray-500'}`}>
                    Time Machine +{bsTimeOffsetHours}h
                  </span>
                  <HelpTooltip text={"Time Machine — slide to see how B-S probability values will change in the future.\n\nSince Black-Scholes probabilities depend on the time remaining until expiration, this slider lets you fast-forward by up to 72 hours. As time to expiry shrinks, probabilities shift — markets near the strike become more sensitive and move toward 0 or 100.\n\nUse this to preview how your positions and potential entries will look as expiry approaches, helping you plan trades ahead of time."} />
                </div>
                <input
                  type="range"
                  min="0"
                  max="72"
                  value={bsTimeOffsetHours}
                  step="1"
                  className="vol-slider w-full"
                  onChange={(e) => setBsTimeOffsetHours(parseInt(e.target.value))}
                />
              </div>
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
              <div className="mt-2 pt-2 border-t border-gray-700 space-y-1">
                <a
                  href="https://github.com/mriusd/mito"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-gray-700 rounded transition"
                  onClick={() => setShowSettings(false)}
                >
                  <Github className="w-3.5 h-3.5 flex-shrink-0" />
                  GitHub
                </a>
                <a
                  href="https://t.me/+fy8YkW8NqMk0Y2Ji"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-gray-700 rounded transition"
                  onClick={() => setShowSettings(false)}
                >
                  <Send className="w-3.5 h-3.5 flex-shrink-0" />
                  MITO Chat (Telegram)
                </a>
              </div>
              <div className="mt-2 pt-2 border-t border-gray-700">
                <button
                  onClick={() => {
                    const defaultPanels = [
                      { id: 'asset-BTC', type: 'asset-BTC', title: 'BTC' },
                      { id: 'trades-positions-orders', type: 'trades-positions-orders', title: 'Trades/Positions/Orders' },
                      { id: 'updown-overview', type: 'updown-overview', title: 'Up/Down Markets' },
                      { id: 'signals', type: 'signals', title: 'Signals' },
                      { id: 'chat', type: 'chat', title: 'Chat' },
                    ];
                    localStorage.removeItem('polybot-react-panels');
                    localStorage.removeItem('polybot-react-layouts');
                    localStorage.removeItem('polybot-removed-panels');
                    setPanels(defaultPanels as any);
                    setLayouts(null as any);
                    setShowSettings(false);
                    window.location.reload();
                  }}
                  className="w-full text-left px-2 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-gray-700 rounded transition"
                >
                  Restore default layout
                </button>
              </div>
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
            <span className="text-[10px] text-gray-400 max-[639px]:hidden">Val</span>
            <span className="text-xs font-bold text-green-400 max-[639px]:hidden">${portfolioValue.toFixed(2)}</span>
            <span className="text-[10px] text-gray-400">Cash</span>
            <span className="text-xs font-bold text-blue-400">${cashBalance.toFixed(2)}</span>
            <HelpTooltip text="Val: Total value of your open positions on Polymarket. Cash: Available USDC balance in your Polymarket wallet." />
          </a>
        )}

        {/* Signing Mode Switch */}
        {walletConnected && <SigningModeSwitch />}

        {/* Wallet Connect */}
        <WalletButton />
      </div>
    </header>
  );
}

function SigningModeSwitch() {
  const signingMode = useAppStore((s) => s.signingMode);
  const setSigningMode = useAppStore((s) => s.setSigningMode);
  const [pkDialogOpen, setPkDialogOpen] = useState(false);
  const [hasPk, setHasPk] = useState(!!getStoredPrivateKey());

  const refreshPk = () => setHasPk(!!getStoredPrivateKey());

  const handleClick = (mode: 'wallet' | 'privateKey') => {
    if (mode === 'wallet') {
      setSigningMode('wallet');
      return;
    }
    if (!hasPk) {
      setPkDialogOpen(true);
    } else if (signingMode === 'privateKey') {
      setPkDialogOpen(true);
    } else {
      setSigningMode('privateKey');
    }
  };

  return (
    <>
      <div className="flex items-center rounded border border-gray-600 overflow-hidden text-[9px] font-bold h-[28px]">
        <button
          type="button"
          className={`px-2 h-full transition ${signingMode === 'wallet' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
          onClick={() => handleClick('wallet')}
        >
          Wallet
        </button>
        <button
          type="button"
          className={`px-2 h-full transition flex items-center gap-1 ${signingMode === 'privateKey' ? 'bg-yellow-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
          onClick={() => handleClick('privateKey')}
        >
          PK
          {signingMode === 'privateKey' && hasPk && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
        </button>
      </div>
      <PrivateKeyImportDialog
        open={pkDialogOpen}
        onDone={() => {
          setPkDialogOpen(false);
          refreshPk();
          setSigningMode('privateKey');
        }}
        onCancel={() => {
          setPkDialogOpen(false);
          refreshPk();
          if (!getStoredPrivateKey() && signingMode === 'privateKey') {
            setSigningMode('wallet');
          }
        }}
      />
    </>
  );
}
