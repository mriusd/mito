import type { MarketsResponse, Market, Position } from '../types';
import { isWebMode, API_BASE } from '../lib/env';
import { placeOrderDirect, cancelOrderDirect, signOrderOnly, submitSignedOrderDirect } from '../lib/clobClient';
import { useAppStore } from '../stores/appStore';

const BASE = API_BASE;

export async function fetchMarkets(): Promise<MarketsResponse> {
  const resp = await fetch(`${BASE}/api/markets`);
  if (!resp.ok) throw new Error('Failed to fetch markets');
  return resp.json();
}

export async function fetchSettings(): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BASE}/api/settings`);
  if (!resp.ok) throw new Error('Failed to fetch settings');
  return resp.json();
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await fetch(`${BASE}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
}

export async function saveRange(asset: string, slot: number, low: number | null, high: number | null): Promise<boolean> {
  const resp = await fetch(`${BASE}/api/ranges`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset, slot, low, high }),
  });
  return resp.ok;
}

export async function placeOrder(params: {
  tokenId: string;
  side: string;
  price: number;
  size: number;
  expiration?: number;
  skipDialog?: boolean;
  orderInfo?: string;
  /** When set (e.g. FAK), sent to CLOB instead of deriving GTC/GTD from expiration. */
  orderType?: 'GTC' | 'GTD' | 'FAK' | 'FOK';
}): Promise<{ success: boolean; error?: string }> {
  if (isWebMode) {
    const proxyWallet = useAppStore.getState().makerAddress;
    if (!proxyWallet) return { success: false, error: 'Wallet not connected' };
    return placeOrderDirect({ ...params, proxyWallet });
  }
  const resp = await fetch(`${BASE}/api/place-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return resp.json();
}

export async function cancelOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
  if (isWebMode) {
    const proxyWallet = useAppStore.getState().makerAddress;
    if (!proxyWallet) return { success: false, error: 'Wallet not connected' };
    return cancelOrderDirect(orderId, proxyWallet);
  }
  const resp = await fetch(`${BASE}/api/cancel-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  });
  return resp.json();
}

// Sign an order (wallet popup) without submitting — for replace flow
export async function signOrder(params: {
  tokenId: string;
  side: string;
  price: number;
  size: number;
  expiration?: number;
}): Promise<{ success: boolean; signedPayload?: any; error?: string }> {
  if (isWebMode) {
    const proxyWallet = useAppStore.getState().makerAddress;
    if (!proxyWallet) return { success: false, error: 'Wallet not connected' };
    return signOrderOnly({ ...params, proxyWallet });
  }
  return { success: false, error: 'signOrder not supported in app mode' };
}

// Submit a previously signed order to the CLOB
export async function submitSignedOrder(signedPayload: any): Promise<{ success: boolean; orderID?: string; error?: string }> {
  return submitSignedOrderDirect(signedPayload);
}

export async function fetchArbProgs(status = 'active,filled,closed'): Promise<unknown> {
  const resp = await fetch(`${BASE}/api/arb/prog?status=${status}`);
  return resp.json();
}

export async function fetchProgsByToken(tokenIds: string[]): Promise<{ progs?: unknown[] }> {
  const resp = await fetch(`${BASE}/api/arb/progs-by-token?tokenIds=${encodeURIComponent(tokenIds.join(','))}`);
  return resp.json();
}

export async function fetchArbSummary(): Promise<unknown> {
  const resp = await fetch(`${BASE}/api/arb/summary`);
  return resp.json();
}

export async function syncArbPositions(polyPositions: unknown[]): Promise<unknown> {
  const resp = await fetch(`${BASE}/api/arb/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ polyPositions }),
  });
  return resp.json();
}

export async function closeArbPosition(progId: number, reason: string, revenue: number): Promise<unknown> {
  const resp = await fetch(`${BASE}/api/arb/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ progId, reason, revenue }),
  });
  return resp.json();
}

export async function createProgArb(payload: {
  legs: { asset: string; strike: string; tokenId: string; bsAnchor?: string | null; vwapCondition?: string | null; bidPrice?: number; posBaseline?: number }[];
  endDate?: string | null;
  size?: number;
  dollarSize?: number;
  noOrders?: boolean;
  expiryMinutes?: number;
  loop?: boolean;
  autoSell?: boolean;
  autoSellMode?: string;
  autoSellPrice?: number | null;
  autoSellSpread?: number;
  minEdge?: number;
}): Promise<{ success: boolean; id?: number; merged?: boolean; error?: string; orders?: { price: number }[]; orderErrors?: string[] }> {
  const resp = await fetch(`${BASE}/api/arb/prog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

export async function cancelProgArb(progId: number): Promise<{ success: boolean; error?: string }> {
  const resp = await fetch(`${BASE}/api/arb/prog/${progId}/cancel`, { method: 'POST' });
  return resp.json();
}

export async function rebidProg(progId: number, legIndex: number, price: number): Promise<unknown> {
  const resp = await fetch(`${BASE}/api/arb/prog/${progId}/rebid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ legIndex, price }),
  });
  return resp.json();
}

export async function fetchProgTrades(progId: number): Promise<{ prog?: unknown; trades?: unknown[]; progOrders?: unknown[]; rawTrades?: unknown[] }> {
  const resp = await fetch(`${BASE}/api/arb/prog/${progId}/trades`);
  return resp.json();
}

export async function fetchProgErrors(progId: number): Promise<{ errors?: unknown[] }> {
  const resp = await fetch(`${BASE}/api/arb/prog/${progId}/errors`);
  return resp.json();
}

export async function updateProgSize(progId: number, size?: number, dollarSize?: number): Promise<boolean> {
  const body = dollarSize !== undefined ? { dollarSize } : { size };
  const resp = await fetch(`${BASE}/api/arb/prog/${progId}/size`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return resp.ok;
}

export async function updateProgExpiry(progId: number, expiryMinutes: number): Promise<boolean> {
  const resp = await fetch(`${BASE}/api/arb/prog/${progId}/expiry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiryMinutes }),
  });
  return resp.ok;
}

export async function updateProgAutoSell(progId: number, payload: { autoSell: boolean; mode?: string; price?: number | null; spread?: number | null }): Promise<boolean> {
  const resp = await fetch(`${BASE}/api/arb/prog/${progId}/autosell`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return resp.ok;
}

export async function updateProgLoop(progId: number, loop: boolean): Promise<boolean> {
  const resp = await fetch(`${BASE}/api/arb/prog/${progId}/loop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loop }),
  });
  return resp.ok;
}

export async function updateProgAnchor(progId: number, legIndex: number, anchor: string | null): Promise<boolean> {
  const resp = await fetch(`${BASE}/api/arb/prog/${progId}/anchor`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ legIndex, anchor }),
  });
  return resp.ok;
}

export async function fetchPnlSummary(): Promise<{ pnlMap: Record<string, unknown> }> {
  const resp = await fetch(`${BASE}/api/arb/pnl-summary`);
  return resp.json();
}

export interface DrilldownProg {
  id: number;
  asset?: string;
  end_date?: string;
  strikes: string;
  status: string;
  close_reason?: string;
  size: number;
  isDollar?: boolean;
  inv: number;
  inv_cost: number;
  loop?: boolean;
  auto_sell?: boolean;
  bought_shares: number;
  bought_usd: number;
  sold_shares: number;
  sold_usd: number;
  pnl: number;
}

export async function fetchPnlDrilldown(asset: string, endDate: string): Promise<{ progs: DrilldownProg[] }> {
  const resp = await fetch(`${BASE}/api/arb/pnl-drilldown?asset=${encodeURIComponent(asset)}&endDate=${encodeURIComponent(endDate)}`);
  return resp.json();
}

export async function fetchPnlDrilldownAll(): Promise<{ progs: DrilldownProg[] }> {
  const resp = await fetch(`${BASE}/api/arb/pnl-drilldown-all`);
  return resp.json();
}

export async function fetchOrderbook(tokenId: string): Promise<{ bids: { price: string; size: string }[]; asks: { price: string; size: string }[] }> {
  const resp = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`);
  if (!resp.ok) throw new Error('Failed to fetch orderbook');
  return resp.json();
}

// Fetch positions directly from Polymarket Data API (paginated)
export async function fetchPolymarketPositions(userAddress: string): Promise<Position[]> {
  const PAGE_SIZE = 500;
  let allPositions: Position[] = [];
  let offset = 0;
  while (true) {
    const resp = await fetch(`https://data-api.polymarket.com/positions?user=${userAddress}&sizeThreshold=0&limit=${PAGE_SIZE}&offset=${offset}`);
    if (!resp.ok) break;
    const page = await resp.json();
    if (!Array.isArray(page)) break;
    allPositions = allPositions.concat(page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  // Filter: active only (not redeemable, size > 0)
  return allPositions.filter((p: Position) => !p.redeemable && p.size > 0);
}

export interface BsLiveResponse {
  bs_live: number | null;
  s0_low: number | null;
  s0_high: number | null;
  s0_min: number | null;
  s0_max: number | null;
  s1_low: number | null;
  s1_high: number | null;
  s1_min: number | null;
  s1_max: number | null;
  range1_low: number | null;
  range1_high: number | null;
  range2_low: number | null;
  range2_high: number | null;
  price: number;
  vwap: number;
  volatility: number;
}

// Fetch live BS computation from backend
export async function fetchBsLive(asset: string, strike: string, endDate?: string): Promise<BsLiveResponse | null> {
  try {
    const params = new URLSearchParams({ asset, strike });
    if (endDate) params.set('endDate', endDate);
    const resp = await fetch(`${BASE}/api/bs-live?${params}`);
    if (!resp.ok) return null;
    return resp.json();
  } catch {
    return null;
  }
}

export async function fetchPriceHistory(tokenId: string, interval = 'max', fidelity = '60'): Promise<{ history: { t: number; p: number }[] }> {
  const resp = await fetch(`${BASE}/api/market-trades/${tokenId}?interval=${interval}&fidelity=${fidelity}`);
  if (!resp.ok) return { history: [] };
  return resp.json();
}

/**
 * Polycandles/Gamma attach `bestBid`/`bestAsk` to the market row for the YES token ([0]) only.
 * If both clob ids pointed at the same object, WS `bidAskBatch` would replace only one key’s copy
 * while the other still read those YES fields as the NO book → duplicate YES/NO cells after updates.
 * YES entry: shallow clone with API bid/ask. NO entry: clone without top-level bid/ask until WS patches that token.
 */
function addMarketToTokenLookup(lookup: Record<string, Market>, m: Market) {
  const tokenIds = m.clobTokenIds || [];
  if (tokenIds.length === 0) return;
  if (tokenIds.length === 1) {
    const id = tokenIds[0];
    if (id) lookup[id] = { ...m };
    return;
  }
  const yesId = tokenIds[0];
  const noId = tokenIds[1];
  if (yesId) lookup[yesId] = { ...m };
  if (noId) lookup[noId] = { ...m, bestBid: undefined, bestAsk: undefined };
}

export function buildMarketLookup(aboveMarkets: Record<string, Market[]>, priceOnMarkets: Record<string, Market[]>, weeklyHitMarkets: Record<string, Market[]> = {}, upOrDownMarkets: Record<string, Record<string, Market[]>> = {}): Record<string, Market> {
  const lookup: Record<string, Market> = {};
  for (const assetName of Object.keys(aboveMarkets)) {
    for (const m of aboveMarkets[assetName] || []) {
      addMarketToTokenLookup(lookup, m);
    }
  }
  for (const assetName of Object.keys(priceOnMarkets)) {
    for (const m of priceOnMarkets[assetName] || []) {
      addMarketToTokenLookup(lookup, m);
    }
  }
  for (const assetName of Object.keys(weeklyHitMarkets)) {
    for (const m of weeklyHitMarkets[assetName] || []) {
      addMarketToTokenLookup(lookup, m);
    }
  }
  for (const assetName of Object.keys(upOrDownMarkets)) {
    for (const tf of Object.keys(upOrDownMarkets[assetName] || {})) {
      for (const m of upOrDownMarkets[assetName][tf] || []) {
        addMarketToTokenLookup(lookup, m);
      }
    }
  }
  return lookup;
}

// --- Toxic Flow / On-chain API ---

export interface WalletPosition {
  wallet: string;
  marketId: string;
  /** Present on /api/wallet-positions rows; used to discover CLOB token IDs for on-chain fetches. */
  tokenIdYes?: string;
  tokenIdNo?: string;
  boughtYes: number;
  soldYes: number;
  boughtNo: number;
  soldNo: number;
  net: number;
  netYes: number;
  netNo: number;
  usdcIn: number;
  usdcOut: number;
  pnl: number;
  tradeCount: number;
  firstTradeTime: number;
  lastTradeTime: number;
  marketAsset: string;
  marketType: string;
  marketTimeframe: string;
  resultYes?: number;
  resolvedAt?: number;
  netSide: string;
  inventoryBias: number;
  /** From joined `markets` row when present. */
  question?: string;
  slug?: string;
  eventSlug?: string;
  /** From wallet_scores: wins / (wins+losses); only set in toxic-flow response when winLossTotal > 0. */
  winRate?: number;
  /** Resolved markets with a win or loss (excludes flat-only); from wallet_scores. */
  winLossTotal?: number;
}

export interface ToxicFlowData {
  marketId: string;
  topHolders: WalletPosition[];
  topYes: WalletPosition[];
  topNo: WalletPosition[];
  topVolume: WalletPosition[];
  topTraders: WalletPosition[];
  totalYesVol: number;
  totalNoVol: number;
  totalShares: number;
  totalUsdcIn: number;
  totalUsdcOut: number;
  totalWallets: number;
  totalTrades: number;
  concentration: number;
  // Informed trader bias metrics
  smartMoneyBias: number;
  topHoldersBias: number;
  whaleBias: number;
  whaleCount: number;
  yesWallets: number;
  noWallets: number;
  yesUsdcIn: number;
  noUsdcIn: number;
  // Manipulation red flags
  redFlags?: { flag: string; detail: string; level: string; value: number; wallet?: string }[];
  /** Backend: POLYGON_WSS_URL set */
  polygonWssConfigured?: boolean;
  /** All-time OrderFilled logs processed since process start */
  orderFilledEventsProcessed?: number;
  /** Rows in onchain_fills for this market_id */
  onchainFillsForMarket?: number;
}

export async function fetchToxicFlow(marketId: string): Promise<ToxicFlowData> {
  const resp = await fetch(`${BASE}/api/toxic-flow?market_id=${encodeURIComponent(marketId)}`);
  if (!resp.ok) throw new Error('Failed to fetch toxic flow');
  return resp.json();
}

export async function fetchWalletPositions(params: {
  market_id?: string;
  wallet?: string;
  asset?: string;
  type?: string;
  min_trades?: number;
  sort_by?: string;
  limit?: number;
  /** When true, server excludes closed markets and past end_date (joins `markets`). */
  active_only?: boolean;
}): Promise<{ positions: WalletPosition[]; count: number; total: number }> {
  const qs = new URLSearchParams();
  if (params.market_id) qs.set('market_id', params.market_id);
  if (params.wallet) qs.set('wallet', params.wallet);
  if (params.asset) qs.set('asset', params.asset);
  if (params.type) qs.set('type', params.type);
  if (params.min_trades) qs.set('min_trades', String(params.min_trades));
  if (params.sort_by) qs.set('sort_by', params.sort_by);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.active_only) qs.set('active_only', '1');
  const resp = await fetch(`${BASE}/api/wallet-positions?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch wallet positions');
  return resp.json();
}

export interface OnchainFillRow {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTime: number;
  contract: string;
  orderHash: string;
  maker: string;
  taker: string;
  makerAssetId: string;
  takerAssetId: string;
  makerAmount: number;
  takerAmount: number;
  fee: number;
  tokenId: string;
  side: string;
  marketId: string;
  marketAsset: string;
  marketType: string;
  marketTimeframe: string;
}

export async function fetchOnchainFills(params: { market_id?: string; wallet?: string; token_id?: string; limit?: number; offset?: number }): Promise<{ fills: OnchainFillRow[]; count: number; total: number }> {
  const qs = new URLSearchParams();
  if (params.market_id) qs.set('market_id', params.market_id);
  if (params.wallet) qs.set('wallet', params.wallet);
  if (params.token_id) qs.set('token_id', params.token_id);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const resp = await fetch(`${BASE}/api/onchain-fills?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch on-chain fills');
  return resp.json();
}

export interface OnchainMarketPositionRow {
  tokenId: string;
  size: number;
  avgPrice: number;
}

export async function fetchOnchainMarketPositions(params: {
  token_ids: string[];
  wallet: string;
  active_only?: boolean;
}): Promise<{ positions: OnchainMarketPositionRow[]; count: number }> {
  const qs = new URLSearchParams();
  qs.set('token_ids', params.token_ids.join(','));
  qs.set('wallet', params.wallet);
  if (params.active_only) qs.set('active_only', '1');
  const resp = await fetch(`${BASE}/api/onchain-market-positions?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch on-chain market positions');
  return resp.json();
}

export interface OnchainMarketTradeRow {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTime: number;
  tokenId: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
}

export async function fetchOnchainMarketTrades(params: { token_ids: string[]; wallet: string; limit?: number; offset?: number }): Promise<{ trades: OnchainMarketTradeRow[]; count: number; total: number }> {
  const qs = new URLSearchParams();
  qs.set('token_ids', params.token_ids.join(','));
  qs.set('wallet', params.wallet);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const resp = await fetch(`${BASE}/api/onchain-market-trades?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch on-chain market trades');
  return resp.json();
}

// --- Wallet P&L (on-chain fills, daily buckets) ---

export interface WalletPnlDailyResponse {
  source: string;
  bucket: string;
  wallet: string;
  from: string;
  to: string;
  byDate: Record<string, { bought: number; sold: number }>;
  updated?: string;
}

export async function fetchWalletPnlDaily(params: {
  wallet: string;
  from: string;
  to: string;
  bucket: 'trade' | 'market';
  updown: boolean;
  hit: boolean;
  above: boolean;
  between: boolean;
}): Promise<WalletPnlDailyResponse> {
  const qs = new URLSearchParams();
  qs.set('wallet', params.wallet.toLowerCase());
  qs.set('from', params.from);
  qs.set('to', params.to);
  qs.set('bucket', params.bucket);
  qs.set('updown', params.updown ? '1' : '0');
  qs.set('hit', params.hit ? '1' : '0');
  qs.set('above', params.above ? '1' : '0');
  qs.set('between', params.between ? '1' : '0');
  const resp = await fetch(`${BASE}/api/wallet-pnl-daily?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch wallet P&L (on-chain)');
  return resp.json();
}

// --- Wallet Summary API ---

export interface WalletSummary {
  found: boolean;
  wallet: string;
  totalMarkets: number;
  resolvedMarkets: number;
  totalTrades: number;
  totalUsdcIn: number;
  totalUsdcOut: number;
  tradingPnl: number;
  resolutionValue: number;
  pnl: number;
  wins: number;
  losses: number;
  flat: number;
  winRate: number;
}

export async function fetchWalletSummary(wallet: string): Promise<WalletSummary | null> {
  const resp = await fetch(`${BASE}/api/wallet-summary?wallet=${wallet.toLowerCase()}`);
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.found ? data : null;
}

// --- Chat API ---

export interface ChatMessage {
  id: number;
  address: string;
  nickname: string;
  message: string;
  createdAt: number;
  /** Optional badge label (e.g. role); shown next to username when non-empty. */
  title?: string;
}

export async function fetchChatMessages(limit = 100, before?: number): Promise<ChatMessage[]> {
  let url = `${BASE}/api/chat?limit=${limit}`;
  if (before) url += `&before=${before}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Failed to fetch chat');
  return resp.json();
}

export async function postChatMessage(address: string, nickname: string, message: string): Promise<ChatMessage> {
  const resp = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, nickname, message }),
  });
  if (!resp.ok) throw new Error('Failed to send message');
  return resp.json();
}

export async function deleteChatMessage(id: number, address: string): Promise<void> {
  const body = JSON.stringify({ id, address });
  let resp = await fetch(`${BASE}/api/chat`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  // Some deployed backends/proxies block DELETE; fallback to POST endpoint.
  if (resp.status === 405) {
    resp = await fetch(`${BASE}/api/chat/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  }
  if (!resp.ok) throw new Error('Failed to delete message');
}

export async function editChatMessage(id: number, address: string, message: string): Promise<ChatMessage> {
  const body = JSON.stringify({ id, address, message });
  // Use POST compat endpoint first to avoid CORS preflight failures on PATCH.
  let resp = await fetch(`${BASE}/api/chat/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  // Optional fallback for environments where only PATCH /api/chat is available.
  if (resp.status === 404 || resp.status === 405) {
    resp = await fetch(`${BASE}/api/chat`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  }
  if (!resp.ok) throw new Error('Failed to edit message');
  return resp.json();
}
