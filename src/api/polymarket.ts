import type { Position, Order, Trade } from '../types';
import { isDev } from '../lib/env';

// Cache: EOA → proxy wallet address
const proxyWalletCache: Record<string, string> = {};

// In dev mode, proxy through backend to avoid CORS; in live mode, call Polymarket directly
function dataUrl(path: string): string {
  if (isDev) return `/api/polyproxy/data/${path}`;
  return `https://data-api.polymarket.com/${path}`;
}

function _clobUrl(path: string): string {
  if (isDev) return `/api/polyproxy/clob/${path}`;
  return `https://clob.polymarket.com/${path}`;
}

// Fetch positions from Polymarket Data API (public, no auth)
export async function fetchWalletPositions(address: string): Promise<Position[]> {
  const PAGE_SIZE = 500;
  let all: Position[] = [];
  let offset = 0;
  while (true) {
    const resp = await fetch(dataUrl(`positions?user=${address}&sizeThreshold=0&limit=${PAGE_SIZE}&offset=${offset}`));
    if (!resp.ok) break;
    const page = await resp.json();
    if (!Array.isArray(page)) break;
    all = all.concat(page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all.filter((p: Position) => !p.redeemable && p.size > 0);
}

// Fetch activity/trades from Polymarket Data API (public, no auth)
export async function fetchWalletActivity(address: string, limit = 100): Promise<Trade[]> {
  const resp = await fetch(dataUrl(`activity?user=${address}&limit=${limit}`));
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

// Fetch open orders from Polymarket CLOB (public endpoint for reading orders by market)
// Note: user-specific open orders require auth via CLOB API - we read from data API activity instead
export async function fetchWalletOpenOrders(address: string): Promise<Order[]> {
  const resp = await fetch(dataUrl(`orders?user=${address}&state=OPEN`));
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

// Resolve EOA → Polymarket Safe proxy wallet address via gamma API
export async function fetchProxyWallet(eoaAddress: string): Promise<string | null> {
  const key = eoaAddress.toLowerCase();
  if (proxyWalletCache[key]) return proxyWalletCache[key];
  try {
    const url = isDev
      ? `/api/polyproxy/gamma/public-profile?address=${eoaAddress}`
      : `https://gamma-api.polymarket.com/public-profile?address=${eoaAddress}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.proxyWallet) {
      proxyWalletCache[key] = data.proxyWallet;
      return data.proxyWallet;
    }
    return null;
  } catch {
    return null;
  }
}

// Fetch USDC balance on Polygon via public RPC
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const BALANCE_OF_SIG = '0x70a08231';

export async function fetchWalletBalance(address: string): Promise<number> {
  try {
    // Encode balanceOf(address) call
    const paddedAddr = address.toLowerCase().replace('0x', '').padStart(64, '0');
    const data = BALANCE_OF_SIG + paddedAddr;
    const resp = await fetch('https://polygon-bor-rpc.publicnode.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: USDC_ADDRESS, data }, 'latest'],
        id: 1,
      }),
    });
    const json = await resp.json();
    if (json.result) {
      const raw = BigInt(json.result);
      return Number(raw) / 1e6; // USDC has 6 decimals
    }
    return 0;
  } catch {
    return 0;
  }
}
