import { useState, useEffect, useCallback, useRef, useMemo, memo, Suspense, lazy } from 'react';
import { useAccount } from 'wagmi';
import { RefreshCw, Settings, Plus, Github, Send, Star, Wallet } from 'lucide-react';
import logoSvg from '../assets/logo.svg';
import { HelpTooltip } from './HelpTooltip';
import { portfolioPositionsValueUsd } from '../lib/portfolioMetrics';
import { WalletButton } from './WalletButton';
import { useAppStore } from '../stores/appStore';
import { useTradingWalletAddress } from '../hooks/useTradingWalletAddress';
import { useThrottledGridPositions } from '../hooks/useThrottledGridWallet';
import { saveSetting } from '../api';
import { gridSizeFromDefaultLayoutMins } from '../lib/defaultLayouts';
import type { PanelType } from '../types';
import {
  PrivateKeyWalletMenu,
  getStoredPrivateKey,
  OPEN_PK_MANAGER_EVENT,
} from './PrivateKeyImportDialog';
import { getActivePkWallet, listPkWallets } from '../lib/pkWallets';
import { useSyncHeadWS } from '../hooks/useSyncHeadWS';
import { polymarketSiteUrl } from '../lib/polymarketSiteUrl';
import { importWithChunkReload, lazyWithChunkReload } from '../utils/lazyWithChunkReload';
import { showToast } from '../utils/toast';
import { downloadLayoutFile } from '../lib/layoutExport';
import {
  deleteSavedLayout,
  getActiveLayoutId,
  importLayoutToLibrary,
  listSavedLayouts,
  renameSavedLayout,
  saveCurrentLayoutAs,
  switchToSavedLayout,
  type SavedLayout,
} from '../lib/layoutLibrary';
import type { PanelConfig } from '../types';
import { ErrorBoundary } from './ErrorBoundary';

const IS_DEV = import.meta.env.DEV;

/** Load wallet summary from its own module — not ToxicFlowDialog (huge + circular risk). */
const WalletInfoDialogLazy = lazyWithChunkReload(() =>
  import('./WalletInfoPanel').then((m) => ({ default: m.WalletInfoDialog })),
);

const FavouriteWalletsDialogLazy = lazyWithChunkReload(() =>
  import('./FavouriteWalletsDialog').then((m) => ({ default: m.FavouriteWalletsDialog })),
);

const MarketViewDialogLazy = lazy(() =>
  import('./MarketViewDialog').then((m) => ({ default: m.MarketViewDialog })),
);

function preloadWalletSummaryDialog() {
  void importWithChunkReload(() => import('./WalletInfoPanel'));
}

function walletInfoDialogFallback(error: Error, retry: () => void) {
  return (
    <div className="fixed inset-0 z-[49999] flex items-center justify-center bg-black/70 p-4">
      <div className="max-w-md rounded-lg border border-gray-700 bg-gray-900 p-4 text-center shadow-xl">
        <p className="text-sm font-semibold text-red-300">Wallet summary failed</p>
        <p className="mt-2 break-words text-left text-[11px] text-gray-400 font-mono">
          {error?.message || String(error)}
        </p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-100 hover:bg-gray-600"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function preloadFavouriteWalletsDialog() {
  void importWithChunkReload(() => import('./FavouriteWalletsDialog'));
}

/** UI: lastProcessed − tip from /ws/sync-head (negative = chain head ahead of KV). */
function blockLagToneClass(behindBlocks: number): string {
  if (!Number.isFinite(behindBlocks)) return 'text-gray-400';
  if (behindBlocks >= -2) return 'text-emerald-400';
  if (behindBlocks > -10) return 'text-amber-400';
  return 'text-red-400';
}

const ALL_PANEL_TYPES: { type: PanelType; title: string; multi?: boolean; devOnly?: boolean }[] = [
  { type: 'asset-BTC', title: 'Market Grid', multi: true },
  // { type: 'arbs', title: 'Hedges' },
  // { type: 'summary', title: 'Summary' },
  { type: 'signals', title: 'Signals' },
  { type: 'smart-money', title: 'Smart Money' },
  { type: 'trades-positions-orders', title: 'Trades/Positions/Orders', multi: true },
  { type: 'tpo-positions', title: 'TPO Positions', multi: true },
  { type: 'tpo-orders', title: 'TPO Orders', multi: true },
  { type: 'tpo-trades', title: 'TPO Trades', multi: true },
  { type: 'pnl', title: 'P&L' },
  { type: 'wallet-history', title: 'History' },
  { type: 'updown-overview', title: 'Up/Down Markets' },
  { type: 'updown-hud', title: 'UpOrDown HUD' },
  { type: 'markov', title: 'Markov Chains' },
  { type: 'relative-chart', title: 'Relative Chart' },
  { type: 'perp-bot', title: 'Perp Bot', devOnly: true },
  { type: 'price-forecast', title: 'Price Forecast' },
  { type: 'binance-chart', title: 'Asset Candle Chart', multi: true },
  { type: 'spot-orderbook', title: 'Orderbook' },
  { type: 'pair-trading', title: 'Pair Trading' },
  { type: 'gex', title: 'Dealer GEX' },
  { type: 'liq-map', title: 'Liq Map' },
  { type: 'cvd', title: 'CVD' },
  { type: 'funding-rate', title: 'Funding Rate' },
  { type: 'hyperliquid-outcomes', title: 'Hyperliquid Outcomes' },
  { type: 'weather-markets', title: 'Weather Markets', multi: true },
  { type: 'weather-temperature', title: 'Temperature', multi: true },
  { type: 'weather-temp-bars', title: 'Temp Odds', multi: true },
  { type: 'weather-map', title: 'Weather Map', multi: true },
  { type: 'crypto-buckets', title: 'Crypto Buckets', multi: true },
  { type: 'clock', title: 'Clock', multi: true },
  { type: 'spreads', title: 'Spreads', multi: true },
  { type: 'chat', title: 'Chat' },
];

interface HeaderProps {
  onRefresh: () => Promise<void>;
}

/** Owns sync-head WS — must not live in Header (every new block re-rendered whole header). */
const SyncHeadBlockPill = memo(function SyncHeadBlockPill() {
  const syncHead = useSyncHeadWS();
  if (syncHead == null || syncHead.lastProcessedBlock <= 0) return null;
  const lagTone =
    syncHead.chainHeadBlock > 0 ? blockLagToneClass(syncHead.behindBlocks) : 'text-gray-400';
  const blocksBehindTip =
    syncHead.chainHeadBlock > 0 && syncHead.lastProcessedBlock > 0
      ? syncHead.chainHeadBlock - syncHead.lastProcessedBlock
      : 0;
  const blockPillFlashRed = blocksBehindTip > 5;
  return (
    <a
      href={`https://polygonscan.com/block/${syncHead.lastProcessedBlock}`}
      target="_blank"
      rel="noopener noreferrer"
      className={
        'flex items-center h-[28px] px-1.5 rounded text-[10px] tabular-nums flex-shrink-0 max-[520px]:hidden transition ' +
        (blockPillFlashRed
          ? 'header-sync-block-flash border'
          : 'bg-gray-800/50 hover:bg-gray-700/60 border border-transparent hover:border-gray-600')
      }
      title={
        'KV last_processed_block number; parentheses = lastProcessed − chainTip (negative ⇒ tip ahead). ' +
        '−1 is normal: tip moves with newHeads/logs before the block flush writes KV. Open this block on Polygonscan.' +
        (blockPillFlashRed
          ? ` Pill flashes red when tip − last_processed > 5 (${blocksBehindTip} behind).`
          : '')
      }
    >
      <span className="text-gray-500 mr-1">Block</span>
      <span className="text-gray-200 font-mono">{syncHead.lastProcessedBlock}</span>
      {syncHead.chainHeadBlock > 0 && (
        <span className={`ml-0.5 font-mono ${lagTone}`}>({syncHead.behindBlocks})</span>
      )}
    </a>
  );
});

export function Header({ onRefresh }: HeaderProps) {
  const { isConnected: walletConnected } = useAccount();
  const signingMode = useAppStore((s) => s.signingMode);
  const pkAddress = useAppStore((s) => s.pkAddress);
  const makerAddress = useAppStore((s) => s.makerAddress);
  const vwapCandles = useAppStore((s) => s.vwapCandles);
  const setVwapCandles = useAppStore((s) => s.setVwapCandles);
  const vwapCorrection = useAppStore((s) => s.vwapCorrection);
  const setVwapCorrection = useAppStore((s) => s.setVwapCorrection);
  const cashBalance = useAppStore((s) => s.cashBalance);
  const positions = useThrottledGridPositions(2000);
  const totalVal = useMemo(
    () => portfolioPositionsValueUsd(positions) + cashBalance,
    [positions, cashBalance],
  );
  const layouts = useAppStore((s) => s.layouts);
  const panels = useAppStore((s) => s.panels);
  const setPanels = useAppStore((s) => s.setPanels);
  const setLayouts = useAppStore((s) => s.setLayouts);
  const addPanel = useAppStore((s) => s.addPanel);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const setLiveTradesSource = useAppStore((s) => s.setLiveTradesSource);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const walletSummaryDialogOpen = useAppStore((s) => s.walletSummaryDialogOpen);
  const setWalletSummaryDialogOpen = useAppStore((s) => s.setWalletSummaryDialogOpen);
  const tradingWallet = useTradingWalletAddress();
  const effectiveWalletConnected =
    signingMode === 'privateKey' && pkAddress ? true : walletConnected;
  // Show portfolio once store maker is set for this session. Allow tradingWallet
  // still resolving (empty) so Cash/Val are not stuck at 0 on slow prod loads.
  // Hide only on a real mismatch (wallet switch race).
  const makerLc = makerAddress.trim().toLowerCase();
  const tradingLc = tradingWallet.trim().toLowerCase();
  const walletPortfolioReady =
    !!makerLc && (!tradingLc || makerLc === tradingLc);
  const displayTotalVal = walletPortfolioReady ? totalVal : 0;
  const displayCashBalance = walletPortfolioReady ? cashBalance : 0;

  const [refreshing, setRefreshing] = useState(false);
  const [favouriteWalletsDialogOpen, setFavouriteWalletsDialogOpen] = useState(false);
  const marketViewDialogOpen = useAppStore((s) => s.marketViewDialogOpen);
  const setMarketViewDialogOpen = useAppStore((s) => s.setMarketViewDialogOpen);
  const walletInfoOverlay = useAppStore((s) => s.walletInfoOverlay);
  const closeWalletInfoOverlay = useAppStore((s) => s.closeWalletInfoOverlay);
  const [favouritesWalletInfoAddress, setFavouritesWalletInfoAddress] = useState<string | null>(null);
  /** Frozen when wallet dialog opens — live selectedMarket auto-switch must not remount it. */
  const [walletInfoDialogMarketId, setWalletInfoDialogMarketId] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const layoutFileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [savedLayouts, setSavedLayouts] = useState<SavedLayout[]>(() => listSavedLayouts());
  const [activeLayoutId, setActiveLayoutId] = useState<string | null>(() => getActiveLayoutId());
  const [newLayoutName, setNewLayoutName] = useState('');
  const [editingLayoutId, setEditingLayoutId] = useState<string | null>(null);
  const [editLayoutName, setEditLayoutName] = useState('');
  const [showOrderDialog, setShowOrderDialog] = useState(true);
  const disableMarketPriceWarning = useAppStore((s) => s.disableMarketPriceWarning);
  const setDisableMarketPriceWarning = useAppStore((s) => s.setDisableMarketPriceWarning);
  const autoSwitchNextMarketOnExpiry = useAppStore((s) => s.autoSwitchNextMarketOnExpiry);
  const setAutoSwitchNextMarketOnExpiry = useAppStore((s) => s.setAutoSwitchNextMarketOnExpiry);
  const hideSidebar = useAppStore((s) => s.hideSidebar);
  const setHideSidebar = useAppStore((s) => s.setHideSidebar);
  const maxOrderSizeUsd = useAppStore((s) => s.maxOrderSizeUsd);
  const setMaxOrderSizeUsd = useAppStore((s) => s.setMaxOrderSizeUsd);
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
      showToast(`Panel ${title} added to the bottom of the screen`, 'success');
    },
    [addPanel, layouts, setLayouts]
  );


  // Local state for VWAP inputs to avoid clamping mid-type
  const [vwapCandlesLocal, setVwapCandlesLocal] = useState(String(vwapCandles));
  const [vwapCorrLocal, setVwapCorrLocal] = useState(String(vwapCorrection));
  const [maxOrderSizeUsdLocal, setMaxOrderSizeUsdLocal] = useState(() => String(useAppStore.getState().maxOrderSizeUsd));

  // Sync local state when store changes externally
  useEffect(() => { setVwapCandlesLocal(String(vwapCandles)); }, [vwapCandles]);
  useEffect(() => { setVwapCorrLocal(String(vwapCorrection)); }, [vwapCorrection]);
  useEffect(() => {
    setMaxOrderSizeUsdLocal(String(maxOrderSizeUsd));
  }, [maxOrderSizeUsd]);

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

  const commitMaxOrderSizeUsd = useCallback(() => {
    const raw = maxOrderSizeUsdLocal.trim();
    const v = raw === '' ? 0 : parseFloat(raw.replace(/,/g, ''));
    const n = Number.isFinite(v) && v >= 0 ? v : 0;
    setMaxOrderSizeUsd(n);
    setMaxOrderSizeUsdLocal(String(n));
  }, [maxOrderSizeUsdLocal, setMaxOrderSizeUsd]);

  const walletForHeaderInfoDialog =
    favouritesWalletInfoAddress ??
    (walletSummaryDialogOpen && tradingWallet ? tradingWallet : undefined);

  const closeHeaderWalletInfoDialog = useCallback(() => {
    setFavouritesWalletInfoAddress(null);
    setWalletSummaryDialogOpen(false);
  }, [setWalletSummaryDialogOpen]);

  return (
    <header className="mb-1 relative z-[220]">
      <div className="flex items-center gap-2 w-full min-w-0">
        <div className="flex items-center gap-2 h-[28px] flex-shrink-0 min-w-0">
          <img src={logoSvg} alt="logo" className="h-5 w-5 flex-shrink-0 min-w-5 min-h-5" />
          <span className="text-sm font-bold text-white tracking-tight max-[424px]:hidden flex-shrink-0">Mito</span>
          <SyncHeadBlockPill />
        </div>

        <div className="flex-1 min-w-[8px]" />

        <button
          onClick={async () => {
            if (refreshing) return;
            setRefreshing(true);
            try { await onRefresh(); } finally { setRefreshing(false); }
          }}
          disabled={refreshing}
          aria-label="Refresh"
          title="Refresh"
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded text-xs font-medium transition flex items-center justify-center gap-1 h-[28px] w-[28px] px-0 min-[1000px]:w-auto min-[1000px]:px-3 shrink-0"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="max-[999px]:hidden">Refresh</span>
        </button>

        <div
          className="max-[999px]:hidden inline-flex h-[28px] rounded-lg border border-gray-600/80 bg-gray-950/95 p-0.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)] shrink-0"
          role="group"
          aria-label="Live trades data source"
        >
          <HelpTooltip
            openOnHover
            hoverOpenDelayMs={500}
            wrapClassName="inline-flex flex-1 min-w-0 h-full"
            text={
              'Polygon on-chain fills: sidebar live tape and Polygonscan tx links; market grid uses chain-backed rollups when a wallet is connected.'
            }
          >
            <button
              type="button"
              className={`h-full w-full min-w-[3rem] rounded-md px-2 text-[9px] font-bold leading-none transition ${
                liveTradesSource === 'onchain'
                  ? 'bg-purple-600 text-white shadow-[0_1px_2px_rgba(0,0,0,0.4)]'
                  : 'bg-transparent text-gray-400 hover:text-gray-200'
              }`}
              onClick={() => setLiveTradesSource('onchain')}
            >
              CHAIN
            </button>
          </HelpTooltip>
          <HelpTooltip
            openOnHover
            hoverOpenDelayMs={500}
            wrapClassName="inline-flex flex-1 min-w-0 h-full"
            text={
              'Polymarket public feed: sidebar tape from market WebSocket; portfolio positions and P&L activity from Data API.'
            }
          >
            <button
              type="button"
              className={`h-full w-full min-w-[3rem] rounded-md px-2 text-[9px] font-bold leading-none transition ${
                liveTradesSource === 'polymarket'
                  ? 'bg-blue-600 text-white shadow-[0_1px_2px_rgba(0,0,0,0.4)]'
                  : 'bg-transparent text-gray-400 hover:text-gray-200'
              }`}
              onClick={() => setLiveTradesSource('polymarket')}
            >
              API
            </button>
          </HelpTooltip>
        </div>

        {/* Add Pane */}
        <div className="relative" ref={addMenuRef}>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            aria-label="Add panel"
            className="bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white rounded px-2 max-[999px]:px-1.5 text-xs font-medium transition border border-gray-600 h-[28px] whitespace-nowrap flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            <span className="max-[999px]:hidden">Panel</span>
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
            onClick={() => {
              const next = !showSettings;
              setShowSettings(next);
              if (next) {
                setSavedLayouts(listSavedLayouts());
                setActiveLayoutId(getActiveLayoutId());
              }
            }}
            className="bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white rounded px-1.5 transition border border-gray-600 h-[28px] flex items-center"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          {showSettings && (
            <div className="absolute right-0 max-[639px]:left-0 max-[639px]:right-auto mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-2 px-3 min-w-[200px] w-[min(280px,calc(100vw-16px))] z-[260]">
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
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={disableMarketPriceWarning}
                  onChange={(e) => setDisableMarketPriceWarning(e.target.checked)}
                  className="accent-blue-500"
                />
                <span className="text-xs text-gray-300">Disable market price warning</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={autoSwitchNextMarketOnExpiry}
                  onChange={(e) => setAutoSwitchNextMarketOnExpiry(e.target.checked)}
                  className="accent-blue-500"
                />
                <span className="text-xs text-gray-300">Auto-switch to next market on expiry</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={hideSidebar}
                  onChange={(e) => setHideSidebar(e.target.checked)}
                  className="accent-blue-500"
                />
                <span className="text-xs text-gray-300">Hide Sidebar</span>
              </label>
              <div className="mt-2 pt-2 border-t border-gray-700">
                <label className="flex items-center gap-1 mb-0.5 text-[10px] text-gray-400 font-medium">
                  <span>Max order size (USD)</span>
                  <HelpTooltip text="Default 10. Enter 0 for no limit. Otherwise sidebar orders cannot exceed this notional (limit price × size; market orders use top-of-book price × size)." />
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={maxOrderSizeUsdLocal}
                  onChange={(e) => setMaxOrderSizeUsdLocal(e.target.value)}
                  onBlur={commitMaxOrderSizeUsd}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitMaxOrderSizeUsd();
                  }}
                  className="w-full text-[11px] text-gray-300 bg-gray-700 border border-gray-600 rounded px-1.5 py-1 outline-none"
                  placeholder="10"
                  aria-label="Max order size USD"
                />
              </div>
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
              <div className="mt-2 pt-2 border-t border-gray-700 space-y-1.5">
                <div className="text-[10px] text-gray-400 font-semibold px-1">Layouts</div>

                {savedLayouts.length > 0 && (
                  <ul className="space-y-1 max-h-[160px] overflow-y-auto">
                    {savedLayouts.map((lay) => {
                      const isActive = lay.id === activeLayoutId;
                      return (
                        <li
                          key={lay.id}
                          className={`flex items-center gap-1 rounded border px-1.5 py-1 ${
                            isActive
                              ? 'border-cyan-500/60 bg-cyan-950/30'
                              : 'border-gray-600/80 bg-gray-900/40 hover:border-gray-500'
                          }`}
                        >
                          <button
                            type="button"
                            className="flex-1 min-w-0 text-left"
                            onClick={() => {
                              if (isActive) return;
                              try {
                                switchToSavedLayout(lay.id);
                              } catch (err) {
                                showToast(err instanceof Error ? err.message : 'Switch failed', 'error');
                              }
                            }}
                          >
                            {editingLayoutId === lay.id ? (
                              <input
                                autoFocus
                                value={editLayoutName}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setEditLayoutName(e.target.value)}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === 'Enter') {
                                    renameSavedLayout(lay.id, editLayoutName);
                                    setEditingLayoutId(null);
                                    setSavedLayouts(listSavedLayouts());
                                  }
                                  if (e.key === 'Escape') setEditingLayoutId(null);
                                }}
                                onBlur={() => {
                                  renameSavedLayout(lay.id, editLayoutName);
                                  setEditingLayoutId(null);
                                  setSavedLayouts(listSavedLayouts());
                                }}
                                className="w-full bg-gray-950 border border-cyan-600/50 rounded px-1 py-0.5 text-[11px] text-white"
                              />
                            ) : (
                              <div className="flex items-center gap-1.5 min-w-0">
                                {isActive && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />}
                                <span className={`text-[11px] truncate ${isActive ? 'text-cyan-200 font-semibold' : 'text-gray-200'}`}>
                                  {lay.name}
                                </span>
                              </div>
                            )}
                          </button>
                          <button
                            type="button"
                            title="Rename"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingLayoutId(lay.id);
                              setEditLayoutName(lay.name);
                            }}
                            className="text-gray-400 hover:text-cyan-300 px-0.5 text-[11px] flex-shrink-0"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteSavedLayout(lay.id);
                              setSavedLayouts(listSavedLayouts());
                              setActiveLayoutId(getActiveLayoutId());
                            }}
                            className="text-gray-400 hover:text-red-400 px-0.5 text-xs font-bold flex-shrink-0"
                          >
                            ×
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="flex gap-1">
                  <input
                    type="text"
                    value={newLayoutName}
                    onChange={(e) => setNewLayoutName(e.target.value)}
                    placeholder="Name…"
                    className="flex-1 min-w-0 text-[11px] text-gray-300 bg-gray-700 border border-gray-600 rounded px-1.5 py-1 outline-none"
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      const entry = saveCurrentLayoutAs(newLayoutName);
                      setNewLayoutName('');
                      setSavedLayouts(listSavedLayouts());
                      setActiveLayoutId(entry.id);
                      showToast(`Saved “${entry.name}”`, 'success');
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const entry = saveCurrentLayoutAs(newLayoutName);
                      setNewLayoutName('');
                      setSavedLayouts(listSavedLayouts());
                      setActiveLayoutId(entry.id);
                      showToast(`Saved “${entry.name}”`, 'success');
                    }}
                    className="flex-shrink-0 px-2 py-1 text-[11px] font-bold text-cyan-200 bg-cyan-900/50 hover:bg-cyan-800/60 border border-cyan-700/50 rounded transition"
                  >
                    Save
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    downloadLayoutFile(panels as PanelConfig[], layouts);
                    showToast('Layout downloaded', 'success');
                  }}
                  className="w-full text-left px-2 py-1.5 text-xs text-cyan-300 hover:text-cyan-200 hover:bg-gray-700 rounded transition"
                >
                  Download current
                </button>
                <button
                  type="button"
                  onClick={() => layoutFileInputRef.current?.click()}
                  className="w-full text-left px-2 py-1.5 text-xs text-cyan-300 hover:text-cyan-200 hover:bg-gray-700 rounded transition"
                >
                  Import layout…
                </button>
                <input
                  ref={layoutFileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      try {
                        const text = String(reader.result ?? '');
                        const base = file.name.replace(/\.json$/i, '').replace(/^mito[-_]?/i, '') || 'Imported';
                        importLayoutToLibrary(text, base, true);
                      } catch (err) {
                        showToast(err instanceof Error ? err.message : 'Import failed', 'error');
                      }
                    };
                    reader.onerror = () => showToast('Failed to read file', 'error');
                    reader.readAsText(file);
                  }}
                />
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
                    localStorage.removeItem('polybot-active-layout-id');
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
        {effectiveWalletConnected && (
          <a
            href={polymarketSiteUrl('portfolio')}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-gray-800/50 rounded px-2 h-[28px] hover:bg-gray-700/50 cursor-pointer transition"
          >
            <span className="text-[10px] text-gray-400 max-[639px]:hidden">Val</span>
            <span className="text-xs font-bold text-green-400 max-[639px]:hidden">${displayTotalVal.toFixed(2)}</span>
            <span className="text-[10px] text-gray-400">Cash</span>
            <span className="text-xs font-bold text-blue-400">${displayCashBalance.toFixed(2)}</span>
            <HelpTooltip text="Val: positions (Data API currentValue or size×price) plus Cash. Cash: pUSD + USDC.e in proxy wallet on Polygon." />
          </a>
        )}

        <button
          type="button"
          onClick={() => setFavouriteWalletsDialogOpen(true)}
          onMouseEnter={preloadFavouriteWalletsDialog}
          onFocus={preloadFavouriteWalletsDialog}
          className="shrink-0 rounded border border-yellow-700/45 bg-yellow-950/25 px-1.5 h-[28px] flex items-center justify-center text-yellow-400 hover:bg-yellow-900/35"
          title="Favourite wallets (Toxic flow)"
          aria-label="Favourite wallets"
        >
          <Star className="w-3.5 h-3.5 fill-yellow-400 stroke-amber-600/90" strokeWidth={1} />
        </button>

        <button
          type="button"
          disabled={!selectedMarket?.conditionId?.trim() || !tradingWallet}
          onMouseEnter={preloadWalletSummaryDialog}
          onFocus={preloadWalletSummaryDialog}
          onClick={() => {
            setFavouritesWalletInfoAddress(null);
            setWalletInfoDialogMarketId(selectedMarket?.conditionId?.trim() || '');
            setWalletSummaryDialogOpen(true);
          }}
          className="shrink-0 rounded border border-cyan-600/50 bg-cyan-950/35 px-1.5 h-[28px] flex items-center justify-center text-cyan-200 hover:bg-cyan-900/40 disabled:opacity-40 disabled:pointer-events-none"
          aria-label="Wallet Summary"
          title={
            !effectiveWalletConnected
              ? 'Connect wallet or import private key (PK)'
              : !tradingWallet
                ? 'Wallet address not ready'
                : !selectedMarket?.conditionId?.trim()
                  ? 'Select a market in the sidebar'
                  : 'Wallet summary and trades for this market'
          }
        >
          <Wallet className="w-3.5 h-3.5" />
        </button>

        <SigningModeSwitch />

        <WalletButton />
      </div>

      {walletForHeaderInfoDialog && (
        <ErrorBoundary name="wallet-summary" fallback={walletInfoDialogFallback}>
          <Suspense fallback={null}>
            <WalletInfoDialogLazy
              open
              wallet={walletForHeaderInfoDialog}
              initialMarketId={walletInfoDialogMarketId}
              onClose={closeHeaderWalletInfoDialog}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {favouriteWalletsDialogOpen && (
        <Suspense fallback={null}>
          <FavouriteWalletsDialogLazy
            open
            onClose={() => setFavouriteWalletsDialogOpen(false)}
            onOpenWalletInfo={(wallet) => {
              setFavouritesWalletInfoAddress(wallet.trim().toLowerCase());
              setWalletInfoDialogMarketId(selectedMarket?.conditionId?.trim() || '');
              setWalletSummaryDialogOpen(false);
              setFavouriteWalletsDialogOpen(false);
            }}
          />
        </Suspense>
      )}

      {marketViewDialogOpen && (
        <Suspense fallback={null}>
          <MarketViewDialogLazy open onClose={() => setMarketViewDialogOpen(false)} />
        </Suspense>
      )}

      {walletInfoOverlay ? (
        <ErrorBoundary name="wallet-info-overlay" fallback={walletInfoDialogFallback}>
          <Suspense fallback={null}>
            <WalletInfoDialogLazy
              open
              wallet={walletInfoOverlay.wallet}
              initialMarketId={walletInfoOverlay.initialMarketId}
              overlayZClass="z-[70000]"
              onClose={closeWalletInfoOverlay}
            />
          </Suspense>
        </ErrorBoundary>
      ) : null}
    </header>
  );
}

function SigningModeSwitch() {
  const signingMode = useAppStore((s) => s.signingMode);
  const setSigningMode = useAppStore((s) => s.setSigningMode);
  const pkRevision = useAppStore((s) => s.pkRevision);
  const [pkMenuOpen, setPkMenuOpen] = useState(false);
  const [hasPk, setHasPk] = useState(() => listPkWallets().length > 0);
  const [activeLabel, setActiveLabel] = useState(() => getActivePkWallet()?.label ?? null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const refreshPk = useCallback(() => {
    setHasPk(listPkWallets().length > 0);
    setActiveLabel(getActivePkWallet()?.label ?? null);
  }, []);

  const openPkMenu = useCallback(() => {
    setPkMenuOpen(true);
  }, []);

  useEffect(() => {
    refreshPk();
  }, [pkRevision, refreshPk]);

  useEffect(() => {
    const open = () => openPkMenu();
    window.addEventListener(OPEN_PK_MANAGER_EVENT, open);
    return () => window.removeEventListener(OPEN_PK_MANAGER_EVENT, open);
  }, [openPkMenu]);

  // Click-outside + Escape (same pattern as settings dropdown).
  useEffect(() => {
    if (!pkMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPkMenuOpen(false);
    };
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPkMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocDown);
    };
  }, [pkMenuOpen]);

  const finishPkOk = () => {
    refreshPk();
    setSigningMode('privateKey');
    setPkMenuOpen(false);
  };

  const finishPkCancel = () => {
    refreshPk();
    if (!getStoredPrivateKey() && signingMode === 'privateKey') {
      setSigningMode('wallet');
    }
    setPkMenuOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative flex items-center">
      <div className="flex h-[28px] items-center rounded border border-gray-600 text-[9px] font-bold">
        <button
          type="button"
          className={`h-full rounded-l px-2 transition ${
            signingMode === 'wallet' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => {
            setSigningMode('wallet');
            setPkMenuOpen(false);
          }}
        >
          Wallet
        </button>
        <button
          type="button"
          title={activeLabel ? `PK: ${activeLabel} — click to switch` : 'PK wallets — click to manage'}
          className={`flex h-full max-w-[120px] items-center gap-1 rounded-r px-2 transition ${
            signingMode === 'privateKey'
              ? 'bg-yellow-700 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => {
            const next = !pkMenuOpen;
            setPkMenuOpen(next);
            if (next && hasPk && signingMode !== 'privateKey') {
              setSigningMode('privateKey');
            }
          }}
        >
          <span className="flex-shrink-0">PK</span>
          {signingMode === 'privateKey' && hasPk && activeLabel ? (
            <span className="truncate font-semibold opacity-90">{activeLabel}</span>
          ) : null}
          {signingMode === 'privateKey' && hasPk && (
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-400" />
          )}
          <span className="flex-shrink-0 opacity-70">▾</span>
        </button>
      </div>

      {pkMenuOpen ? (
        <div className="absolute right-0 top-full z-[260] mt-1">
          <PrivateKeyWalletMenu
            onDone={finishPkOk}
            onCancel={finishPkCancel}
            onListChange={refreshPk}
          />
        </div>
      ) : null}
    </div>
  );
}
