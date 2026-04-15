export type AssetSymbol = 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT' | 'XRPUSDT';
export type AssetName = 'BTC' | 'ETH' | 'SOL' | 'XRP';

export const SYMBOLS: AssetSymbol[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
export const ASSET_NAMES: AssetName[] = ['BTC', 'ETH', 'SOL', 'XRP'];

export const ASSET_COLORS: Record<AssetName, string> = {
  BTC: 'text-orange-400',
  ETH: 'text-blue-400',
  SOL: 'text-purple-400',
  XRP: 'text-cyan-400',
};

export interface PriceRange {
  low: number;
  high: number;
}

export interface Market {
  id: string;
  /** Gnosis CTF condition id (bytes32 hex); required for on-chain merge. */
  conditionId?: string;
  question: string;
  eventTitle?: string;
  eventSlug?: string;
  groupItemTitle?: string;
  endDate: string;
  closed?: boolean;
  clobTokenIds: string[];
  outcomePrices?: string;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  volume?: number;
  sharesInExistence?: number;
  marketNetDirection?: number;
  holders?: number;
  smartMoneyBias?: number;
  provenSMS?: number;
  crowdBias?: number;
  liveBias?: number;
  liveBiasWindowMin?: number;
  concentration?: number;
  winnerBias?: number;
  winnerBiasYesWR?: number;
  winnerBiasNoWR?: number;
  winBiasShares?: number;
  winBiasSharesYes?: number;
  winBiasSharesNo?: number;
  winnerBiasConviction?: number;
  winnerBiasConvictionYesWR?: number;
  winnerBiasConvictionNoWR?: number;
  winBiasConvictionShares?: number;
  winBiasConvictionSharesYes?: number;
  winBiasConvictionSharesNo?: number;
  // B-S computed values from server
  bs1?: number;
  bs2?: number;
  bss?: number;
  // Signal data
  signal?: string;
  signalType?: string;
  // Up or Down target price from Gamma API
  priceToBeat?: number;
}

export interface Position {
  // Polymarket data API fields
  asset: string;       // token ID (primary key for lookup)
  size: number;
  redeemable?: boolean;
  outcome?: string;
  curPrice?: number;
  avgPrice?: number;
  pnl?: number;
  market?: string;
  conditionId?: string;
  // Legacy/backend fields
  asset_id?: string;
  token_id?: string;
  side?: string;
  currentPrice?: string;
  // Fields from Polymarket positions API
  title?: string;
  slug?: string;
  eventSlug?: string;
  outcomeIndex?: number;
  /** From local `markets.asset` when hydrating on-chain positions */
  underlyingAsset?: string;
  endDate?: string;
}

export interface Order {
  id: string;
  asset_id: string;
  token_id?: string;
  market?: string;
  side: 'BUY' | 'SELL';
  price: string;
  size: string;
  original_size?: string;
  size_matched?: string;
  outcome?: string;
  expiration?: string;
  created_at?: string;
  status?: string;
  type?: string;
}

export interface Trade {
  id: string;
  asset_id?: string;
  asset?: string;
  token_id?: string;
  market?: string;
  conditionId?: string;
  side: 'BUY' | 'SELL' | '';
  price: string;
  size: string;
  outcome?: string;
  timestamp?: string;
  created_at?: string;
  fee?: string;
  matchTime?: string;
  status?: string;
  fill_price?: string;
  size_filled?: string;
  // Fields from Polymarket activity API
  title?: string;
  slug?: string;
  eventSlug?: string;
  outcomeIndex?: number;
  usdcSize?: number;
}

export interface MarketsResponse {
  aboveMarkets: Record<string, Market[]>;
  priceOnMarkets: Record<string, Market[]>;
  weeklyHitMarkets: Record<string, Market[]>;
  upOrDownMarkets: Record<string, Record<string, Market[]>>;
  positions: Position[];
  orders: Order[];
  trades: Trade[];
  count: number;
  lastUpdated: string;
  cashBalance: number;
  makerAddress: string;
  tokenInfo: Record<string, unknown>;
  progOrderMap: Record<string, unknown>;
}

export interface ArbOpportunity {
  id: string;
  yesMarket: Market;
  noMarket: Market;
  yesPrice: number;
  noPrice: number;
  edge: number;
  edgePct: number;
  asset: string;
  endDate: string;
  type?: string;
  yesPct: number;
  noPct: number;
  maxSize: number;
  yesBs: number | null;
  noBs: number | null;
  yesBs1: number | null;
  noBs1: number | null;
  yesBs2: number | null;
  noBs2: number | null;
  yesBidPrice: number;
  noBidPrice: number;
}

export interface Signal {
  market: Market;
  type: 'BULL' | 'BEAR' | 'BID' | 'ASK';
  price: number;
  bsPrice: number;
  diff: number;
  diffPct: number;
  bidPrice: number;
  bidDiffPct: number;
  asset: string;
  endDate: string;
  priceStr: string;
  origSide: 'YES' | 'NO';
  tableType: 'above' | 'price' | 'hit';
}

export interface SmartMoneySignalMarket {
  marketId: string;
  provenSMS: number;
  barPct: number;
  direction: 'YES' | 'NO' | 'UP' | 'DOWN';
  smartWalletCount: number;
  smartExposure: number;
  totalShares: number;
  asset: string;
  question: string;
  endDate: string;
  eventSlug?: string;
  marketType?: string;
  /** Same shape as Signal.priceStr / Gamma groupItemTitle when market not in lookup */
  priceStr?: string;
  /** USDC volume from on-chain fills (toxicVolumeByMarket) */
  volume?: number;
  /** Best ask 0–1 for signal-direction token (YES/UP vs NO/DOWN), live CLOB */
  bestAsk?: number;
}

export interface SmartMoneySignalsResponse {
  threshold: number;
  count: number;
  markets: SmartMoneySignalMarket[];
}

export interface ProgLeg {
  asset: string;
  strike: string;
  token_id: string;
  leg_index: number;
  order_id?: string;
  bs_anchor?: string;
  computed_filled?: number;
  computed_fill_price?: number;
  quote_price?: string;
  vwap_condition?: string;
}

export interface ProgArb {
  id: number;
  status: string;
  legs: ProgLeg[];
  tokenIds?: string[];
  anchors?: string[];
  size: number;
  dollar_size?: number;
  cost: number;
  revenue: number;
  pnl: number;
  end_date?: string;
  created_at: string;
  closed_at?: string;
  close_reason?: string;
  auto?: boolean;
  spread?: number;
  loop?: boolean;
  auto_sell?: boolean;
  auto_sell_mode?: string;
  auto_sell_price?: number;
  auto_sell_spread?: number;
  expiry_minutes?: number;
}

export type PanelType =
  | 'asset-BTC'
  | 'asset-ETH'
  | 'asset-SOL'
  | 'asset-XRP'
  | 'arbs'
  | 'summary'
  | 'arb-positions'
  | 'signals'
  | 'smart-money'
  | 'trades-positions-orders'
  | 'pnl'
  | 'updown-overview'
  | 'relative-chart'
  | 'perp-bot'
  | 'price-forecast'
  | 'binance-chart'
  | 'updown-hud'
  | 'chat';

export interface PanelConfig {
  id: string;
  type: PanelType;
  title: string;
}

export const DEFAULT_PANELS: PanelConfig[] = [
  { id: 'asset-BTC', type: 'asset-BTC', title: 'BTC' },
  { id: 'trades-positions-orders', type: 'trades-positions-orders', title: 'Trades/Positions/Orders' },
  { id: 'updown-overview', type: 'updown-overview', title: 'Up/Down Markets' },
  { id: 'signals', type: 'signals', title: 'Signals' },
  { id: 'chat', type: 'chat', title: 'Chat' },
];
