import type { MarketsResponse, Market, Position, SmartMoneySignalsResponse } from '../types';
import { normalizeClobTokenId } from '../utils/format';
import { isWebMode, API_BASE } from '../lib/env';
import { fetchBackend } from '../lib/fetchBackend';
import { placeOrderDirect, cancelOrderDirect, cancelOrdersDirect, signOrderOnly, submitSignedOrderDirect, resolveTradingMakerForActiveSigner } from '../lib/clobClient';
import { useAppStore } from '../stores/appStore';

const BASE = API_BASE;

async function tradingProxyWalletForOrder(): Promise<string | { error: string }> {
  try {
    const proxyWallet = await resolveTradingMakerForActiveSigner();
    useAppStore.getState().setMarketData({ makerAddress: proxyWallet });
    return proxyWallet;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Wallet not connected';
    return { error: msg };
  }
}

export async function fetchMarkets(): Promise<MarketsResponse> {
  // Timeout must cover body download + JSON parse — fetch() resolves on headers; huge
  // weather+updown payloads used to hang resp.json() with no abort (felt like multi‑minute "refresh").
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 15_000);
  try {
    const resp = await fetchBackend(`${BASE}/api/markets`, { signal: ctrl.signal }, { probe: true, timeoutMs: 15_000 });
    if (!resp.ok) throw new Error('Failed to fetch markets');
    return (await resp.json()) as MarketsResponse;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchSettings(): Promise<Record<string, unknown>> {
  const resp = await fetchBackend(`${BASE}/api/settings`);
  if (!resp.ok) throw new Error('Failed to fetch settings');
  return resp.json();
}

export async function fetchSmartMoneySignals(): Promise<SmartMoneySignalsResponse> {
  const resp = await fetchBackend(`${BASE}/api/smart-money-signals`);
  if (!resp.ok) throw new Error('Failed to fetch smart money signals');
  return resp.json();
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await fetchBackend(`${BASE}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
}

export async function saveRange(asset: string, slot: number, low: number | null, high: number | null): Promise<boolean> {
  const resp = await fetchBackend(`${BASE}/api/ranges`, {
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
    const proxy = await tradingProxyWalletForOrder();
    if (typeof proxy !== 'string') return { success: false, error: proxy.error };
    return placeOrderDirect({ ...params, proxyWallet: proxy });
  }
  const resp = await fetchBackend(`${BASE}/api/place-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return resp.json();
}

export async function cancelOrder(orderId: string): Promise<{ success: boolean; error?: string }> {
  if (isWebMode) {
    const proxy = await tradingProxyWalletForOrder();
    if (typeof proxy !== 'string') return { success: false, error: proxy.error };
    return cancelOrderDirect(orderId, proxy);
  }
  const resp = await fetchBackend(`${BASE}/api/cancel-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  });
  return resp.json();
}

export async function cancelOrders(orderIds: string[]): Promise<{ success: boolean; error?: string; cancelled?: number }> {
  const ids = orderIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return { success: true, cancelled: 0 };
  if (isWebMode) {
    const proxy = await tradingProxyWalletForOrder();
    if (typeof proxy !== 'string') return { success: false, error: proxy.error };
    return cancelOrdersDirect(ids, proxy);
  }
  const results = await Promise.all(ids.map((id) => cancelOrder(id)));
  const cancelled = results.filter((r) => r.success).length;
  if (cancelled === 0) {
    return { success: false, error: results.find((r) => r.error)?.error || 'Cancel failed', cancelled: 0 };
  }
  return { success: true, cancelled };
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
    const proxy = await tradingProxyWalletForOrder();
    if (typeof proxy !== 'string') return { success: false, error: proxy.error };
    return signOrderOnly({ ...params, proxyWallet: proxy });
  }
  return { success: false, error: 'signOrder not supported in app mode' };
}

// Submit a previously signed order to the CLOB
export async function submitSignedOrder(signedPayload: any): Promise<{ success: boolean; orderID?: string; error?: string }> {
  return submitSignedOrderDirect(signedPayload);
}

export async function fetchArbProgs(status = 'active,filled,closed'): Promise<unknown> {
  const resp = await fetchBackend(`${BASE}/api/arb/prog?status=${status}`);
  return resp.json();
}

export async function fetchProgsByToken(tokenIds: string[]): Promise<{ progs?: unknown[] }> {
  const resp = await fetchBackend(`${BASE}/api/arb/progs-by-token?tokenIds=${encodeURIComponent(tokenIds.join(','))}`);
  return resp.json();
}

export async function fetchArbSummary(): Promise<unknown> {
  const resp = await fetchBackend(`${BASE}/api/arb/summary`);
  return resp.json();
}

export async function syncArbPositions(polyPositions: unknown[]): Promise<unknown> {
  const resp = await fetchBackend(`${BASE}/api/arb/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ polyPositions }),
  });
  return resp.json();
}

export async function closeArbPosition(progId: number, reason: string, revenue: number): Promise<unknown> {
  const resp = await fetchBackend(`${BASE}/api/arb/close`, {
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
  const resp = await fetchBackend(`${BASE}/api/arb/prog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

export async function cancelProgArb(progId: number): Promise<{ success: boolean; error?: string }> {
  const resp = await fetchBackend(`${BASE}/api/arb/prog/${progId}/cancel`, { method: 'POST' });
  return resp.json();
}

export async function rebidProg(progId: number, legIndex: number, price: number): Promise<unknown> {
  const resp = await fetchBackend(`${BASE}/api/arb/prog/${progId}/rebid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ legIndex, price }),
  });
  return resp.json();
}

export async function fetchProgTrades(progId: number): Promise<{ prog?: unknown; trades?: unknown[]; progOrders?: unknown[]; rawTrades?: unknown[] }> {
  const resp = await fetchBackend(`${BASE}/api/arb/prog/${progId}/trades`);
  return resp.json();
}

export async function fetchProgErrors(progId: number): Promise<{ errors?: unknown[] }> {
  const resp = await fetchBackend(`${BASE}/api/arb/prog/${progId}/errors`);
  return resp.json();
}

export async function updateProgSize(progId: number, size?: number, dollarSize?: number): Promise<boolean> {
  const body = dollarSize !== undefined ? { dollarSize } : { size };
  const resp = await fetchBackend(`${BASE}/api/arb/prog/${progId}/size`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return resp.ok;
}

export async function updateProgExpiry(progId: number, expiryMinutes: number): Promise<boolean> {
  const resp = await fetchBackend(`${BASE}/api/arb/prog/${progId}/expiry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiryMinutes }),
  });
  return resp.ok;
}

export async function updateProgAutoSell(progId: number, payload: { autoSell: boolean; mode?: string; price?: number | null; spread?: number | null }): Promise<boolean> {
  const resp = await fetchBackend(`${BASE}/api/arb/prog/${progId}/autosell`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return resp.ok;
}

export async function updateProgLoop(progId: number, loop: boolean): Promise<boolean> {
  const resp = await fetchBackend(`${BASE}/api/arb/prog/${progId}/loop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loop }),
  });
  return resp.ok;
}

export async function updateProgAnchor(progId: number, legIndex: number, anchor: string | null): Promise<boolean> {
  const resp = await fetchBackend(`${BASE}/api/arb/prog/${progId}/anchor`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ legIndex, anchor }),
  });
  return resp.ok;
}

export async function fetchPnlSummary(): Promise<{ pnlMap: Record<string, unknown> }> {
  const resp = await fetchBackend(`${BASE}/api/arb/pnl-summary`);
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
  const resp = await fetchBackend(`${BASE}/api/arb/pnl-drilldown?asset=${encodeURIComponent(asset)}&endDate=${encodeURIComponent(endDate)}`);
  return resp.json();
}

export async function fetchPnlDrilldownAll(): Promise<{ progs: DrilldownProg[] }> {
  const resp = await fetchBackend(`${BASE}/api/arb/pnl-drilldown-all`);
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
    const resp = await fetchBackend(`${BASE}/api/bs-live?${params}`);
    if (!resp.ok) return null;
    return resp.json();
  } catch {
    return null;
  }
}

export async function fetchPriceHistory(tokenId: string, interval = 'max', fidelity = '60'): Promise<{ history: { t: number; p: number }[] }> {
  const resp = await fetchBackend(`${BASE}/api/market-trades/${tokenId}?interval=${interval}&fidelity=${fidelity}`);
  if (!resp.ok) return { history: [] };
  return resp.json();
}

/**
 * Polycandles/Gamma attach `bestBid`/`bestAsk` to the market row for the YES token ([0]) only.
 * If both clob ids pointed at the same object, WS `bidAskBatch` would replace only one key’s copy
 * while the other still read those YES fields as the NO book → duplicate YES/NO cells after updates.
 * YES entry: shallow clone with API bid/ask. NO entry: clone without top-level bid/ask until WS patches that token.
 */
/** Gamma/static fields only — WS bid/ask + cohort metrics live on lookup entry, not poll array row. */
function marketGammaRowEqual(a: Market, b: Market): boolean {
  if (a.id !== b.id || a.conditionId !== b.conditionId) return false;
  if (a.question !== b.question || a.groupItemTitle !== b.groupItemTitle) return false;
  if (a.eventTitle !== b.eventTitle || a.eventSlug !== b.eventSlug) return false;
  if (a.endDate !== b.endDate || Boolean(a.closed) !== Boolean(b.closed)) return false;
  if (String(a.outcomePrices ?? '') !== String(b.outcomePrices ?? '')) return false;
  if (a.lastTradePrice !== b.lastTradePrice || a.priceToBeat !== b.priceToBeat) return false;
  const ca = a.clobTokenIds || [];
  const cb = b.clobTokenIds || [];
  if (ca.length !== cb.length) return false;
  for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) return false;
  return true;
}

const LOOKUP_WS_KEYS: (keyof Market)[] = [
  'bestBid', 'bestAsk', 'volume', 'wmpVolumeSum', 'sharesInExistence', 'marketNetDirection',
  'holders', 'smartMoneyBias', 'provenSMS', 'crowdBias', 'liveBias', 'liveBiasWindowMin',
  'concentration', 'winnerBias', 'winnerBiasYesWR', 'winnerBiasNoWR',
  'winBiasShares', 'winBiasSharesYes', 'winBiasSharesNo',
  'winnerBiasConviction', 'winnerBiasConvictionYesWR', 'winnerBiasConvictionNoWR',
  'winBiasConvictionShares', 'winBiasConvictionSharesYes', 'winBiasConvictionSharesNo',
  'stakedUsdYesLeg', 'stakedUsdNoLeg', 'stakedSumAbsSignedNetUsd',
  'stakedTopHoldersCohortYesUsd', 'stakedTopHoldersCohortNoUsd',
  'stakedNetYesUsd', 'stakedNetNoUsd',
];

function pickLookupWsFields(old: Market): Partial<Market> {
  const ws: Partial<Market> = {};
  for (const k of LOOKUP_WS_KEYS) {
    const v = old[k];
    if (v !== undefined && v !== null) (ws as Record<string, unknown>)[k as string] = v;
  }
  return ws;
}

function addMarketToTokenLookup(
  lookup: Record<string, Market>,
  prev: Record<string, Market> | undefined,
  m: Market,
) {
  const tokenIds = m.clobTokenIds || [];
  if (tokenIds.length === 0) return;
  const reuseOrClone = (id: string, _leg: 'YES' | 'NO', clearBidAsk: boolean) => {
    const old = prev?.[id];
    if (old && marketGammaRowEqual(old, m)) {
      lookup[id] = old;
      return;
    }
    const ws = old ? pickLookupWsFields(old) : {};
    lookup[id] = clearBidAsk
      ? { ...m, ...ws, bestBid: undefined, bestAsk: undefined }
      : { ...m, ...ws };
  };
  const register = (id: string, leg: 'YES' | 'NO', clearBidAsk: boolean) => {
    reuseOrClone(id, leg, clearBidAsk);
    const norm = normalizeClobTokenId(id);
    if (norm && norm !== id) reuseOrClone(norm, leg, clearBidAsk);
  };
  if (tokenIds.length === 1) {
    if (tokenIds[0]) register(tokenIds[0], 'YES', false);
    return;
  }
  if (tokenIds[0]) register(tokenIds[0], 'YES', false);
  if (tokenIds[1]) register(tokenIds[1], 'NO', true);
}

/** Reuse prior lookup entry refs when market row content unchanged. */
export function buildMarketLookup(
  aboveMarkets: Record<string, Market[]>,
  priceOnMarkets: Record<string, Market[]>,
  weeklyHitMarkets: Record<string, Market[]> = {},
  upOrDownMarkets: Record<string, Record<string, Market[]>> = {},
  weatherMarkets: Record<string, Market[]> = {},
  prevLookup?: Record<string, Market>,
): Record<string, Market> {
  const lookup: Record<string, Market> = {};
  const prev = prevLookup;
  for (const assetName of Object.keys(aboveMarkets)) {
    for (const m of aboveMarkets[assetName] || []) {
      addMarketToTokenLookup(lookup, prev, m);
    }
  }
  for (const assetName of Object.keys(priceOnMarkets)) {
    for (const m of priceOnMarkets[assetName] || []) {
      addMarketToTokenLookup(lookup, prev, m);
    }
  }
  for (const assetName of Object.keys(weeklyHitMarkets)) {
    for (const m of weeklyHitMarkets[assetName] || []) {
      addMarketToTokenLookup(lookup, prev, m);
    }
  }
  for (const assetName of Object.keys(upOrDownMarkets)) {
    for (const tf of Object.keys(upOrDownMarkets[assetName] || {})) {
      for (const m of upOrDownMarkets[assetName][tf] || []) {
        addMarketToTokenLookup(lookup, prev, m);
      }
    }
  }
  for (const city of Object.keys(weatherMarkets)) {
    for (const m of weatherMarkets[city] || []) {
      addMarketToTokenLookup(lookup, prev, m);
    }
  }
  if (!prev) return lookup;
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(lookup);
  if (prevKeys.length !== nextKeys.length) return lookup;
  for (const k of nextKeys) {
    if (prev[k] !== lookup[k]) return lookup;
  }
  return prev;
}

// --- Toxic Flow / On-chain API ---

/** Matches GET `/api/wallet-summary` JSON minus `found` — batched onto toxic-flow cohort rows / red flags. */
export interface WalletScoresLedgerEmbed {
  wallet: string;
  totalMarkets: number;
  resolvedMarkets?: number;
  totalTrades: number;
  wins: number;
  losses: number;
  flat: number;
  winRate: number;
  pnl: number;
  cashFlow: number;
  pm: number;
  lm: number;
  profitRate: number;
  usdcIn: number;
  usdcOut: number;
  roi?: number | null;
  volume?: number;
  /** Polymarket public profile name from `wallet_scores_ledger.polymarket_nickname`. */
  polymarketNickname?: string;
}

export interface WalletPosition {
  wallet: string;
  /** Synthetic rows (e.g. swarms): show this in the Wallet column instead of the address. */
  displayLabel?: string;
  /** Synthetic rows (e.g. swarms): exact signed staked USD (overrides inv-derived calc). YES lean negative, NO positive. */
  stakedNetSignedUsdOverride?: number;
  marketId: string;
  /** Raw `wallet_market_positions` (ledger); prefer for holders table. */
  invYes?: number;
  invNo?: number;
  /** Peak inventory YES leg from `wallet_market_positions.max_inv_yes`. */
  maxInvYes?: number;
  /** Peak inventory NO leg from `wallet_market_positions.max_inv_no`. */
  maxInvNo?: number;
  usdYes?: number;
  usdNo?: number;
  /** Same leg USDC as `usdYes` / `usd_no` when API sends `usdc_yes` / `usdc_no`. */
  usdcYes?: number;
  usdcNo?: number;
  feeTotal?: number;
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
  /** Σ `wallet_fill_ledger.delta_usd` (ledger cash flow). */
  cashFlow?: number;
  /** Realized trading PnL YES leg (`pnl_yes`). */
  pnlYes?: number;
  /** Realized trading PnL NO leg (`pnl_no`). */
  pnlNo?: number;
  /** Full-row PnL from DB (includes resolution when applied). */
  pnl: number;
  /** Running avg buy price YES/NO from `wallet_market_positions` (USDC/share, 0–1). */
  priceYes?: number;
  priceNo?: number;
  /** Ledger `wallet_market_positions`: resolved win (1), loss (1), or flat box (1). */
  w?: number;
  l?: number;
  f?: number;
  /** Ledger: `outcome` after resolution — 0 NO, 1 YES; omitted/null if unresolved. */
  outcome?: number | null;
  /** `wallet_market_positions.payout` (REDEEM gross). */
  payout?: number;
  /** Deprecated: no longer sent from `/api/wallet-positions`. Derived client-side when needed. */
  roi?: number;
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
  /** RFC3339-ish end time from joined `markets` (ledger mode). */
  endDate?: string;
  /** From wallet_scores: wins / (wins+losses); only set in toxic-flow response when winLossTotal > 0. */
  winRate?: number;
  /** Resolved markets with a win or loss (excludes flat-only); from wallet_scores. */
  winLossTotal?: number;
  /** From wallet_scores join on toxic-flow rows (for tooltip when /api/wallet-summary misses). */
  wins?: number;
  losses?: number;
  flat?: number;
  /** Proven smart wallet (>50% WR, ≥10 markets, PNL>0). */
  isSmart?: boolean;
  /** Full ledger row (wallet_scores_ledger), batched with toxic-flow. */
  walletLedgerSummary?: WalletScoresLedgerEmbed | null;
  /** `wallet_market_positions.last_updated` (RFC3339) when present. */
  lastUpdated?: string;
}

/** Co-trading cluster in this market (from cluster_wallet_assignment + positions). */
export interface ToxicFlowCluster {
  clusterId: number;
  mainWallet: string;
  clusterSize: number;
  membersInMarket: number;
  stakedNetSignedUsd: number;
  net: number;
  invYes: number;
  invNo: number;
  usdcIn: number;
  usdcOut: number;
  volume: number;
  tradeCount: number;
  positions: WalletPosition[];
}

/** Live swarm of wallets that entered same side together; sticky for market lifetime. */
export interface ToxicFlowSwarm {
  swarmId: number;
  /** 5s slot from market active; −1 = entered within 4s before open. */
  slotIndex?: number;
  side: 'YES' | 'NO';
  startTime: number;
  endTime: number;
  detectedAt: number;
  walletCount: number;
  members: string[];
  /** Members with effective positions in this market (subset of members). */
  membersInMarket: number;
  invYes: number;
  invNo: number;
  usdYes: number;
  usdNo: number;
  usdcIn: number;
  usdcOut: number;
  volume: number;
  net: number;
  netYes: number;
  netNo: number;
  boughtYes: number;
  soldYes: number;
  boughtNo: number;
  soldNo: number;
  feeTotal: number;
  priceYes: number;
  priceNo: number;
  tradeCount: number;
  stakedNetSignedUsd: number;
  /** Σ_member |inv_y·py − inv_n·pn| — exact per-position staked basis (matches market total). */
  stakedAbsSumUsd: number;
  /** Per-wallet positions in this market (same shape as topHolders rows). */
  positions?: WalletPosition[];
}

export interface ToxicFlowData {
  marketId: string;
  /** Top 100 holders by |net|; YES/NO/Smart/Whale tabs are derived client-side from this list. */
  topHolders: WalletPosition[];
  /** Cotrade clusters with per-wallet positions in this market (separate from topHolders). */
  clusters?: ToxicFlowCluster[];
  /** Live BUY swarms (detected in-memory by polycandles). Newest first. */
  swarms?: ToxicFlowSwarm[];
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
  redFlags?: {
    flag: string;
    detail: string;
    level: string;
    value: number;
    wallet?: string;
    walletLedgerSummary?: WalletScoresLedgerEmbed | null;
  }[];
  /** Backend: POLYGON_WSS_URL set */
  polygonWssConfigured?: boolean;
  /** All-time OrderFilled logs processed since process start */
  orderFilledEventsProcessed?: number;
  /** Sum of wallet_market_positions.trade counts for this market_id */
  walletMarketTradesForMarket?: number;
}

export async function fetchToxicFlow(marketId: string): Promise<ToxicFlowData> {
  const resp = await fetchBackend(`${BASE}/api/toxic-flow?market_id=${encodeURIComponent(marketId)}`);
  if (!resp.ok) throw new Error('Failed to fetch toxic flow');
  return resp.json();
}

export interface MarketStakedLegsResponse {
  stakedUsdYesLeg: number;
  stakedUsdNoLeg: number;
  /** Σ_w |Staked Net| — dominant-leg (inv_yes vs inv_no) share delta × leg price. */
  stakedSumAbsSignedNetUsd?: number;
  /** Full-market staked-net halves over ALL wallets: Σ YES-lean vs Σ NO-lean (sum = stakedSumAbsSignedNetUsd). Matches swarm cohort bar. */
  stakedNetYesUsd?: number;
  stakedNetNoUsd?: number;
}

function pickStakedNetHalves(
  a: MarketStakedLegsResponse | null | undefined,
  b: MarketStakedLegsResponse | null | undefined,
): { yes: number; no: number } | null {
  const pairs: { yes: number; no: number }[] = [];
  for (const src of [a, b]) {
    if (!src) continue;
    const y = src.stakedNetYesUsd;
    const n = src.stakedNetNoUsd;
    if (typeof y === 'number' && Number.isFinite(y) && typeof n === 'number' && Number.isFinite(n)) {
      pairs.push({ yes: y, no: n });
    }
  }
  return pairs.find((p) => p.yes + p.no > 0) ?? pairs[0] ?? null;
}

function pickPositiveSumAbs(
  a: MarketStakedLegsResponse | null | undefined,
  b: MarketStakedLegsResponse | null | undefined,
): number | undefined {
  for (const src of [a, b]) {
    const v = src?.stakedSumAbsSignedNetUsd;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  for (const src of [a, b]) {
    const v = src?.stakedSumAbsSignedNetUsd;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

function pickGrossLegs(
  live: MarketStakedLegsResponse | null | undefined,
  rest: MarketStakedLegsResponse | null | undefined,
): { yes: number; no: number } | null {
  const read = (src: MarketStakedLegsResponse | null | undefined) => {
    if (!src) return null;
    const y = src.stakedUsdYesLeg;
    const n = src.stakedUsdNoLeg;
    if (typeof y !== 'number' || !Number.isFinite(y) || typeof n !== 'number' || !Number.isFinite(n)) {
      return null;
    }
    return { yes: y, no: n };
  };
  const liveG = read(live);
  const restG = read(rest);
  const liveNets = pickStakedNetHalves(live, null);
  // Prefer live gross when live stake nets/sum look real; else REST (weather WS often empty).
  if (liveG && liveNets && liveNets.yes + liveNets.no > 0) return liveG;
  if (liveG && typeof live?.stakedSumAbsSignedNetUsd === 'number' && live.stakedSumAbsSignedNetUsd > 0) {
    return liveG;
  }
  if (restG && (restG.yes > 0 || restG.no > 0)) return restG;
  return restG ?? liveG;
}

/** WS often sends zeros for weather (shareStats unloaded); REST net halves must win over WS zeros. */
export function mergeMarketStakedLegsResponse(
  live: MarketStakedLegsResponse | null | undefined,
  rest: MarketStakedLegsResponse | null | undefined,
): MarketStakedLegsResponse | null {
  if (!live && !rest) return null;
  // REST first so weather /api/market-staked-legs beats WS all-zero shareStats.
  const nets = pickStakedNetHalves(rest, live);
  const gross = pickGrossLegs(live, rest);
  if (!gross && !nets) return null;

  const out: MarketStakedLegsResponse = {
    stakedUsdYesLeg: gross?.yes ?? 0,
    stakedUsdNoLeg: gross?.no ?? 0,
  };
  const sumAbs = pickPositiveSumAbs(rest, live);
  if (sumAbs != null) out.stakedSumAbsSignedNetUsd = sumAbs;
  if (nets) {
    out.stakedNetYesUsd = nets.yes;
    out.stakedNetNoUsd = nets.no;
    if (out.stakedSumAbsSignedNetUsd == null || out.stakedSumAbsSignedNetUsd <= 0) {
      const tot = nets.yes + nets.no;
      if (tot > 0) out.stakedSumAbsSignedNetUsd = tot;
    }
  }
  return out;
}

/** Market total staked = Σ_w |Staked Net| (dominant-leg inv×price). No |ΣY−ΣN| fallback. */
export function marketTotalStakedAbsUsd(legs: MarketStakedLegsResponse | null | undefined): number | null {
  if (!legs) return null;
  const v = legs.stakedSumAbsSignedNetUsd;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export async function fetchMarketStakedLegs(marketId: string): Promise<MarketStakedLegsResponse> {
  const resp = await fetchBackend(`${BASE}/api/market-staked-legs?market_id=${encodeURIComponent(marketId)}`);
  if (!resp.ok) throw new Error('Failed to fetch market staked legs');
  return resp.json();
}

/** Batch staked legs — one BE scan for up to 64 market ids. Keys match request ids. */
export async function fetchMarketsStakedLegs(
  marketIds: string[],
): Promise<Record<string, MarketStakedLegsResponse>> {
  const ids = [...new Set(marketIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return {};
  const resp = await fetchBackend(
    `${BASE}/api/markets-staked-legs?market_ids=${encodeURIComponent(ids.join(','))}`,
    undefined,
    { timeoutMs: 20_000 },
  );
  if (!resp.ok) throw new Error('Failed to fetch markets staked legs');
  const body = (await resp.json()) as { byMarketId?: Record<string, MarketStakedLegsResponse> };
  const by = body?.byMarketId;
  if (!by || typeof by !== 'object') return {};
  // Case-insensitive lookup: return map keyed by each requested id.
  const lower = new Map<string, MarketStakedLegsResponse>();
  for (const [k, v] of Object.entries(by)) {
    lower.set(k.toLowerCase(), v);
  }
  const out: Record<string, MarketStakedLegsResponse> = {};
  for (const id of ids) {
    const hit = by[id] ?? lower.get(id.toLowerCase());
    if (hit) out[id] = hit;
  }
  return out;
}

export type MarketOutcomeTokensResponse = {
  marketId: string;
  tokenIdYes: string;
  tokenIdNo: string;
};

export async function fetchMarketOutcomeTokens(marketId: string): Promise<MarketOutcomeTokensResponse | null> {
  const resp = await fetchBackend(`${BASE}/api/market-outcome-tokens?market_id=${encodeURIComponent(marketId)}`);
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Failed to fetch market outcome tokens: ${resp.status}`);
  return resp.json();
}

export interface OnchainMarketListItem {
  conditionId: string;
  question?: string;
  slug?: string;
  eventSlug?: string;
  asset?: string;
  timeframe?: string;
  endDate?: string;
  resolved?: number;
  outcome?: string;
  /** Market View weather squares — temp bucket label (e.g. 18, 84-85). */
  squareLabel?: string;
  /** Preserve CLOB tokens when converting weather Market → list item. */
  clobTokenIds?: string[];
}

export async function fetchOnchainMarkets(params: {
  asset: string;
  timeframe?: string;
  expired_only?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{
  markets: OnchainMarketListItem[];
  count: number;
  total: number;
  limit: number;
  offset: number;
}> {
  const qs = new URLSearchParams();
  qs.set('asset', params.asset);
  if (params.timeframe != null && params.timeframe !== '') {
    qs.set('timeframe', params.timeframe);
  }
  if (params.expired_only === false) qs.set('expired_only', '0');
  else qs.set('expired_only', '1');
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  const resp = await fetchBackend(`${BASE}/api/onchain-markets?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch onchain markets');
  return resp.json();
}

export async function fetchMarketWalletPositions(params: {
  market_id: string;
  limit?: number;
  offset?: number;
  sort?: 'pnl' | 'staked';
  order?: 'asc' | 'desc';
}): Promise<{
  positions: WalletPosition[];
  count: number;
  total: number;
  limit: number;
  offset: number;
  sort?: string;
  order?: string;
}> {
  const qs = new URLSearchParams();
  qs.set('market_id', params.market_id);
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  if (params.sort) qs.set('sort', params.sort);
  if (params.order) qs.set('order', params.order);
  const resp = await fetchBackend(`${BASE}/api/market-wallet-positions?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch market wallet positions');
  return resp.json();
}

export async function fetchWalletPositions(params: {
  market_id?: string;
  wallet?: string;
  asset?: string;
  type?: string;
  timeframe?: string;
  min_trades?: number;
  limit?: number;
  /** When true, server excludes closed markets and past end_date (joins `markets`). */
  active_only?: boolean;
  /** When true, server excludes open/future markets (end_date in the past). */
  expired_only?: boolean;
  /** When true, rows from `wallet_market_positions` (ledger). */
  ledger?: boolean;
  /** Backend sort: `end_date_desc` = newest expiry first (surfaces far-future markets under limit vs default chain_updated). */
  order?: 'end_date_desc';
}): Promise<{
  positions: WalletPosition[];
  count: number;
  /** Exact match count when fewer than `limit` rows (inferable); -1 if unknown or full page. */
  total: number;
}> {
  const qs = new URLSearchParams();
  if (params.market_id) qs.set('market_id', params.market_id);
  if (params.wallet) qs.set('wallet', params.wallet);
  if (params.asset) qs.set('asset', params.asset);
  if (params.type) qs.set('type', params.type);
  if (params.timeframe) qs.set('timeframe', params.timeframe);
  if (params.min_trades) qs.set('min_trades', String(params.min_trades));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.active_only) qs.set('active_only', '1');
  if (params.expired_only) qs.set('expired_only', '1');
  if (params.ledger) qs.set('ledger', '1');
  if (params.order) qs.set('order', params.order);
  const resp = await fetchBackend(`${BASE}/api/wallet-positions?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch wallet positions');
  return resp.json();
}

export interface OnchainFillRow {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockTime: number;
  /** `wallet_fill_ledger` when request includes ?wallet= */
  fillSource?: string;
  wallet?: string;
  action?: string;
  size?: number;
  price?: number | null;
  deltaInvYes?: number;
  deltaInvNo?: number;
  deltaUsdYes?: number;
  deltaUsdNo?: number;
  /** Live OrderFilled tape only */
  contract?: string;
  orderHash?: string;
  maker?: string;
  taker?: string;
  makerAssetId?: string;
  takerAssetId?: string;
  makerAmount?: number;
  takerAmount?: number;
  fee?: number;
  tokenId: string;
  side?: string;
  marketId: string;
  marketAsset?: string;
  marketType?: string;
  marketTimeframe?: string;
  /** 1 = complementary / mirror leg; still listed for activity when live RAM has it */
  isPhantom?: number;
  makerAccountSide?: string;
  takerAccountSide?: string;
  /** When fetching with ?wallet= — BUY|SELL for that wallet (Polymarket-style) */
  walletAccountSide?: string;
  /** Ledger: true = OrderFilled taker sweep (maker=wallet, taker=CTF exchange); false = maker leg or split/merge */
  isTaker?: boolean;
  /** Mempool overlay before wallet_fill_ledger row lands. */
  pending?: boolean;
  pendingId?: string;
  /** true = price is LIMIT/approx from calldata fast path; trace broadcast will replace with real exec price. */
  priceApproximate?: boolean;
}

export async function fetchOnchainFills(params: { market_id?: string; wallet?: string; token_id?: string; limit?: number; offset?: number }): Promise<{ fills: OnchainFillRow[]; count: number; total: number }> {
  const qs = new URLSearchParams();
  if (params.market_id) qs.set('market_id', params.market_id);
  if (params.wallet) qs.set('wallet', params.wallet);
  if (params.token_id) qs.set('token_id', params.token_id);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const resp = await fetchBackend(`${BASE}/api/onchain-fills?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch on-chain fills');
  return resp.json();
}

export interface OnchainMarketPositionRow {
  tokenId: string;
  size: number;
  avgPrice: number;
  feesPaid?: number;
  /** `markets.question` */
  title?: string;
  slug?: string;
  eventSlug?: string;
  marketId?: string;
  /** YES or NO from CLOB token match */
  outcome?: string;
  endDate?: string;
  underlyingAsset?: string;
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
  const resp = await fetchBackend(`${BASE}/api/onchain-market-positions?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch on-chain market positions');
  return resp.json();
}

export interface OnchainMarketTradeRow {
  txHash: string;
  logIndex: number;
  blockNumber?: number;
  blockTime: number;
  tokenId: string;
  /** Condition id when known */
  marketId?: string;
  /** BUY | SELL | SPLIT | MERGE | REDEEM (from wallet_fill_ledger.action) */
  side: 'BUY' | 'SELL' | 'SPLIT' | 'MERGE' | 'REDEEM';
  /** YES | NO when applicable (ledger outcome side) */
  outcome?: string;
  size: number;
  price: number;
  fee: number;
  /** USDC delta from ledger (useful for MERGE/REDEEM value) */
  deltaUsd?: number;
  /** From `markets` join (Polymarket question) */
  title?: string;
  slug?: string;
  eventSlug?: string;
}

export async function fetchOnchainMarketTrades(params: { token_ids: string[]; wallet: string; limit?: number; offset?: number }): Promise<{ trades: OnchainMarketTradeRow[]; count: number; total: number }> {
  const qs = new URLSearchParams();
  qs.set('token_ids', params.token_ids.join(','));
  qs.set('wallet', params.wallet);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const resp = await fetchBackend(`${BASE}/api/onchain-market-trades?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch on-chain market trades');
  return resp.json();
}

/** Full-wallet fill history (TPO trades browse). Optional side = BUY|SELL|… */
export async function fetchOnchainWalletTrades(params: {
  wallet: string;
  side?: 'ALL' | 'BUY' | 'SELL' | 'SPLIT' | 'MERGE' | 'REDEEM';
  limit?: number;
  offset?: number;
}): Promise<{ trades: OnchainMarketTradeRow[]; count: number; total: number; limit: number; offset: number }> {
  const qs = new URLSearchParams();
  qs.set('wallet', params.wallet);
  if (params.side && params.side !== 'ALL') qs.set('side', params.side);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  const resp = await fetchBackend(`${BASE}/api/onchain-wallet-trades?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch on-chain wallet trades');
  return resp.json();
}

// --- On-chain claims (PayoutRedemption) ---

export interface OnchainClaimRow {
  txHash: string;
  blockNumber: number;
  blockTime: number;
  conditionId: string;
  payout: number;
  marketId?: string;
  title?: string;
  eventSlug?: string;
}

export async function fetchOnchainClaims(params: { wallet: string; limit?: number; offset?: number }): Promise<{ claims: OnchainClaimRow[]; count: number; total: number }> {
  const qs = new URLSearchParams();
  qs.set('wallet', params.wallet);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const resp = await fetchBackend(`${BASE}/api/onchain-claims?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch on-chain claims');
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
  tz?: string;
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
  if (params.tz) qs.set('tz', params.tz);
  const resp = await fetchBackend(`${BASE}/api/wallet-pnl-daily?${qs.toString()}`);
  if (!resp.ok) throw new Error('Failed to fetch wallet P&L (on-chain)');
  return resp.json();
}

// --- Wallet Summary API ---

/** GET /api/wallet-summary — one row from `wallet_scores_ledger`. */
export interface WalletSummary {
  found: boolean;
  wallet: string;
  totalMarkets: number;
  /** `wallet_market_positions` rows with `outcome` set (resolved). */
  resolvedMarkets?: number;
  /** Σ `wallet_market_positions.trades` (fill rows). */
  totalTrades: number;
  wins: number;
  losses: number;
  flat: number;
  /** Stored ratio (≈ wins / total_markets); display ×100 for %. */
  winRate: number;
  /** Σ (`usdc_out` − `usdc_in` − `fee_total`) over `wallet_market_positions`. */
  pnl: number;
  cashFlow: number;
  pm: number;
  lm: number;
  /** pm / total_markets; display ×100 for %. */
  profitRate: number;
  usdcIn: number;
  usdcOut: number;
  /** Notional Σ usdc_in + usdc_out over positions (ledger aggregate); optional on some payloads. */
  volume?: number;
  /** Stored decimal (e.g. 0.12 = 12%); display ×100 for %. Null until resolved-markets basis exists. */
  roi?: number | null;
  /** `wallet_scores_ledger.last_updated` (RFC3339 UTC). */
  lastUpdated?: string;
  polymarketNickname?: string;
}

export function walletSummaryFromLedgerEmbed(rowWallet: string, embed: WalletScoresLedgerEmbed): WalletSummary {
  const w = (embed.wallet?.trim() || rowWallet.trim()).toLowerCase();
  return {
    found: true,
    wallet: w,
    totalMarkets: embed.totalMarkets,
    resolvedMarkets: embed.resolvedMarkets,
    totalTrades: embed.totalTrades,
    wins: embed.wins,
    losses: embed.losses,
    flat: embed.flat,
    winRate: embed.winRate,
    pnl: embed.pnl,
    cashFlow: embed.cashFlow,
    pm: embed.pm,
    lm: embed.lm,
    profitRate: embed.profitRate,
    usdcIn: embed.usdcIn,
    usdcOut: embed.usdcOut,
    roi: embed.roi,
    volume: embed.volume,
    polymarketNickname: (embed.polymarketNickname ?? '').trim() || undefined,
  };
}

export async function fetchWalletSummary(wallet: string): Promise<WalletSummary | null> {
  const resp = await fetchBackend(`${BASE}/api/wallet-summary?wallet=${wallet.toLowerCase()}`);
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.found ? data : null;
}

/** GET /api/wallet-scores-daily — `wallet_scores_daily_snapshot` rows for charting. */
export type WalletScoresDailyWindow = '7d' | '30d' | 'all';

export interface WalletScoresDailyPoint {
  date: string;
  winRate: number;
  profitRate: number;
  pnl: number;
  roi?: number | null;
}

export interface WalletScoresDailyResponse {
  wallet: string;
  window: WalletScoresDailyWindow;
  points: WalletScoresDailyPoint[];
}

export async function fetchWalletScoresDaily(
  wallet: string,
  window: WalletScoresDailyWindow = 'all',
): Promise<WalletScoresDailyResponse> {
  const w = wallet.toLowerCase();
  const resp = await fetch(
    `${BASE}/api/wallet-scores-daily?wallet=${encodeURIComponent(w)}&window=${encodeURIComponent(window)}`,
  );
  if (!resp.ok) throw new Error('Failed to fetch wallet scores daily');
  return resp.json();
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
  const resp = await fetchBackend(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, nickname, message }),
  });
  if (!resp.ok) throw new Error('Failed to send message');
  return resp.json();
}

export async function deleteChatMessage(id: number, address: string): Promise<void> {
  const body = JSON.stringify({ id, address });
  let resp = await fetchBackend(`${BASE}/api/chat`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  // Some deployed backends/proxies block DELETE; fallback to POST endpoint.
  if (resp.status === 405) {
    resp = await fetchBackend(`${BASE}/api/chat/delete`, {
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
  let resp = await fetchBackend(`${BASE}/api/chat/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  // Optional fallback for environments where only PATCH /api/chat is available.
  if (resp.status === 404 || resp.status === 405) {
    resp = await fetchBackend(`${BASE}/api/chat`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  }
  if (!resp.ok) throw new Error('Failed to edit message');
  return resp.json();
}

export interface WeatherTemperatureProbabilities {
  expected_value_c?: number;
  median_c?: number;
  std_c?: number;
  percentiles?: Record<string, number>;
  bucket_probabilities_1c?: Record<string, number>;
  distribution_notes?: string;
  confidence?: number;
}

export type WeatherForecastSourceId = 'open-meteo' | 'weather-company';

export interface WeatherProbabilitiesPayload {
  target_date: string;
  analysis_timestamp?: string;
  updated_at?: number;
  forecast_source?: WeatherForecastSourceId | string;
  highest_temperature?: WeatherTemperatureProbabilities;
  lowest_temperature?: WeatherTemperatureProbabilities;
  overall_rationale?: string;
  data_quality_notes?: string;
  /** Dual-source map when backend polls both OM + WC. */
  by_source?: Partial<Record<WeatherForecastSourceId | string, WeatherProbabilitiesPayload>>;
}

export async function fetchWeatherProbabilities(
  city: string,
  date: string,
): Promise<WeatherProbabilitiesPayload | null> {
  const resp = await fetch(
    `${BASE}/api/weather-probabilities/${encodeURIComponent(city)}?date=${encodeURIComponent(date)}`,
  );
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`weather probabilities ${resp.status}`);
  return resp.json();
}

export async function postWeatherProbabilities(city: string, payload: WeatherProbabilitiesPayload): Promise<void> {
  const resp = await fetchBackend(`${BASE}/api/weather-probabilities/${encodeURIComponent(city)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`post weather probabilities ${resp.status}`);
}
