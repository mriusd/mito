// VITE_MODE: 'web' = all wallet data from Polymarket directly, 'app' = all data from backend cache
export const isWebMode = import.meta.env.VITE_MODE === 'web';
export const isAppMode = import.meta.env.VITE_MODE !== 'web';
export const isDev = import.meta.env.VITE_ENV === 'dev';
