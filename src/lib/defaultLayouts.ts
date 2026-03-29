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
  minW?: number; // minimum width in pixels
  minH?: number; // minimum height in pixels
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
  'asset-BTC':               { x: 0, y: 0,   w: 100, h: 50 },
  'updown-overview':         { x: 0, y: 50,  w: 100, h: 25 },
  'trades-positions-orders': { x: 0, y: 75,  w: 100, h: 20 },
  'signals':                 { x: 0, y: 75,  w: 100, h: 25 },
  'chat':                    { x: 0, y: 100,  w: 100, h: 25 },
};

// ─── Extra-small screens (≥640px, 8 cols) ────────────────────────
const xs: Record<string, LayoutRect> = {
  'asset-BTC':               { x: 0, y: 0,   w: 100, h: 50 },
  'updown-overview':         { x: 0, y: 50,  w: 100, h: 25 },
  'trades-positions-orders': { x: 0, y: 75,  w: 100, h: 25 },  
  'signals':                 { x: 0, y: 100,  w: 100, h: 25 },
  'chat':                    { x: 0, y: 125,  w: 100, h: 50 },
};

// ─── Tiny screens (<640px, 4 cols) ───────────────────────────────
const xxs: Record<string, LayoutRect> = {
  'asset-BTC':               { x: 0, y: 0,   w: 100, h: 80 },
  'updown-overview':         { x: 0, y: 80,  w: 100, h: 30 },
  'trades-positions-orders': { x: 0, y: 110,  w: 100, h: 50 },  
  'signals':                 { x: 0, y: 160,  w: 100, h: 50 },
  'chat':                    { x: 0, y: 210,  w: 100, h: 50 },
};

const PANEL_MIN_PIXELS: Record<string, { minW: number; minH: number }> = {
  'asset-BTC': { minW: 320, minH: 220 },
  'asset-ETH': { minW: 320, minH: 220 },
  'asset-SOL': { minW: 320, minH: 220 },
  'asset-XRP': { minW: 320, minH: 220 },
  'trades-positions-orders': { minW: 300, minH: 300 },
  'updown-overview': { minW: 300, minH: 200 },
  'relative-chart': { minW: 380, minH: 260 },
  'perp-bot': { minW: 280, minH: 180 },
  'price-forecast': { minW: 360, minH: 280 },
  'binance-chart': { minW: 380, minH: 300 },
  'signals': { minW: 300, minH: 150 },
  'chat': { minW: 280, minH: 180 },
  'pnl': { minW: 300, minH: 160 },
};

function withPanelMinPixels(layout: Record<string, LayoutRect>): Record<string, LayoutRect> {
  const next: Record<string, LayoutRect> = {};
  for (const [panelType, rect] of Object.entries(layout)) {
    next[panelType] = { ...rect, ...(PANEL_MIN_PIXELS[panelType] || {}) };
  }
  return next;
}

// ─── All breakpoints ─────────────────────────────────────────────
const BREAKPOINT_LAYOUTS: Record<string, Record<string, LayoutRect>> = {
  '2xl-tall': withPanelMinPixels(xxlTall),
  '2xl': withPanelMinPixels(xxl),
  xl: withPanelMinPixels(xl),
  lg: withPanelMinPixels(lg),
  md: withPanelMinPixels(md),
  sm: withPanelMinPixels(sm),
  xs: withPanelMinPixels(xs),
  xxs: withPanelMinPixels(xxs),
};

// Height thresholds for tall variants (viewport height in px)
export const HEIGHT_VARIANTS: Record<string, { minHeight: number; tallKey: string }> = {
  '2xl': { minHeight: 1500, tallKey: '2xl-tall' },
};

/** Column counts per layout breakpoint base key (must match react-grid `cols`). */
export const GRID_COLS: Record<string, number> = {
  '2xl': 36, xl: 28, lg: 24, md: 20, sm: 12, xs: 8, xxs: 4,
};

const TOTAL_ROWS_ESTIMATE = 100;

/**
 * Grid w/h for a new panel = pixel minimums from defaultLayouts (minW/minH on the rect, or PANEL_MIN_PIXELS),
 * converted to columns/rows — same basis as DraggableCanvas getDefaultLayout.
 */
export function gridSizeFromDefaultLayoutMins(
  panelType: string,
  layoutBreakpointKey: string,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1600,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900,
): { w: number; h: number } {
  const base = layoutBreakpointKey.replace(/-tall$/, '');
  const cols = GRID_COLS[base] || 24;
  const colWidthPx = Math.max(1, viewportWidth / cols);
  const rowPx = Math.max(1, viewportHeight / TOTAL_ROWS_ESTIMATE);

  const bpMap = BREAKPOINT_LAYOUTS[layoutBreakpointKey] || BREAKPOINT_LAYOUTS.lg;
  const pct = bpMap[panelType];
  const minWpx = pct?.minW ?? PANEL_MIN_PIXELS[panelType as keyof typeof PANEL_MIN_PIXELS]?.minW;
  const minHpx = pct?.minH ?? PANEL_MIN_PIXELS[panelType as keyof typeof PANEL_MIN_PIXELS]?.minH;

  if (minWpx != null && minWpx > 0 && minHpx != null && minHpx > 0) {
    return {
      w: Math.min(cols, Math.max(1, Math.ceil(minWpx / colWidthPx))),
      h: Math.max(1, Math.ceil(minHpx / rowPx)),
    };
  }

  return { w: Math.min(cols, 12), h: 6 };
}

export default BREAKPOINT_LAYOUTS;

export type { LayoutRect };
