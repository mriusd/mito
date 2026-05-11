// VITE_MODE: 'web' = all wallet data from Polymarket directly, 'app' = all data from backend cache
export const isWebMode = import.meta.env.VITE_MODE === 'web';
export const isAppMode = import.meta.env.VITE_MODE !== 'web';
export const isDev = import.meta.env.VITE_ENV === 'dev';
export const isProd = import.meta.env.VITE_ENV === 'prod';

// VITE_FE_ENV: 'dev' = proxy Polymarket API calls through backend (localhost CORS workaround)
// Defaults to VITE_ENV if not set
export const isFeDev = (import.meta.env.VITE_FE_ENV || import.meta.env.VITE_ENV) === 'dev';

export const API_BASE = isProd ? 'https://data.mito.trade' : '';
export const WS_BASE = isProd ? 'wss://data.mito.trade' : `ws://${window.location.hostname}:3099`;

/** Polygon JSON-RPC for private-key merges / CLOB. Default avoids eth_chainId browser failures; override if blocked. */
export const POLYGON_JSONRPC_URL =
  (typeof import.meta.env.VITE_POLYGON_RPC_URL === 'string' && import.meta.env.VITE_POLYGON_RPC_URL.trim()) ||
  'https://polygon-bor.publicnode.com';

/** Ethers.Networkish for Polygon mainnet — use with StaticJsonRpcProvider (no live chain probe). */
export const POLYGON_ETHERS_NETWORK = { chainId: 137, name: 'matic' } as const;

/** CLOB v2 builder attribution: `bytes32` from polymarket.com/settings → Builder (optional). */
export function vitePolyBuilderCode(): string | undefined {
  const raw = String(import.meta.env.VITE_POLY_BUILDER_CODE || '').trim();
  if (!raw) return undefined;
  const h = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) return undefined;
  return h.toLowerCase();
}

/** 0 EOA | 1 proxy | 2 gnosis safe | 3 deposit EIP-1271 — matches mitobot POLYMARKET_SIGNATURE_TYPE */
export function vitePolymarketSignatureType(): 0 | 1 | 2 | 3 | undefined {
  const raw = String(import.meta.env.VITE_POLYMARKET_SIGNATURE_TYPE ?? '').trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (n === 0 || n === 1 || n === 2 || n === 3) return n;
  return undefined;
}

/** Deposit wallet / Safe override — matches mitobot POLYMARKET_FUNDER */
export function vitePolymarketFunder(): string | undefined {
  const raw = String(import.meta.env.VITE_POLYMARKET_FUNDER ?? '').trim();
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return undefined;
  return raw.toLowerCase();
}
