// VITE_MODE: 'web' = all wallet data from Polymarket directly, 'app' = all data from backend cache
export const isWebMode = import.meta.env.VITE_MODE === 'web';
export const isAppMode = import.meta.env.VITE_MODE !== 'web';
export const isDev = import.meta.env.VITE_ENV === 'dev';
export const isProd = import.meta.env.VITE_ENV === 'prod';

// VITE_FE_ENV: 'dev' = proxy Polymarket API calls through backend (localhost CORS workaround)
// Defaults to VITE_ENV if not set
export const isFeDev = (import.meta.env.VITE_FE_ENV || import.meta.env.VITE_ENV) === 'dev';

/** Optional override: e.g. http://127.0.0.1:3099 for vite preview against local polycandles */
const explicitApiBase = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/$/, '');

/**
 * Dev server (vite): '' → relative `/api/*` uses vite proxy to polycandles.
 * Production bundle (e.g. Vercel without VITE_ENV=prod): default polycandles host.
 * Override anytime with VITE_API_BASE.
 */
export const API_BASE =
  explicitApiBase ||
  (import.meta.env.DEV ? '' : 'https://data.mito.trade');

export const WS_BASE = explicitApiBase
  ? explicitApiBase.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')
  : import.meta.env.DEV
    ? `ws://${window.location.hostname}:3099`
    : 'wss://data.mito.trade';

/** CLOB v2 builder attribution: `bytes32` from polymarket.com/settings → Builder (optional). */
export function vitePolyBuilderCode(): string | undefined {
  const raw = String(import.meta.env.VITE_POLY_BUILDER_CODE || '').trim();
  if (!raw) return undefined;
  const h = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) return undefined;
  return h.toLowerCase();
}

