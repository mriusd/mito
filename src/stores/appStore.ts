import { create } from 'zustand';
import type { AssetSymbol, Market, Position, Order, Trade, PriceRange, PanelConfig, Signal, ArbOpportunity, ProgArb } from '../types';

interface PriceData {
  price: number;
}

interface VwapData {
  price: number;
  ts: number;
}

interface AppState {
  // Price data
  priceData: Record<AssetSymbol, PriceData>;
  vwapData: Record<AssetSymbol, VwapData>;
  volatilityData: Record<AssetSymbol, number>;

  // Manual price ranges
  manualPriceSlots: Record<AssetSymbol, [PriceRange | null, PriceRange | null]>;
  activeRangeSlot: Record<AssetSymbol, number>;
  useLivePrice: Record<AssetSymbol, boolean>;

  // Settings
  volMultiplier: number;
  vwapCandles: number;
  vwapCorrection: number;
  bsTimeOffsetHours: number;
  showPast: boolean;
  dailyBudget: string;

  // Market data from API
  aboveMarkets: Record<string, Market[]>;
  priceOnMarkets: Record<string, Market[]>;
  weeklyHitMarkets: Record<string, Market[]>;
  upOrDownMarkets: Record<string, Record<string, Market[]>>;
  positions: Position[];
  orders: Order[];
  trades: Trade[];
  cashBalance: number;
  makerAddress: string;
  tokenInfo: Record<string, unknown>;
  progOrderMap: Record<string, unknown>;
  marketCount: number;
  lastUpdated: string;
  loading: boolean;

  // Market lookup by token ID
  marketLookup: Record<string, Market>;

  // Arbs
  arbs: ArbOpportunity[];
  triArbs: ArbOpportunity[];
  signals: Signal[];
  progArbs: ProgArb[];
  arbMatchMult: number;
  signalMakerMode: boolean;
  signalPriceMode: string;
  signalsOnGrid: boolean;

  // Sidebar
  sidebarOpen: boolean;
  selectedMarket: Market | null;
  sidebarOutcome: 'YES' | 'NO';

  // Dialogs
  progDialogOpen: boolean;
  progDialogData: { yesMarket: Market; noMarket: Market; yesAsset: string; noAsset: string; endDate: string } | null;
  arbDialogArb: ArbOpportunity | null;
  editProgArb: ProgArb | null;
  pnlDrilldown: { open: boolean; asset: string; endDates: string[] };

  // Layout panels
  panels: PanelConfig[];
  layouts: ReactGridLayout.Layouts | null;

  // Actions
  setPriceData: (symbol: AssetSymbol, price: number) => void;
  setVwapData: (symbol: AssetSymbol, price: number) => void;
  setVolatilityData: (symbol: AssetSymbol, vol: number) => void;
  setManualPriceSlot: (symbol: AssetSymbol, slot: number, range: PriceRange | null) => void;
  setActiveRangeSlot: (symbol: AssetSymbol, slot: number) => void;
  setUseLivePrice: (symbol: AssetSymbol, use: boolean) => void;
  setVolMultiplier: (v: number) => void;
  setVwapCandles: (v: number) => void;
  setVwapCorrection: (v: number) => void;
  setBsTimeOffsetHours: (v: number) => void;
  setShowPast: (v: boolean) => void;
  setDailyBudget: (v: string) => void;
  setArbMatchMult: (v: number) => void;
  setSignalMakerMode: (v: boolean) => void;
  setSignalPriceMode: (v: string) => void;
  setSignalsOnGrid: (v: boolean) => void;
  setMarketData: (data: Partial<Pick<AppState, 'aboveMarkets' | 'priceOnMarkets' | 'weeklyHitMarkets' | 'upOrDownMarkets' | 'positions' | 'orders' | 'trades' | 'cashBalance' | 'makerAddress' | 'tokenInfo' | 'progOrderMap' | 'marketCount' | 'lastUpdated' | 'marketLookup'>>) => void;
  setLoading: (v: boolean) => void;
  setArbs: (arbs: ArbOpportunity[]) => void;
  setTriArbs: (arbs: ArbOpportunity[]) => void;
  setSignals: (signals: Signal[]) => void;
  setProgArbs: (arbs: ProgArb[]) => void;
  setSidebarOpen: (v: boolean) => void;
  setSelectedMarket: (m: Market | null) => void;
  setSidebarOutcome: (v: 'YES' | 'NO') => void;
  setProgDialogOpen: (v: boolean) => void;
  setProgDialogData: (v: AppState['progDialogData']) => void;
  setArbDialogArb: (v: ArbOpportunity | null) => void;
  setEditProgArb: (v: ProgArb | null) => void;
  openPnlDrilldown: (asset: string, endDates: string[]) => void;
  closePnlDrilldown: () => void;
  setPanels: (panels: PanelConfig[]) => void;
  setLayouts: (layouts: ReactGridLayout.Layouts) => void;
  addPanel: (panel: PanelConfig) => void;
  removePanel: (id: string) => void;

  // Live bid/ask updates from WS
  bidAskTick: number;
  updateBidAsk: (assetId: string, bestBid: number, bestAsk: number) => void;

  // Derived
  getAssetPrice: (symbol: AssetSymbol) => number;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace ReactGridLayout {
  interface Layouts {
    [P: string]: Layout[];
  }
  interface Layout {
    i: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
  }
}

const loadPanels = (): PanelConfig[] => {
  try {
    const saved = localStorage.getItem('polybot-react-panels');
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  // Use DEFAULT_PANELS from types but import at runtime to avoid circular
  return [
    { id: 'asset-BTC', type: 'asset-BTC', title: 'BTC' },
    { id: 'trades-positions-orders', type: 'trades-positions-orders', title: 'Trades/Positions/Orders' },
    { id: 'updown-overview', type: 'updown-overview', title: 'Up/Down Markets' },
    { id: 'signals', type: 'signals', title: 'Signals' },
    { id: 'chat', type: 'chat', title: 'Chat' },
  ] as PanelConfig[];
};

const LAYOUT_VERSION = 5; // v5 = remove PnL, smaller UpDown

const loadLayouts = (): ReactGridLayout.Layouts | null => {
  try {
    const saved = localStorage.getItem('polybot-react-layouts');
    if (!saved) return null;
    const layouts = JSON.parse(saved);
    const ver = parseInt(localStorage.getItem('polybot-react-layout-version') || '1');
    if (ver < LAYOUT_VERSION) {
      // Reset layout on version bump to apply new defaults
      localStorage.removeItem('polybot-react-layouts');
      localStorage.removeItem('polybot-react-panels');
      localStorage.setItem('polybot-react-layout-version', String(LAYOUT_VERSION));
      return null;
    }
    return layouts;
  } catch { /* ignore */ }
  return null;
};

export const useAppStore = create<AppState>((set, get) => ({
  priceData: {
    BTCUSDT: { price: 0 },
    ETHUSDT: { price: 0 },
    SOLUSDT: { price: 0 },
    XRPUSDT: { price: 0 },
  },
  vwapData: {
    BTCUSDT: { price: 0, ts: 0 },
    ETHUSDT: { price: 0, ts: 0 },
    SOLUSDT: { price: 0, ts: 0 },
    XRPUSDT: { price: 0, ts: 0 },
  },
  volatilityData: {
    BTCUSDT: 0.60,
    ETHUSDT: 0.70,
    SOLUSDT: 0.90,
    XRPUSDT: 0.80,
  },
  manualPriceSlots: {
    BTCUSDT: [null, null],
    ETHUSDT: [null, null],
    SOLUSDT: [null, null],
    XRPUSDT: [null, null],
  },
  activeRangeSlot: {
    BTCUSDT: parseInt(localStorage.getItem('polymarket-active-range-BTCUSDT') || '0'),
    ETHUSDT: parseInt(localStorage.getItem('polymarket-active-range-ETHUSDT') || '0'),
    SOLUSDT: parseInt(localStorage.getItem('polymarket-active-range-SOLUSDT') || '0'),
    XRPUSDT: parseInt(localStorage.getItem('polymarket-active-range-XRPUSDT') || '0'),
  },
  useLivePrice: {
    BTCUSDT: localStorage.getItem('polymarket-use-live-BTCUSDT') === 'true',
    ETHUSDT: localStorage.getItem('polymarket-use-live-ETHUSDT') === 'true',
    SOLUSDT: localStorage.getItem('polymarket-use-live-SOLUSDT') === 'true',
    XRPUSDT: localStorage.getItem('polymarket-use-live-XRPUSDT') === 'true',
  },
  volMultiplier: parseFloat(localStorage.getItem('polymarket-vol-mult') || '1'),
  vwapCandles: 60,
  vwapCorrection: 0,
  bsTimeOffsetHours: parseInt(localStorage.getItem('polymarket-bs-time-offset') || '0'),
  showPast: localStorage.getItem('polymarket-show-past') !== 'false',
  dailyBudget: localStorage.getItem('polymarket-daily-budget') || '',

  aboveMarkets: {},
  priceOnMarkets: {},
  weeklyHitMarkets: {},
  upOrDownMarkets: {},
  positions: [],
  orders: [],
  trades: [],
  cashBalance: 0,
  makerAddress: '',
  tokenInfo: {},
  progOrderMap: {},
  marketCount: 0,
  lastUpdated: '',
  loading: true,
  marketLookup: {},

  arbs: [],
  triArbs: [],
  signals: [],
  progArbs: [],
  arbMatchMult: parseFloat(localStorage.getItem('polymarket-arb-match-mult') || '1'),
  signalMakerMode: localStorage.getItem('polymarket-signal-maker-mode') === 'true',
  signalPriceMode: localStorage.getItem('polymarket-signal-price-mode') || 'ASK',
  signalsOnGrid: localStorage.getItem('polymarket-signals-on-grid') !== 'false',

  sidebarOpen: true,
  selectedMarket: null,
  sidebarOutcome: 'YES' as const,

  progDialogOpen: false,
  progDialogData: null,
  arbDialogArb: null,
  editProgArb: null,
  pnlDrilldown: { open: false, asset: '', endDates: [] },

  panels: loadPanels(),
  layouts: loadLayouts(),

  setPriceData: (symbol, price) => set((s) => ({
    priceData: { ...s.priceData, [symbol]: { price } },
  })),
  setVwapData: (symbol, price) => set((s) => ({
    vwapData: { ...s.vwapData, [symbol]: { price, ts: Date.now() } },
  })),
  setVolatilityData: (symbol, vol) => set((s) => ({
    volatilityData: { ...s.volatilityData, [symbol]: vol },
  })),
  setManualPriceSlot: (symbol, slot, range) => set((s) => {
    const slots = { ...s.manualPriceSlots };
    const pair = [...slots[symbol]] as [PriceRange | null, PriceRange | null];
    pair[slot] = range;
    slots[symbol] = pair;
    return { manualPriceSlots: slots };
  }),
  setActiveRangeSlot: (symbol, slot) => {
    localStorage.setItem('polymarket-active-range-' + symbol, slot.toString());
    set((s) => ({
      activeRangeSlot: { ...s.activeRangeSlot, [symbol]: slot },
    }));
  },
  setUseLivePrice: (symbol, use) => {
    localStorage.setItem('polymarket-use-live-' + symbol, use ? 'true' : 'false');
    set((s) => ({
      useLivePrice: { ...s.useLivePrice, [symbol]: use },
    }));
  },
  setVolMultiplier: (v) => {
    localStorage.setItem('polymarket-vol-mult', v.toString());
    set({ volMultiplier: v });
  },
  setVwapCandles: (v) => set({ vwapCandles: v }),
  setVwapCorrection: (v) => set({ vwapCorrection: v }),
  setBsTimeOffsetHours: (v) => {
    localStorage.setItem('polymarket-bs-time-offset', v.toString());
    set({ bsTimeOffsetHours: v });
  },
  setShowPast: (v) => {
    localStorage.setItem('polymarket-show-past', v ? 'true' : 'false');
    set({ showPast: v });
  },
  setDailyBudget: (v) => {
    localStorage.setItem('polymarket-daily-budget', v);
    set({ dailyBudget: v });
  },
  setArbMatchMult: (v) => {
    localStorage.setItem('polymarket-arb-match-mult', String(v));
    set({ arbMatchMult: v });
  },
  setSignalMakerMode: (v) => {
    localStorage.setItem('polymarket-signal-maker-mode', v ? 'true' : 'false');
    set({ signalMakerMode: v });
  },
  setSignalPriceMode: (v) => {
    localStorage.setItem('polymarket-signal-price-mode', v);
    set({ signalPriceMode: v });
  },
  setSignalsOnGrid: (v) => {
    localStorage.setItem('polymarket-signals-on-grid', v ? 'true' : 'false');
    set({ signalsOnGrid: v });
  },
  bidAskTick: 0,
  setMarketData: (data) => set(data),
  setLoading: (v) => set({ loading: v }),
  setArbs: (a) => set({ arbs: a }),
  setTriArbs: (a) => set({ triArbs: a }),
  setSignals: (s) => set({ signals: s }),
  setProgArbs: (a) => set({ progArbs: a }),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setSelectedMarket: (m) => set({ selectedMarket: m }),
  setSidebarOutcome: (v) => set({ sidebarOutcome: v }),
  setProgDialogOpen: (v) => set({ progDialogOpen: v }),
  setProgDialogData: (v) => set({ progDialogData: v }),
  setArbDialogArb: (v) => set({ arbDialogArb: v }),
  setEditProgArb: (v) => set({ editProgArb: v }),
  openPnlDrilldown: (asset, endDates) => set({ pnlDrilldown: { open: true, asset, endDates } }),
  closePnlDrilldown: () => set({ pnlDrilldown: { open: false, asset: '', endDates: [] } }),
  setPanels: (panels) => {
    localStorage.setItem('polybot-react-panels', JSON.stringify(panels));
    set({ panels });
  },
  setLayouts: (layouts) => {
    localStorage.setItem('polybot-react-layouts', JSON.stringify(layouts));
    localStorage.setItem('polybot-react-layout-version', String(LAYOUT_VERSION));
    set({ layouts });
  },
  addPanel: (panel) => set((s) => {
    const panels = [...s.panels, panel];
    localStorage.setItem('polybot-react-panels', JSON.stringify(panels));
    return { panels };
  }),
  removePanel: (id) => set((s) => {
    const panels = s.panels.filter((p) => p.id !== id);
    localStorage.setItem('polybot-react-panels', JSON.stringify(panels));
    return { panels };
  }),
  updateBidAsk: (assetId, bestBid, bestAsk) => set((s) => {
    const entry = s.marketLookup[assetId];
    if (!entry) return {};
    const updated = { ...entry, bestBid, bestAsk };
    return {
      marketLookup: { ...s.marketLookup, [assetId]: updated },
      bidAskTick: s.bidAskTick + 1,
    };
  }),
  getAssetPrice: (symbol) => {
    const s = get();
    const manual = s.manualPriceSlots[symbol][s.activeRangeSlot[symbol]];
    if (manual && !s.useLivePrice[symbol]) {
      return manual.low;
    }
    return s.vwapData[symbol]?.price || s.priceData[symbol]?.price || 0;
  },
}));
