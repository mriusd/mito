import { Suspense, useCallback, useMemo, useRef, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { ReactGridLayout as RGLGrid } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import { X } from 'lucide-react';
import { useAppStore, type PersistedGridLayouts } from '../stores/appStore';
import { lazyWithChunkReload } from '../utils/lazyWithChunkReload';
import type { PanelConfig, PanelType } from '../types';
import BREAKPOINT_LAYOUTS, { HEIGHT_VARIANTS, GRID_COLS } from '../lib/defaultLayouts';

const LazyAssetMarketTable = lazyWithChunkReload(() =>
  import('./panels/AssetMarketTable').then((m) => ({ default: m.AssetMarketTable })),
);
const LazyHedgesTable = lazyWithChunkReload(() =>
  import('./panels/ArbsTable').then((m) => ({ default: m.HedgesTable })),
);
const LazySummaryTable = lazyWithChunkReload(() =>
  import('./panels/SummaryTable').then((m) => ({ default: m.SummaryTable })),
);
const LazyArbPositionsTable = lazyWithChunkReload(() =>
  import('./panels/ArbPositionsTable').then((m) => ({ default: m.ArbPositionsTable })),
);
const LazySignalsTable = lazyWithChunkReload(() =>
  import('./panels/SignalsTable').then((m) => ({ default: m.SignalsTable })),
);
const LazyTradesPositionsOrders = lazyWithChunkReload(() =>
  import('./panels/TradesPositionsOrders').then((m) => ({ default: m.TradesPositionsOrders })),
);
const LazyPnLPanel = lazyWithChunkReload(() =>
  import('./panels/PnLPanel').then((m) => ({ default: m.PnLPanel })),
);
const LazyUpDownMarketsPanel = lazyWithChunkReload(() =>
  import('./panels/UpDownMarketsPanel').then((m) => ({ default: m.UpDownMarketsPanel })),
);
const LazyRelativeChartPanel = lazyWithChunkReload(() =>
  import('./panels/RelativeChartPanel').then((m) => ({ default: m.RelativeChartPanel })),
);
const LazyPriceForecastPanel = lazyWithChunkReload(() =>
  import('./panels/PriceForecastPanel').then((m) => ({ default: m.PriceForecastPanel })),
);
const LazyBinanceChartPanel = lazyWithChunkReload(() =>
  import('./panels/BinanceChartPanel').then((m) => ({ default: m.BinanceChartPanel })),
);
const LazySpotOrderbookPanel = lazyWithChunkReload(() =>
  import('./panels/SpotOrderbookPanel').then((m) => ({ default: m.SpotOrderbookPanel })),
);
const LazyUpOrDownHUDPanel = lazyWithChunkReload(() =>
  import('./panels/UpOrDownHUDPanel').then((m) => ({ default: m.UpOrDownHUDPanel })),
);
const LazyChatPanel = lazyWithChunkReload(() =>
  import('./panels/ChatPanel').then((m) => ({ default: m.ChatPanel })),
);
const LazySmartMoneyPanel = lazyWithChunkReload(() =>
  import('./panels/SmartMoneyPanel').then((m) => ({ default: m.SmartMoneyPanel })),
);
const LazyHistoryPanel = lazyWithChunkReload(() =>
  import('./panels/HistoryPanel').then((m) => ({ default: m.HistoryPanel })),
);

const IS_DEV = import.meta.env.DEV;
const LazyPerpBotPanel = IS_DEV
  ? lazyWithChunkReload(() => import('./panels/PerpBotPanel').then((m) => ({ default: m.PerpBotPanel })))
  : null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- react-grid-layout/legacy default export not fully typed
const GridLayout = RGLGrid as any;

interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

interface LayoutsMap {
  [breakpoint: string]: LayoutItem[];
}

const COLS = GRID_COLS;
// Thresholds based on viewport width (synced with defaultLayouts.ts docs)
const BREAKPOINTS_SORTED = [
  { name: '2xl', min: 2400 }, { name: 'xl', min: 1600 }, { name: 'lg', min: 1280 },
  { name: 'md', min: 1024 }, { name: 'sm', min: 768 }, { name: 'xs', min: 640 }, { name: 'xxs', min: 0 },
];
function getBreakpoint(viewportWidth: number, viewportHeight?: number): string {
  for (const bp of BREAKPOINTS_SORTED) {
    if (viewportWidth >= bp.min) {
      // Check for tall variant
      const hv = HEIGHT_VARIANTS[bp.name];
      if (hv && viewportHeight && viewportHeight >= hv.minHeight) {
        return hv.tallKey;
      }
      return bp.name;
    }
  }
  return 'xxs';
}
const TOTAL_ROWS = 100;

function getDefaultLayout(
  panels: PanelConfig[],
  breakpoint: string,
  containerWidthPx?: number,
  rowHeightPx?: number
): LayoutItem[] {
  const bpMap = BREAKPOINT_LAYOUTS[breakpoint] || BREAKPOINT_LAYOUTS.lg;
  const base = breakpoint.replace(/-tall$/, '');
  const cols = COLS[base] || 24;
  const colWidthPx = Math.max(1, (containerWidthPx || window.innerWidth) / cols);
  const rowPx = Math.max(1, rowHeightPx || (window.innerHeight / TOTAL_ROWS));
  const layout: LayoutItem[] = [];
  let maxY = 0;

  for (const p of panels) {
    const pct = bpMap[p.type];
    if (pct) {
      const baseW = Math.max(1, Math.round(cols * pct.w / 100));
      const x = Math.round(cols * pct.x / 100);
      const baseH = Math.max(1, Math.round(pct.h));
      const y = Math.round(pct.y);
      // Pixel mins only influence the *initial* w/h from defaults, not RGL resize limits (those stay at 1).
      const minWFromPct = pct.minW ? Math.max(1, Math.ceil(pct.minW / colWidthPx)) : 2;
      const minHFromPct = pct.minH ? Math.max(1, Math.ceil(pct.minH / rowPx)) : 1;
      const w = Math.max(baseW, minWFromPct);
      const h = Math.max(baseH, minHFromPct);
      layout.push({ i: p.id, x, y, w, h, minW: 1, minH: 1 });
      maxY = Math.max(maxY, y + h);
    } else {
      layout.push({ i: p.id, x: 0, y: maxY, w: cols, h: 5, minW: 1, minH: 1 });
      maxY += 5;
    }
  }

  return layout;
}

function renderPanel(panel: PanelConfig): ReactNode {
  switch (panel.type) {
    case 'asset-BTC':
      return <LazyAssetMarketTable asset="BTC" panelId={panel.id} />;
    case 'asset-ETH':
      return <LazyAssetMarketTable asset="ETH" panelId={panel.id} />;
    case 'asset-SOL':
      return <LazyAssetMarketTable asset="SOL" panelId={panel.id} />;
    case 'asset-XRP':
      return <LazyAssetMarketTable asset="XRP" panelId={panel.id} />;
    case 'arbs':
      return <LazyHedgesTable />;
    case 'summary':
      return <LazySummaryTable />;
    case 'arb-positions':
      return <LazyArbPositionsTable />;
    case 'signals':
      return <LazySignalsTable />;
    case 'smart-money':
      return <LazySmartMoneyPanel />;
    case 'trades-positions-orders':
      return <LazyTradesPositionsOrders panelId={panel.id} />;
    case 'pnl':
      return <LazyPnLPanel />;
    case 'updown-overview':
      return <LazyUpDownMarketsPanel />;
    case 'relative-chart':
      return <LazyRelativeChartPanel />;
    case 'perp-bot':
      if (!LazyPerpBotPanel) {
        return (
          <div className="text-gray-500 p-4 text-xs">
            Perp Bot panel is only bundled in dev builds.
          </div>
        );
      }
      return <LazyPerpBotPanel />;
    case 'price-forecast':
      return <LazyPriceForecastPanel />;
    case 'binance-chart':
      return <LazyBinanceChartPanel panelId={panel.id} initialAsset="BTC" />;
    case 'spot-orderbook':
      return <LazySpotOrderbookPanel panelId={panel.id} />;
    case 'updown-hud':
      return <LazyUpOrDownHUDPanel panelId={panel.id} />;
    case 'chat':
      return <LazyChatPanel />;
    case 'wallet-history':
      return <LazyHistoryPanel />;
    default:
      return <div className="text-gray-500 p-4">Unknown panel: {panel.type}</div>;
  }
}

export function DraggableCanvas() {
  const panels = useAppStore((s) => s.panels);
  const layouts = useAppStore((s) => s.layouts);
  const setLayouts = useAppStore((s) => s.setLayouts);
  const setPanels = useAppStore((s) => s.setPanels);
  const removePanel = useAppStore((s) => s.removePanel);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [removedPanelTypes, setRemovedPanelTypes] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('polybot-removed-panels');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const currentLayoutRef = useRef<LayoutsMap | null>(null);
  // Measure actual container dimensions once on mount
  const [containerWidth, setContainerWidth] = useState(0);
  const [rowHeight, setRowHeight] = useState(0);
  const containerHeight = rowHeight * TOTAL_ROWS;

  /** Below `sm` (768px): drag/resize only after double-tap on panel header. */
  const [viewportNarrow, setViewportNarrow] = useState(() => window.innerWidth < 768);
  const [mobileLayoutArmed, setMobileLayoutArmed] = useState(false);
  const mobileDoubleTapRef = useRef<{ t: number; panelId: string }>({ t: 0, panelId: '' });
  const mobileArmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutInteractingRef = useRef(false);

  useEffect(() => {
    const onResize = () => {
      const n = window.innerWidth < 768;
      setViewportNarrow(n);
      if (!n) {
        setMobileLayoutArmed(false);
        mobileDoubleTapRef.current = { t: 0, panelId: '' };
        if (mobileArmTimeoutRef.current) {
          clearTimeout(mobileArmTimeoutRef.current);
          mobileArmTimeoutRef.current = null;
        }
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !viewportNarrow || containerWidth === 0) return;

    const cancelSel =
      '.no-drag,.no-drag *,input,select,textarea,button,label,option,.cursor-help,[data-no-drag="true"],[data-no-drag="true"] *';

    const onTouchEnd = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(cancelSel)) return;
      const header = target.closest('.panel-header');
      if (!header || !el.contains(header)) return;

      const wrap = (header as HTMLElement).closest('[data-panel-wrap-id]');
      const panelId = wrap?.getAttribute('data-panel-wrap-id') || '';

      const now = Date.now();
      const prev = mobileDoubleTapRef.current;
      if (panelId && prev.panelId === panelId && now - prev.t < 420) {
        mobileDoubleTapRef.current = { t: 0, panelId: '' };
        setMobileLayoutArmed(true);
        if (mobileArmTimeoutRef.current) clearTimeout(mobileArmTimeoutRef.current);
        mobileArmTimeoutRef.current = setTimeout(() => {
          setMobileLayoutArmed(false);
          mobileArmTimeoutRef.current = null;
        }, 15000);
        e.preventDefault();
      } else {
        mobileDoubleTapRef.current = { t: now, panelId };
      }
    };

    el.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    return () => el.removeEventListener('touchend', onTouchEnd, true);
  }, [viewportNarrow, containerWidth]);

  const layoutInteractEnabled = !viewportNarrow || mobileLayoutArmed;

  useEffect(() => {
    return () => {
      if (mobileArmTimeoutRef.current) clearTimeout(mobileArmTimeoutRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const availableH = window.innerHeight - rect.top;
      let w = rect.width;
      // Flex children can report 0 width until after layout; avoid never mounting the grid (black canvas).
      if (!(w > 0)) {
        w = Math.max(320, window.innerWidth - 312);
      }
      setContainerWidth(w);
      setRowHeight(Math.max(1, availableH / TOTAL_ROWS));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    let rafOuter = 0;
    let rafInner = 0;
    rafOuter = requestAnimationFrame(() => {
      rafInner = requestAnimationFrame(measure);
    });
    return () => {
      cancelAnimationFrame(rafOuter);
      cancelAnimationFrame(rafInner);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Close layout menu on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node)) {
        setShowLayoutMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentBreakpoint = useMemo(() => getBreakpoint(window.innerWidth, window.innerHeight), [containerWidth]);
  // Tall variants (e.g. '2xl-tall') share cols with their base breakpoint ('2xl')
  const baseBp = currentBreakpoint.replace(/-tall$/, '');
  const currentCols = COLS[baseBp] || 24;

  const PANEL_TITLES: Record<string, string> = {
    'asset-BTC': 'BTC', 'asset-ETH': 'ETH', 'asset-SOL': 'SOL', 'asset-XRP': 'XRP',
    'trades-positions-orders': 'Trades/Positions/Orders', 'updown-overview': 'Up/Down Markets',
    'relative-chart': 'Relative Chart',
    'perp-bot': 'Perp Bot',
    'price-forecast': 'Price Forecast',
    'binance-chart': 'Asset Candle Chart',
    'spot-orderbook': 'Spot Orderbook',
    'updown-hud': 'UpOrDown HUD',
    'signals': 'Signals', 'smart-money': 'Smart Money', 'chat': 'Chat', 'pnl': 'P&L',
    'arbs': 'Hedges', 'summary': 'Summary',
    'wallet-history': 'History',
  };

  // Auto-include panels defined in the current breakpoint layout but missing from panels list
  // (skip panels the user explicitly removed)
  const effectivePanels = useMemo((): PanelConfig[] => {
    const bpMap = BREAKPOINT_LAYOUTS[currentBreakpoint] || BREAKPOINT_LAYOUTS.lg;
    const existingTypes = new Set<string>(panels.map(p => p.type));
    const extra: PanelConfig[] = [];
    for (const type of Object.keys(bpMap)) {
      if (!existingTypes.has(type) && !removedPanelTypes.has(type)) {
        extra.push({ id: type, type: type as PanelType, title: PANEL_TITLES[type] || type });
      }
    }
    return extra.length > 0 ? [...panels, ...extra] : panels;
  }, [panels, currentBreakpoint, removedPanelTypes]);

  /** Layout from store or defaults. Default minW/minH only apply when building defaults; saved layouts are used as stored. */
  const computedLayout = useMemo((): LayoutItem[] => {
    const defaults = getDefaultLayout(effectivePanels, currentBreakpoint, containerWidth, rowHeight);
    if (layouts && layouts[currentBreakpoint]) {
      const saved = layouts[currentBreakpoint] as LayoutItem[];
      // Drop stored minW/minH (often from old defaults); RGL uses them as hard floors — keep only user w/h.
      const fromUser = saved.map((item) => ({ ...item, minW: 1, minH: 1 }));
      const savedIds = new Set(saved.map((l) => l.i));
      const missing = defaults.filter((d) => !savedIds.has(d.i));
      return missing.length > 0 ? [...fromUser, ...missing] : fromUser;
    }
    return defaults;
  }, [layouts, effectivePanels, currentBreakpoint, currentCols, containerWidth, rowHeight]);

  /**
   * RGL is controlled via `layout={gridLayout}`. The store is only written on drag/resize stop.
   * We must mirror every onLayoutChange into React state; otherwise any re-render reapplies the
   * stale store-driven layout and the panel snaps back to its previous size.
   */
  const [gridLayout, setGridLayout] = useState<LayoutItem[]>(computedLayout);
  useLayoutEffect(() => {
    setGridLayout(computedLayout);
  }, [computedLayout]);

  // Track the latest layout from react-grid-layout (fires during drag/resize)
  const handleLayoutChange = useCallback(
    (newLayout: LayoutItem[]) => {
      // Avoid feedback-loop jitter: RGL can emit passive compaction updates while idle.
      // We only mirror layout changes into controlled state during active drag/resize interactions.
      if (!layoutInteractingRef.current) return;
      currentLayoutRef.current = { [currentBreakpoint]: newLayout } as unknown as LayoutsMap;
      setGridLayout(newLayout);
    },
    [currentBreakpoint]
  );

  // Persist layout on actual user drag/resize — use the layout RGL passes to the callback
  const handleUserLayoutChange = useCallback(
    (layout: LayoutItem[]) => {
      const normalized = layout.map((l) => ({ ...l, minW: 1, minH: 1 }));
      const merged: LayoutsMap = { ...(layouts || {}), [currentBreakpoint]: normalized } as LayoutsMap;
      setLayouts(merged as PersistedGridLayouts);
    },
    [setLayouts, layouts, currentBreakpoint],
  );

  const disarmMobileAfterLayoutGesture = useCallback(() => {
    if (window.innerWidth >= 768) return;
    setMobileLayoutArmed(false);
    if (mobileArmTimeoutRef.current) {
      clearTimeout(mobileArmTimeoutRef.current);
      mobileArmTimeoutRef.current = null;
    }
  }, []);

  const handleMobileDragStart = useCallback(() => {
    layoutInteractingRef.current = true;
    if (window.innerWidth >= 768) return;
    if (mobileArmTimeoutRef.current) {
      clearTimeout(mobileArmTimeoutRef.current);
      mobileArmTimeoutRef.current = null;
    }
  }, []);

  const handleResizeStart = useCallback(() => {
    layoutInteractingRef.current = true;
  }, []);

  const handleDragStopWrapped = useCallback(
    (layout: LayoutItem[]) => {
      layoutInteractingRef.current = false;
      disarmMobileAfterLayoutGesture();
      handleUserLayoutChange(layout);
    },
    [disarmMobileAfterLayoutGesture, handleUserLayoutChange],
  );

  const handleResizeStopWrapped = useCallback(
    (layout: LayoutItem[]) => {
      layoutInteractingRef.current = false;
      // Resize stays available without double-tap; do not disarm mobile drag mode here.
      handleUserLayoutChange(layout);
    },
    [handleUserLayoutChange],
  );

  const handleRemovePanel = useCallback(
    (id: string) => {
      // Find the panel type before removing
      const panel = effectivePanels.find(p => p.id === id);
      if (panel) {
        const next = new Set(removedPanelTypes);
        next.add(panel.type);
        setRemovedPanelTypes(next);
        localStorage.setItem('polybot-removed-panels', JSON.stringify([...next]));
      }
      removePanel(id);
      // Also remove from layouts
      if (layouts) {
        const newLayouts: LayoutsMap = {};
        for (const [bp, lay] of Object.entries(layouts)) {
          newLayouts[bp] = (lay as LayoutItem[]).filter((l) => l.i !== id);
        }
        setLayouts(newLayouts as PersistedGridLayouts);
      }
    },
    [removePanel, layouts, setLayouts, effectivePanels, removedPanelTypes]
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Dev Header */}
      {import.meta.env.VITE_FE_ENV === 'dev' && (
        <div className="flex-shrink-0 flex items-center gap-3 bg-gray-900 border-b border-gray-700 px-3 py-1">
          <span className="text-[10px] font-mono text-gray-400">
            Canvas W: {containerWidth} | Canvas H: {containerHeight} | Row: {rowHeight}px | Viewport: {window.innerWidth}×{window.innerHeight}
          </span>
          <span className="text-[10px] font-mono text-gray-500">
            store={layouts ? 'saved' : 'defaults'}
          </span>
          <div className="relative ml-auto" ref={layoutMenuRef}>
            <button
              onClick={() => setShowLayoutMenu(!showLayoutMenu)}
              className="bg-purple-700 hover:bg-purple-600 text-white rounded px-2 text-[10px] font-medium transition border border-purple-500 h-5"
            >
              Layout
            </button>
            {showLayoutMenu && (
              <div className="absolute right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px] z-50">
                {Object.keys(BREAKPOINT_LAYOUTS).filter(bp => !bp.includes('-tall')).map((bp) => (
                  <button
                    key={bp}
                    onClick={() => {
                      const bpMap = BREAKPOINT_LAYOUTS[bp];
                      const newPanels: PanelConfig[] = Object.keys(bpMap).map(type => ({
                        id: type, type: type as PanelType, title: PANEL_TITLES[type] || type,
                      }));
                      localStorage.removeItem('polybot-removed-panels');
                      setRemovedPanelTypes(new Set());
                      setPanels(newPanels);
                      setLayouts(null);
                      setShowLayoutMenu(false);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:bg-gray-700 transition"
                  >
                    {bp}
                  </button>
                ))}
                <div className="border-t border-gray-700 my-1" />
                <button
                  onClick={() => {
                    const defaultPanels: PanelConfig[] = [
                      { id: 'asset-BTC', type: 'asset-BTC', title: 'BTC' },
                      { id: 'trades-positions-orders', type: 'trades-positions-orders', title: 'Trades/Positions/Orders' },
                      { id: 'updown-overview', type: 'updown-overview', title: 'Up/Down Markets' },
                      { id: 'signals', type: 'signals', title: 'Signals' },
                      { id: 'chat', type: 'chat', title: 'Chat' },
                    ];
                    localStorage.removeItem('polybot-react-panels');
                    localStorage.removeItem('polybot-react-layouts');
                    localStorage.removeItem('polybot-removed-panels');
                    setRemovedPanelTypes(new Set());
                    setPanels(defaultPanels);
                    setLayouts(null);
                    setShowLayoutMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-gray-700 transition"
                >
                  Reset to Defaults
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-auto relative min-w-0">
      {(containerWidth <= 0 || rowHeight <= 0) ? (
        <div className="flex h-[min(240px,40vh)] items-center justify-center text-gray-500 text-xs">Loading layout…</div>
      ) : (
      <GridLayout
        className="layout"
        width={containerWidth}
        layout={gridLayout}
        cols={currentCols}
        rowHeight={rowHeight}
        onLayoutChange={handleLayoutChange}
        onDragStart={handleMobileDragStart}
        onResizeStart={handleResizeStart}
        onDragStop={handleDragStopWrapped}
        onResizeStop={handleResizeStopWrapped}
        isDraggable={layoutInteractEnabled}
        isResizable={true}
        draggableHandle=".panel-header"
        draggableCancel=".no-drag,.no-drag *,input,select,textarea,button,label,option,.cursor-help,[data-no-drag='true'],[data-no-drag='true'] *"
        compactType="vertical"
        margin={[0, 0]}
        containerPadding={[0, 0]}
        useCSSTransforms={true}
      >
        {effectivePanels.map((panel) => (
          <div key={panel.id} data-panel-wrap-id={panel.id} className="relative overflow-hidden h-full p-[2px]">
            {/* Remove button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirmingRemove === panel.id) {
                  handleRemovePanel(panel.id);
                  setConfirmingRemove(null);
                } else {
                  setConfirmingRemove(panel.id);
                }
              }}
              onBlur={() => setTimeout(() => setConfirmingRemove(null), 200)}
              className={`absolute top-0.5 right-0.5 z-10 rounded flex items-center justify-center transition ${
                confirmingRemove === panel.id
                  ? 'bg-red-600 text-white opacity-100 px-1.5 h-5'
                  : 'bg-gray-800/80 hover:bg-red-600 text-gray-500 hover:text-white w-4 h-4 opacity-0 hover:opacity-100 group-hover:opacity-100'
              }`}
              style={{ fontSize: '10px' }}
              title={confirmingRemove === panel.id ? 'Click again to confirm' : 'Remove panel'}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {confirmingRemove === panel.id ? (
                <span className="text-[9px] font-bold">Remove?</span>
              ) : (
                <X className="w-3 h-3" />
              )}
            </button>
            <Suspense fallback={null}>{renderPanel(panel)}</Suspense>
          </div>
        ))}
      </GridLayout>
      )}
      </div>
    </div>
  );
}
