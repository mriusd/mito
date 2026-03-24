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

export function buildMarketLookup(aboveMarkets: Record<string, Market[]>, priceOnMarkets: Record<string, Market[]>, weeklyHitMarkets: Record<string, Market[]> = {}, upOrDownMarkets: Record<string, Record<string, Market[]>> = {}): Record<string, Market> {
  const lookup: Record<string, Market> = {};
  for (const assetName of Object.keys(aboveMarkets)) {
    for (const m of aboveMarkets[assetName] || []) {
      const tokenIds = m.clobTokenIds || [];
      if (tokenIds[0]) lookup[tokenIds[0]] = m;
      if (tokenIds[1]) lookup[tokenIds[1]] = m;
    }
  }
  for (const assetName of Object.keys(priceOnMarkets)) {
    for (const m of priceOnMarkets[assetName] || []) {
      const tokenIds = m.clobTokenIds || [];
      if (tokenIds[0]) lookup[tokenIds[0]] = m;
      if (tokenIds[1]) lookup[tokenIds[1]] = m;
    }
  }
  for (const assetName of Object.keys(weeklyHitMarkets)) {
    for (const m of weeklyHitMarkets[assetName] || []) {
      const tokenIds = m.clobTokenIds || [];
      if (tokenIds[0]) lookup[tokenIds[0]] = m;
      if (tokenIds[1]) lookup[tokenIds[1]] = m;
    }
  }
  for (const assetName of Object.keys(upOrDownMarkets)) {
    for (const tf of Object.keys(upOrDownMarkets[assetName] || {})) {
      for (const m of upOrDownMarkets[assetName][tf] || []) {
        const tokenIds = m.clobTokenIds || [];
        if (tokenIds[0]) lookup[tokenIds[0]] = m;
        if (tokenIds[1]) lookup[tokenIds[1]] = m;
      }
    }
  }
  return lookup;
}

// --- Toxic Flow / On-chain API ---

export interface WalletPosition {
  wallet: string;
  marketId: string;
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
  netSide: string;
  inventoryBias: number;
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
  totalUsdcIn: number;
  totalUsdcOut: number;
  totalWallets: number;
  totalTrades: number;
  netImbalance: number;
  concentration: number;
}

export async function fetchToxicFlow(marketId: string): Promise<ToxicFlowData> {
  const resp = await fetch(`${BASE}/api/toxic-flow?market_id=${encodeURIComponent(marketId)}`);
  if (!resp.ok) throw new Error('Failed to fetch toxic flow');
  return resp.json();
}

export async function fetchWalletPositions(params: { market_id?: string; wallet?: string; asset?: string; type?: string; min_trades?: number; sort_by?: string; limit?: number }): Promise<{ positions: WalletPosition[]; count: number; total: number }> {
  const qs = new URLSearchParams();
  if (params.market_id) qs.set('market_id', params.market_id);
  if (params.wallet) qs.set('wallet', params.wallet);
  if (params.asset) qs.set('asset', params.asset);
  if (params.type) qs.set('type', params.type);
  if (params.min_trades) qs.set('min_trades', String(params.min_trades));
  if (params.sort_by) qs.set('sort_by', params.sort_by);
  if (params.limit) qs.set('limit', String(params.limit));
  const resp = await fetch(`${BASE}/api/wallet-positions?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch wallet positions');
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
