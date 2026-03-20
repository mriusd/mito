// VITE_MODE: 'web' = all wallet data from Polymarket directly, 'app' = all data from backend cache
export const isWebMode = import.meta.env.VITE_MODE === 'web';
export const isAppMode = import.meta.env.VITE_MODE !== 'web';
export const isDev = import.meta.env.VITE_ENV === 'dev';
export const isProd = import.meta.env.VITE_ENV === 'prod';

export const API_BASE = isProd ? 'https://data.mito.trade' : '';
export const WS_BASE = isProd ? 'wss://data.mito.trade' : `ws://${window.location.hostname}:3099`;
