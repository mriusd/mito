import { create } from 'zustand';
import type { AssetSymbol, Market, Position, Order, Trade, PriceRange, PanelConfig, Signal, ArbOpportunity, ProgArb } from '../types';
import { SYMBOLS } from '../types';
import {
  jsonStableEqual,
  ordersEqual,
  positionsEqual,
  recordOfMarketArraysEqual,
  signalsEqual,
  tradesEqual,
  upOrDownMarketsEqual,
} from '../lib/marketDataDedupe';
import { GRID_WIDTH_SUBDIV } from '../lib/defaultLayouts';

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
  /** 0 = no cap. Default 10 USD when unset. Otherwise block orders whose notional (price × size) exceeds this USD. */
  maxOrderSizeUsd: number;
  /** When true, skip sidebar dialog when a limit price would cross the book (instant execution). */
  disableMarketPriceWarning: boolean;
  /** When true, sidebar selection jumps to the next live row when the current market expires (Up/Down TF bucket or same slug+strike). */
  autoSwitchNextMarketOnExpiry: boolean;

  // Market data from API
  aboveMarkets: Record<string, Market[]>;
  priceOnMarkets: Record<string, Market[]>;
  weeklyHitMarkets: Record<string, Market[]>;
  upOrDownMarkets: Record<string, Record<string, Market[]>>;
  weatherMarkets: Record<string, Market[]>;
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
  /** null = not checked yet; false = /api/markets unreachable */
  backendConnected: boolean | null;

  // Market lookup by token ID
  marketLookup: Record<string, Market>;
  /** Incremented on every `marketLookup` replacement — subscribe instead of `marketLookup` when only epoch is needed (avoids reference churn on unrelated store updates). */
  marketLookupEpoch: number;

  // Arbs
  arbs: ArbOpportunity[];
  triArbs: ArbOpportunity[];
  signals: Signal[];
  progArbs: ProgArb[];
  arbMatchMult: number;
  signalMakerMode: boolean;
  signalPriceMode: string;
  signalsOnGrid: boolean;

  // Signing mode
  signingMode: 'wallet' | 'privateKey';
  pkAddress: string | null; // EOA address derived from imported private key
  /** Bumped when imported PK changes — wallet hooks must not rely on signingMode alone. */
  pkRevision: number;
  setSigningMode: (v: 'wallet' | 'privateKey') => void;
  setPkAddress: (v: string | null) => void;
  bumpPkRevision: () => void;

  // Sidebar
  sidebarOpen: boolean;
  selectedMarket: Market | null;
  sidebarOutcome: 'YES' | 'NO';
  /** CHAIN vs API live-trades + grid source (header toggle; localStorage). */
  liveTradesSource: 'onchain' | 'polymarket';
  setLiveTradesSource: (v: 'onchain' | 'polymarket') => void;
  /** Wallet positions from on-chain WS when source is onchain; used for grid dots / badges. Cleared when switching to Polymarket. */
  onchainGridPositions: Array<{ tokenId: string; size: number }>;
  setOnchainGridPositions: (p: Array<{ tokenId: string; size: number }>) => void;

  // Dialogs
  progDialogOpen: boolean;
  progDialogData: { yesMarket: Market; noMarket: Market; yesAsset: string; noAsset: string; endDate: string } | null;
  arbDialogArb: ArbOpportunity | null;
  editProgArb: ProgArb | null;
  pnlDrilldown: { open: boolean; asset: string; endDates: string[] };
  walletSummaryDialogOpen: boolean;
  marketViewDialogOpen: boolean;
  walletInfoOverlay: { wallet: string; initialMarketId: string } | null;

  // Layout panels
  panels: PanelConfig[];
  layouts: ReactGridLayout.Layouts | null;

  // Actions
  setPriceData: (symbol: AssetSymbol, price: number) => void;
  /** Merge Binance ticker prices once per animation frame (skips noop price). */
  setBinanceTickerBatch: (patch: Partial<Record<AssetSymbol, number>>) => void;
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
  setMaxOrderSizeUsd: (v: number) => void;
  setDisableMarketPriceWarning: (v: boolean) => void;
  setAutoSwitchNextMarketOnExpiry: (v: boolean) => void;
  setArbMatchMult: (v: number) => void;
  setSignalMakerMode: (v: boolean) => void;
  setSignalPriceMode: (v: string) => void;
  setSignalsOnGrid: (v: boolean) => void;
  setMarketData: (data: Partial<Pick<AppState, 'aboveMarkets' | 'priceOnMarkets' | 'weeklyHitMarkets' | 'upOrDownMarkets' | 'weatherMarkets' | 'positions' | 'orders' | 'trades' | 'cashBalance' | 'makerAddress' | 'tokenInfo' | 'progOrderMap' | 'marketCount' | 'lastUpdated' | 'marketLookup'>>) => void;
  setLoading: (v: boolean) => void;
  setBackendConnected: (v: boolean | null) => void;
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
  setWalletSummaryDialogOpen: (v: boolean) => void;
  setMarketViewDialogOpen: (v: boolean) => void;
  openWalletInfoOverlay: (wallet: string, initialMarketId?: string) => void;
  closeWalletInfoOverlay: () => void;
  setPanels: (panels: PanelConfig[]) => void;
  setLayouts: (layouts: ReactGridLayout.Layouts | null) => void;
  addPanel: (panel: PanelConfig) => void;
  removePanel: (id: string) => void;

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

export type PersistedGridLayouts = ReactGridLayout.Layouts;

// Bump this version to force-reset all users' saved layouts to fresh defaults
const LAYOUT_VERSION = 9;

function scaleSavedLayoutWidths(
  layouts: Record<string, { x?: number; w?: number }[]>,
  factor: number,
): void {
  for (const items of Object.values(layouts)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (typeof item.x === 'number') item.x = Math.round(item.x * factor);
      if (typeof item.w === 'number') item.w = Math.round(item.w * factor);
    }
  }
}

// Run version check once before any load functions
(function checkLayoutVersion() {
  const savedVersion = parseInt(localStorage.getItem('polybot-layout-version') || '0', 10);
  if (savedVersion >= LAYOUT_VERSION) return;

  if (savedVersion === 8) {
    try {
      const raw = localStorage.getItem('polybot-react-layouts');
      if (raw) {
        const layouts = JSON.parse(raw) as Record<string, { x?: number; w?: number }[]>;
        scaleSavedLayoutWidths(layouts, GRID_WIDTH_SUBDIV);
        localStorage.setItem('polybot-react-layouts', JSON.stringify(layouts));
      }
    } catch {
      /* ignore */
    }
    localStorage.setItem('polybot-layout-version', String(LAYOUT_VERSION));
    return;
  }

  if (savedVersion > 0) {
    localStorage.removeItem('polybot-react-panels');
    localStorage.removeItem('polybot-react-layouts');
  }
  localStorage.setItem('polybot-layout-version', String(LAYOUT_VERSION));
})();

const DEFAULT_PANELS: PanelConfig[] = [
  { id: 'asset-BTC', type: 'asset-BTC', title: 'BTC' },
  { id: 'trades-positions-orders', type: 'trades-positions-orders', title: 'Trades/Positions/Orders' },
  { id: 'updown-overview', type: 'updown-overview', title: 'Up/Down Markets' },
  { id: 'signals', type: 'signals', title: 'Signals' },
  { id: 'chat', type: 'chat', title: 'Chat' },
];

const loadPanels = (): PanelConfig[] => {
  try {
    const saved = localStorage.getItem('polybot-react-panels');
    return saved ? JSON.parse(saved) : DEFAULT_PANELS;
  } catch { return DEFAULT_PANELS; }
};

const loadLayouts = (): ReactGridLayout.Layouts | null => {
  try {
    const saved = localStorage.getItem('polybot-react-layouts');
    if (!saved) return null;
    return JSON.parse(saved);
  } catch { /* ignore */ }
  return null;
};

const MANUAL_PRICE_SLOTS_KEY = 'polybot-manual-price-slots-v1';

const emptyManualSlots = (): Record<AssetSymbol, [PriceRange | null, PriceRange | null]> => {
  const out = {} as Record<AssetSymbol, [PriceRange | null, PriceRange | null]>;
  for (const sym of SYMBOLS) out[sym] = [null, null];
  return out;
};

function parseStoredRange(raw: unknown): PriceRange | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const readNum = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = parseFloat(v.replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const low = readNum(o.low);
  const high = readNum(o.high);
  if (low === null || high === null) return null;
  return { low, high };
}

function loadManualPriceSlots(): Record<AssetSymbol, [PriceRange | null, PriceRange | null]> {
  const defaults = emptyManualSlots();
  if (typeof localStorage === 'undefined') return defaults;
  try {
    const json = localStorage.getItem(MANUAL_PRICE_SLOTS_KEY);
    if (!json) return defaults;
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return defaults;
    const rec = parsed as Record<string, unknown>;
    for (const sym of SYMBOLS) {
      const row = rec[sym];
      if (!Array.isArray(row) || row.length < 2) continue;
      defaults[sym] = [parseStoredRange(row[0]), parseStoredRange(row[1])];
    }
  } catch {
    /* ignore corrupt storage */
  }
  return defaults;
}

function persistManualPriceSlots(slots: Record<AssetSymbol, [PriceRange | null, PriceRange | null]>) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MANUAL_PRICE_SLOTS_KEY, JSON.stringify(slots));
  } catch {
    /* quota / private mode */
  }
}

const VWAP_CANDLES_KEY = 'polymarket-vwap-candles';
const VWAP_CORRECTION_KEY = 'polymarket-vwap-correction';

function loadVwapCandles(): number {
  if (typeof localStorage === 'undefined') return 60;
  try {
    const raw = localStorage.getItem(VWAP_CANDLES_KEY);
    if (raw == null) return 60;
    const v = parseInt(raw, 10);
    if (Number.isNaN(v)) return 60;
    return Math.max(5, Math.min(1440, v));
  } catch {
    return 60;
  }
}

function loadVwapCorrection(): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(VWAP_CORRECTION_KEY);
    if (raw == null) return 0;
    const v = parseFloat(String(raw).replace(',', '.'));
    if (Number.isNaN(v)) return 0;
    return Math.max(0, Math.min(10, v));
  } catch {
    return 0;
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  priceData: Object.fromEntries(SYMBOLS.map((s) => [s, { price: 0 }])) as Record<AssetSymbol, { price: number }>,
  vwapData: Object.fromEntries(SYMBOLS.map((s) => [s, { price: 0, ts: 0 }])) as Record<AssetSymbol, { price: number; ts: number }>,
  volatilityData: {
    BTCUSDT: 0.60,
    ETHUSDT: 0.70,
    SOLUSDT: 0.90,
    XRPUSDT: 0.80,
    WTIUSDT: 0.35,
    NGUSDT: 0.55,
    SPYUSDT: 0.18,
    AAPLUSDT: 0.28,
    GOOGLUSDT: 0.30,
    NVDAUSDT: 0.45,
    AMZNUSDT: 0.32,
  },
  manualPriceSlots: loadManualPriceSlots(),
  activeRangeSlot: Object.fromEntries(
    SYMBOLS.map((s) => [s, parseInt(localStorage.getItem(`polymarket-active-range-${s}`) || '0')]),
  ) as Record<AssetSymbol, number>,
  useLivePrice: Object.fromEntries(
    SYMBOLS.map((s) => [s, localStorage.getItem(`polymarket-use-live-${s}`) === 'true']),
  ) as Record<AssetSymbol, boolean>,
  volMultiplier: parseFloat(localStorage.getItem('polymarket-vol-mult') || '1'),
  vwapCandles: loadVwapCandles(),
  vwapCorrection: loadVwapCorrection(),
  bsTimeOffsetHours: parseInt(localStorage.getItem('polymarket-bs-time-offset') || '0'),
  // Default unchecked for new users; honor saved preference afterwards.
  showPast: localStorage.getItem('polymarket-show-past') === 'true',
  dailyBudget: localStorage.getItem('polymarket-daily-budget') || '',
  maxOrderSizeUsd: (() => {
    const DEFAULT_MAX_ORDER_USD = 10;
    if (typeof localStorage === 'undefined') return DEFAULT_MAX_ORDER_USD;
    try {
      const raw = localStorage.getItem('polymarket-max-order-size-usd');
      if (raw == null || raw === '') return DEFAULT_MAX_ORDER_USD;
      const v = parseFloat(String(raw).replace(/,/g, ''));
      return Number.isFinite(v) && v >= 0 ? v : DEFAULT_MAX_ORDER_USD;
    } catch {
      return DEFAULT_MAX_ORDER_USD;
    }
  })(),
  disableMarketPriceWarning: localStorage.getItem('polymarket-disable-market-price-warning') === 'true',
  autoSwitchNextMarketOnExpiry: (() => {
    if (typeof localStorage === 'undefined') return true;
    const v = localStorage.getItem('polymarket-auto-switch-next-on-expiry');
    if (v === null) return true;
    return v === 'true';
  })(),

  aboveMarkets: {},
  priceOnMarkets: {},
  weeklyHitMarkets: {},
  upOrDownMarkets: {},
  weatherMarkets: {},
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
  backendConnected: null,
  marketLookup: {},
  marketLookupEpoch: 0,

  arbs: [],
  triArbs: [],
  signals: [],
  progArbs: [],
  arbMatchMult: parseFloat(localStorage.getItem('polymarket-arb-match-mult') || '1'),
  signalMakerMode: localStorage.getItem('polymarket-signal-maker-mode') === 'true',
  signalPriceMode: localStorage.getItem('polymarket-signal-price-mode') || 'ASK',
  signalsOnGrid: localStorage.getItem('polymarket-signals-on-grid') !== 'false',

  signingMode: (localStorage.getItem('polymarket-signing-mode') === 'privateKey' ? 'privateKey' : 'wallet') as 'wallet' | 'privateKey',
  pkAddress: null,
  pkRevision: 0,
  setSigningMode: (v) => { localStorage.setItem('polymarket-signing-mode', v); set({ signingMode: v }); },
  setPkAddress: (v) => set({ pkAddress: v }),
  bumpPkRevision: () => set((s) => ({ pkRevision: s.pkRevision + 1 })),

  // Mobile sheet: closed on load. Desktop rail: open. Matches CSS (max-width: 767px).
  sidebarOpen:
    typeof window !== 'undefined' ? !window.matchMedia('(max-width: 767px)').matches : true,
  selectedMarket: null,
  sidebarOutcome: 'YES' as const,
  liveTradesSource: (() => {
    if (typeof localStorage === 'undefined') return 'onchain';
    return localStorage.getItem('polymarket-sidebar-live-trades-source') === 'polymarket' ? 'polymarket' : 'onchain';
  })(),
  setLiveTradesSource: (v) => {
    localStorage.setItem('polymarket-sidebar-live-trades-source', v);
    set({ liveTradesSource: v, ...(v === 'polymarket' ? { onchainGridPositions: [] } : {}) });
  },

  onchainGridPositions: [],
  setOnchainGridPositions: (p) => set({ onchainGridPositions: p }),

  progDialogOpen: false,
  progDialogData: null,
  arbDialogArb: null,
  editProgArb: null,
  pnlDrilldown: { open: false, asset: '', endDates: [] },
  walletSummaryDialogOpen: false,
  marketViewDialogOpen: false,
  walletInfoOverlay: null,

  panels: loadPanels(),
  layouts: loadLayouts(),

  setPriceData: (symbol, price) => set((s) => ({
    priceData: { ...s.priceData, [symbol]: { price } },
  })),
  setBinanceTickerBatch: (patch) => set((s) => {
    let nextPd = s.priceData;
    let bumped = false;
    for (const k of Object.keys(patch) as AssetSymbol[]) {
      const p = patch[k];
      if (typeof p !== 'number' || !Number.isFinite(p)) continue;
      const cur = s.priceData[k]?.price;
      if (cur === p) continue;
      if (nextPd === s.priceData) nextPd = { ...s.priceData };
      nextPd[k] = { price: p };
      bumped = true;
    }
    if (!bumped) return {};
    return { priceData: nextPd };
  }),
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
    persistManualPriceSlots(slots);
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
  setVwapCandles: (v) => {
    const n = Math.max(5, Math.min(1440, Math.round(Number(v)) || 60));
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(VWAP_CANDLES_KEY, String(n));
      } catch {
        /* quota */
      }
    }
    set({ vwapCandles: n });
  },
  setVwapCorrection: (v) => {
    const n = Math.max(0, Math.min(10, parseFloat(String(v).replace(',', '.')) || 0));
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(VWAP_CORRECTION_KEY, String(n));
      } catch {
        /* quota */
      }
    }
    set({ vwapCorrection: n });
  },
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
  setMaxOrderSizeUsd: (v) => {
    const n = Math.max(0, Number.isFinite(v) ? v : 0);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('polymarket-max-order-size-usd', String(n));
      } catch {
        /* quota */
      }
    }
    set({ maxOrderSizeUsd: n });
  },
  setDisableMarketPriceWarning: (v) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('polymarket-disable-market-price-warning', v ? 'true' : 'false');
    }
    set({ disableMarketPriceWarning: v });
  },
  setAutoSwitchNextMarketOnExpiry: (v) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('polymarket-auto-switch-next-on-expiry', v ? 'true' : 'false');
    }
    set({ autoSwitchNextMarketOnExpiry: v });
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
  setMarketData: (data) =>
    set((s) => {
      const patch: Partial<AppState> = {};
      let bumpedMarketEpoch = false;

      const put = <K extends keyof AppState>(key: K, val: AppState[K]) => {
        patch[key] = val;
      };

      if (data.aboveMarkets !== undefined) {
        if (!recordOfMarketArraysEqual(data.aboveMarkets, s.aboveMarkets)) put('aboveMarkets', data.aboveMarkets);
      }
      if (data.priceOnMarkets !== undefined) {
        if (!recordOfMarketArraysEqual(data.priceOnMarkets, s.priceOnMarkets)) put('priceOnMarkets', data.priceOnMarkets);
      }
      if (data.weeklyHitMarkets !== undefined) {
        if (!recordOfMarketArraysEqual(data.weeklyHitMarkets, s.weeklyHitMarkets)) put('weeklyHitMarkets', data.weeklyHitMarkets);
      }
      if (data.upOrDownMarkets !== undefined) {
        if (!upOrDownMarketsEqual(data.upOrDownMarkets, s.upOrDownMarkets)) put('upOrDownMarkets', data.upOrDownMarkets);
      }
      if (data.weatherMarkets !== undefined) {
        if (!recordOfMarketArraysEqual(data.weatherMarkets, s.weatherMarkets)) put('weatherMarkets', data.weatherMarkets);
      }
      if (data.positions !== undefined) {
        if (!positionsEqual(data.positions, s.positions)) put('positions', data.positions);
      }
      if (data.orders !== undefined) {
        if (!ordersEqual(data.orders, s.orders)) put('orders', data.orders);
      }
      if (data.trades !== undefined) {
        if (!tradesEqual(data.trades, s.trades)) put('trades', data.trades);
      }
      if (data.cashBalance !== undefined && data.cashBalance !== s.cashBalance) put('cashBalance', data.cashBalance);
      if (data.makerAddress !== undefined && data.makerAddress !== s.makerAddress) put('makerAddress', data.makerAddress);
      if (data.tokenInfo !== undefined && !jsonStableEqual(data.tokenInfo, s.tokenInfo)) put('tokenInfo', data.tokenInfo);
      if (data.progOrderMap !== undefined && !jsonStableEqual(data.progOrderMap, s.progOrderMap)) {
        put('progOrderMap', data.progOrderMap);
      }
      if (data.marketCount !== undefined && data.marketCount !== s.marketCount) put('marketCount', data.marketCount);
      if (data.lastUpdated !== undefined && data.lastUpdated !== s.lastUpdated) put('lastUpdated', data.lastUpdated);
      if (data.marketLookup !== undefined) {
        /** Skip epoch bump when lookup is reference-identical or has identical key sets + per-token reference equality — useBidAskWS reuses refs for unchanged markets, so most polls produce no real change but used to trigger a full re-render storm. */
        const next = data.marketLookup;
        const prev = s.marketLookup;
        let changed = next !== prev;
        if (changed) {
          const prevKeys = Object.keys(prev);
          const nextKeys = Object.keys(next);
          if (prevKeys.length === nextKeys.length) {
            let allSame = true;
            for (const k of nextKeys) {
              if (prev[k] !== next[k]) { allSame = false; break; }
            }
            if (allSame) changed = false;
          }
        }
        if (changed) {
          put('marketLookup', next);
          bumpedMarketEpoch = true;
        }
      }

      if (Object.keys(patch).length === 0 && !bumpedMarketEpoch) return {};
      if (bumpedMarketEpoch) patch.marketLookupEpoch = s.marketLookupEpoch + 1;
      return patch;
    }),
  setLoading: (v) => set({ loading: v }),
  setBackendConnected: (v) => set({ backendConnected: v }),
  setArbs: (a) => set({ arbs: a }),
  setTriArbs: (a) => set({ triArbs: a }),
  setSignals: (next) => set((s) => (signalsEqual(next, s.signals) ? {} : { signals: next })),
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
  setWalletSummaryDialogOpen: (v) => set({ walletSummaryDialogOpen: v }),
  setMarketViewDialogOpen: (v) => set({ marketViewDialogOpen: v }),
  openWalletInfoOverlay: (wallet, initialMarketId = '') =>
    set({
      walletInfoOverlay: {
        wallet: wallet.trim(),
        initialMarketId: (initialMarketId || '').trim(),
      },
    }),
  closeWalletInfoOverlay: () => set({ walletInfoOverlay: null }),
  setPanels: (panels) => {
    localStorage.setItem('polybot-react-panels', JSON.stringify(panels));
    set({ panels });
  },
  setLayouts: (layouts) => {
    if (layouts) {
      localStorage.setItem('polybot-react-layouts', JSON.stringify(layouts));
    } else {
      localStorage.removeItem('polybot-react-layouts');
    }
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
      marketLookupEpoch: s.marketLookupEpoch + 1,
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
