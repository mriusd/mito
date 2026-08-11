import type { Position, Order, Trade } from '../types';
import { API_BASE, POLYGON_JSONRPC_URL } from '../lib/env';

// Cache: EOA → proxy wallet address
const proxyWalletCache: Record<string, string> = {};
const polymarketNicknameCache: Record<string, string> = {};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Always proxy Data API through our backend.
 * Direct browser hits to data-api.polymarket.com 429 under multi-page position loads
 * (prod load storms); local often worked only because VITE_FE_ENV=dev forced the proxy.
 */
function dataUrl(path: string): string {
  return `${API_BASE}/api/polyproxy/data/${path}`;
}

async function fetchDataApi(path: string, init?: RequestInit): Promise<Response> {
  const maxAttempts = 4;
  let lastStatus = 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 20_000);
    try {
      const resp = await fetch(dataUrl(path), { ...init, signal: ctrl.signal });
      lastStatus = resp.status;
      // Retry rate-limits / upstream blips; keep partial progress callers can resume.
      if (resp.status === 429 || resp.status === 502 || resp.status === 503 || resp.status === 504) {
        await sleep(400 * 2 ** attempt + Math.floor(Math.random() * 200));
        continue;
      }
      return resp;
    } catch (err) {
      lastErr = err;
      await sleep(400 * 2 ** attempt + Math.floor(Math.random() * 200));
    } finally {
      window.clearTimeout(timer);
    }
  }
  if (lastErr) throw lastErr;
  throw new Error(`Data API failed after retries (status ${lastStatus}): ${path}`);
}

// Fetch positions from Polymarket Data API (public, no auth)
export async function fetchWalletPositions(address: string): Promise<Position[]> {
  const PAGE_SIZE = 500;
  // API max offset is 10_000; stop earlier so a 429 mid-walk still returns pages we have.
  const MAX_OFFSET = 10_000;
  const user = encodeURIComponent(address);
  let all: Position[] = [];
  let offset = 0;
  while (offset <= MAX_OFFSET) {
    let resp: Response;
    try {
      // sizeThreshold=0 includes sub-1-share dust; redeemable defaults false (open only).
      resp = await fetchDataApi(
        `positions?user=${user}&sizeThreshold=0&limit=${PAGE_SIZE}&offset=${offset}`,
      );
    } catch (err) {
      console.warn('[fetchWalletPositions] page failed, returning partial', { offset, err });
      break;
    }
    if (!resp.ok) {
      console.warn('[fetchWalletPositions] non-OK, returning partial', { offset, status: resp.status });
      break;
    }
    let page: unknown;
    try {
      page = await resp.json();
    } catch {
      break;
    }
    if (!Array.isArray(page)) break;
    all = all.concat(page as Position[]);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all.filter((p: Position) => !p.redeemable && p.size > 0);
}

// Fetch activity/trades from Polymarket Data API (public, no auth)
export async function fetchWalletActivity(address: string, limit = 100): Promise<Trade[]> {
  try {
    const resp = await fetchDataApi(
      `activity?user=${encodeURIComponent(address)}&limit=${limit}`,
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** All activity rows in a local-calendar date range (paginated; for P&L panel). */
export async function fetchWalletActivityForDateRange(
  address: string,
  fromStr: string,
  toStr: string,
): Promise<Trade[]> {
  const startMs = new Date(`${fromStr}T00:00:00`).getTime();
  const endMs = new Date(`${toStr}T23:59:59`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const start = Math.floor(startMs / 1000);
  const end = Math.floor(endMs / 1000);
  const PAGE_SIZE = 500;
  const MAX_OFFSET = 10_000;
  let all: Trade[] = [];
  let offset = 0;
  const user = encodeURIComponent(address);
  while (offset <= MAX_OFFSET) {
    let resp: Response;
    try {
      resp = await fetchDataApi(
        `activity?user=${user}&limit=${PAGE_SIZE}&offset=${offset}&start=${start}&end=${end}`,
      );
    } catch {
      break;
    }
    if (!resp.ok) break;
    const page = await resp.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all = all.concat(page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

// Fetch open orders from Polymarket CLOB (public endpoint for reading orders by market)
// Note: user-specific open orders require auth via CLOB API - we read from data API activity instead
export async function fetchWalletOpenOrders(address: string): Promise<Order[]> {
  try {
    const resp = await fetchDataApi(`orders?user=${encodeURIComponent(address)}&state=OPEN`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Resolve EOA → Polymarket Safe proxy wallet address via gamma API
export async function fetchProxyWallet(eoaAddress: string): Promise<string | null> {
  const key = eoaAddress.toLowerCase();
  if (proxyWalletCache[key]) return proxyWalletCache[key];
  try {
    // Gamma API is CORS-restricted in browser contexts; always use backend proxy.
    const url = `${API_BASE}/api/polyproxy/gamma/public-profile?address=${eoaAddress}`;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 15_000);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data.proxyWallet) {
        proxyWalletCache[key] = data.proxyWallet;
        return data.proxyWallet;
      }
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Gamma public-profile username (browser uses backend proxy). */
export async function fetchPolymarketNickname(address: string): Promise<string> {
  const key = address.toLowerCase();
  if (polymarketNicknameCache[key]) return polymarketNicknameCache[key];
  try {
    const url = `${API_BASE}/api/polyproxy/gamma/public-profile?address=${address}`;
    const resp = await fetch(url);
    if (!resp.ok) return '';
    const data = await resp.json();
    const name = String(data.username || data.name || '').trim();
    if (name) polymarketNicknameCache[key] = name;
    return name;
  } catch {
    return '';
  }
}

// Polymarket proxy wallet: CLOB collateral is pUSD; legacy USDC.e may still sit in wallet
const PUSD_ADDRESS = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';
const USDCE_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const BALANCE_OF_SIG = '0x70a08231';

const POLYGON_RPC_FALLBACKS = [
  POLYGON_JSONRPC_URL,
  'https://polygon-bor.publicnode.com',
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon-rpc.com',
].filter((u, i, arr) => u && arr.indexOf(u) === i);

async function erc20BalanceOnPolygon(token: string, holder: string, rpcUrl: string): Promise<number> {
  const paddedAddr = holder.toLowerCase().replace('0x', '').padStart(64, '0');
  const data = BALANCE_OF_SIG + paddedAddr;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 12_000);
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: token, data }, 'latest'],
        id: 1,
      }),
      signal: ctrl.signal,
    });
    const json = await resp.json();
    if (!json.result || typeof json.result !== 'string') return 0;
    return Number(BigInt(json.result)) / 1e6;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchWalletBalance(address: string): Promise<number> {
  const holder = address.trim();
  if (!holder) return 0;
  let lastErr: unknown;
  for (const rpc of POLYGON_RPC_FALLBACKS) {
    try {
      const [pusd, usdce] = await Promise.all([
        erc20BalanceOnPolygon(PUSD_ADDRESS, holder, rpc),
        erc20BalanceOnPolygon(USDCE_ADDRESS, holder, rpc),
      ]);
      return pusd + usdce;
    } catch (err) {
      lastErr = err;
    }
  }
  console.warn('[fetchWalletBalance] all RPCs failed:', lastErr);
  return 0;
}
