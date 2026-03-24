/**
 * Default panel layouts for each screen-size breakpoint.
 *
 * Breakpoints (synced with Tailwind screens):
 *   2xl ≥ 2400px  — 36 columns
 *   xl  ≥ 1600px  — 28 columns
 *   lg  ≥ 1280px  — 24 columns
 *   md  ≥ 1024px  — 20 columns
 *   sm  ≥  768px  — 12 columns
 *   xs  ≥  640px  —  8 columns
 *   xxs <  640px  —  4 columns
 *
 * Values use PERCENTAGES:
 *   x: % of total columns for horizontal offset
 *   y: % of canvas height for vertical position (absolute, 0-100)
 *   w: % of total columns (100 = full width)
 *   h: % of canvas height (50 = half the screen)
 *
 * Panels not listed here will be stacked at the bottom automatically.
 */

interface LayoutRect {
  x: number;   // % of columns for horizontal offset
  y: number;   // % of canvas height for vertical offset (absolute position, 0-100)
  w: number;   // % of columns for width
  h: number;   // % of canvas height for height
}

// ─── 2XL screens (≥2400px, 36 cols) ──────────────────────────────
const xxl: Record<string, LayoutRect> = {
  'asset-BTC':               { x: 0,   y: 0,  w: 50,  h: 50 },
  'asset-ETH':               { x: 50,  y: 0,  w: 50,  h: 50 },
  'trades-positions-orders': { x: 0,   y: 50, w: 33,  h: 50 },
  'updown-overview':         { x: 33,  y: 50, w: 33,  h: 25 },
  'signals':                 { x: 33,  y: 75, w: 33,  h: 25 },
  'chat':                    { x: 66,  y: 50, w: 34,  h: 50 },
};

// ─── 2XL tall screens (≥2400px wide, ≥1500px tall) ──────────────
const xxlTall: Record<string, LayoutRect> = {
  'asset-BTC':               { x: 0,   y: 0,  w: 50,  h: 25 },
  'asset-ETH':               { x: 50,  y: 0,  w: 50,  h: 25 },
  'asset-SOL':               { x: 0,   y: 25, w: 50,  h: 25 },
  'asset-XRP':               { x: 50,  y: 25, w: 50,  h: 25 },
  'pnl':                     { x: 0,   y: 50, w: 33,  h: 15 },
  'trades-positions-orders': { x: 0,   y: 65, w: 33,  h: 35 },
  'updown-overview':         { x: 33,  y: 50, w: 33,  h: 15 },
  'signals':                 { x: 33,  y: 65, w: 33,  h: 35},
  'chat':                    { x: 66,  y: 50, w: 34,  h: 50 },
};

// ─── XL screens (≥1600px, 28 cols) ──────────────────────────────
const xl: Record<string, LayoutRect> = {
  'asset-BTC':               { x: 0,   y: 0,  w: 100, h: 50 },
  'trades-positions-orders': { x: 0,   y: 50, w: 33,  h: 50 },
  'updown-overview':         { x: 33,  y: 50, w: 33,  h: 25 },
  'signals':                 { x: 33,  y: 75, w: 33,  h: 25 },
  'chat':                    { x: 66,  y: 50, w: 34,  h: 50 },
};

// ─── Large screens (≥1280px, 24 cols) ────────────────────────────
const lg: Record<string, LayoutRect> = {
  'asset-BTC':               { x: 0,   y: 0,  w: 100, h: 50 },
  'trades-positions-orders': { x: 0,   y: 50, w: 50,  h: 25 },
  'updown-overview':         { x: 50,  y: 50, w: 50,  h: 25 },
  'chat':                    { x: 0,   y: 75, w: 50,  h: 25 },
  'signals':                 { x: 50,  y: 75, w: 50,  h: 25 },
};

// ─── Medium screens (≥1024px, 20 cols) ───────────────────────────
const md: Record<string, LayoutRect> = {
  'asset-BTC':               { x: 0,   y: 0,  w: 100, h: 50 },
  'trades-positions-orders': { x: 0,   y: 50, w: 50,  h: 25 },
  'updown-overview':         { x: 50,  y: 50, w: 50,  h: 25 },
  'chat':                    { x: 0,   y: 75, w: 50,  h: 25 },
  'signals':                 { x: 50,  y: 75, w: 50,  h: 25 },
};

// ─── Small screens (≥768px, 12 cols) ─────────────────────────────
const sm: Record<string, LayoutRect> = {
  'asset-BTC':               { x: 0, y: 0,   w: 100, h: 30 },
  'trades-positions-orders': { x: 0, y: 30,  w: 100, h: 30 },
  'updown-overview':         { x: 0, y: 60,  w: 100, h: 15 },
  'signals':                 { x: 0, y: 75,  w: 100, h: 15 },
  'chat':                    { x: 0, y: 90,  w: 100, h: 10 },
};

// ─── Extra-small screens (≥640px, 8 cols) ────────────────────────
const xs: Record<string, LayoutRect> = {
  'asset-BTC':               { x: 0, y: 0,   w: 100, h: 30 },
  'trades-positions-orders': { x: 0, y: 30,  w: 100, h: 30 },
  'updown-overview':         { x: 0, y: 60,  w: 100, h: 15 },
  'signals':                 { x: 0, y: 75,  w: 100, h: 15 },
  'chat':                    { x: 0, y: 90,  w: 100, h: 10 },
};

// ─── Tiny screens (<640px, 4 cols) ───────────────────────────────
const xxs: Record<string, LayoutRect> = {
  'asset-BTC':               { x: 0, y: 0,   w: 100, h: 30 },
  'trades-positions-orders': { x: 0, y: 30,  w: 100, h: 30 },
  'updown-overview':         { x: 0, y: 60,  w: 100, h: 15 },
  'signals':                 { x: 0, y: 75,  w: 100, h: 15 },
  'chat':                    { x: 0, y: 90,  w: 100, h: 10 },
};

// ─── All breakpoints ─────────────────────────────────────────────
const BREAKPOINT_LAYOUTS: Record<string, Record<string, LayoutRect>> = {
  '2xl-tall': xxlTall,
  '2xl': xxl,
  xl,
  lg,
  md,
  sm,
  xs,
  xxs,
};

// Height thresholds for tall variants (viewport height in px)
export const HEIGHT_VARIANTS: Record<string, { minHeight: number; tallKey: string }> = {
  '2xl': { minHeight: 1500, tallKey: '2xl-tall' },
};

export default BREAKPOINT_LAYOUTS;

export type { LayoutRect };
