import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { ReactGridLayout as RGLGrid } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import { X } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { AssetMarketTable } from './panels/AssetMarketTable';
import { HedgesTable } from './panels/ArbsTable';
import { SummaryTable } from './panels/SummaryTable';
import { ArbPositionsTable } from './panels/ArbPositionsTable';
import { SignalsTable } from './panels/SignalsTable';
import { TradesPositionsOrders } from './panels/TradesPositionsOrders';
import { PnLPanel } from './panels/PnLPanel';
import { UpDownMarketsPanel } from './panels/UpDownMarketsPanel';
import { ChatPanel } from './panels/ChatPanel';
import type { PanelConfig, PanelType } from '../types';
import BREAKPOINT_LAYOUTS, { HEIGHT_VARIANTS } from '../lib/defaultLayouts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// Column counts per breakpoint (must match the cols prop on ResponsiveGridLayout)
const COLS: Record<string, number> = { '2xl': 36, xl: 28, lg: 24, md: 20, sm: 12, xs: 8, xxs: 4 };
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
const MARGIN = 4;

function getDefaultLayout(panels: PanelConfig[], breakpoint: string): LayoutItem[] {
  const bpMap = BREAKPOINT_LAYOUTS[breakpoint] || BREAKPOINT_LAYOUTS.lg;
  const base = breakpoint.replace(/-tall$/, '');
  const cols = COLS[base] || 24;
  const layout: LayoutItem[] = [];
  let maxY = 0;

  for (const p of panels) {
    const pct = bpMap[p.type];
    if (pct) {
      const w = Math.max(1, Math.round(cols * pct.w / 100));
      const x = Math.round(cols * pct.x / 100);
      const h = Math.max(1, Math.round(pct.h));
      const y = Math.round(pct.y);
      layout.push({ i: p.id, x, y, w, h, minW: 2, minH: 1 });
      maxY = Math.max(maxY, y + h);
    } else {
      layout.push({ i: p.id, x: 0, y: maxY, w: cols, h: 5, minW: 2, minH: 1 });
      maxY += 5;
    }
  }

  return layout;
}

function getDefaultLayouts(panels: PanelConfig[]): LayoutsMap {
  const result: LayoutsMap = {};
  for (const bp of Object.keys(BREAKPOINT_LAYOUTS)) {
    result[bp] = getDefaultLayout(panels, bp);
  }
  return result;
}

function renderPanel(panel: PanelConfig): React.ReactNode {
  switch (panel.type) {
    case 'asset-BTC':
      return <AssetMarketTable asset="BTC" panelId={panel.id} />;
    case 'asset-ETH':
      return <AssetMarketTable asset="ETH" panelId={panel.id} />;
    case 'asset-SOL':
      return <AssetMarketTable asset="SOL" panelId={panel.id} />;
    case 'asset-XRP':
      return <AssetMarketTable asset="XRP" panelId={panel.id} />;
    case 'arbs':
      return <HedgesTable />;
    case 'summary':
      return <SummaryTable />;
    case 'arb-positions':
      return <ArbPositionsTable />;
    case 'signals':
      return <SignalsTable />;
    case 'trades-positions-orders':
      return <TradesPositionsOrders panelId={panel.id} />;
    case 'pnl':
      return <PnLPanel />;
    case 'updown-overview':
      return <UpDownMarketsPanel />;
    case 'chat':
      return <ChatPanel />;
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
  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const availableH = window.innerHeight - rect.top;
      setContainerWidth(rect.width);
      setRowHeight(availableH / TOTAL_ROWS);
    }
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
    'signals': 'Signals', 'chat': 'Chat', 'pnl': 'P&L',
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

  const currentLayout = useMemo((): LayoutItem[] => {
    const defaults = getDefaultLayout(effectivePanels, currentBreakpoint);
    console.log('[layout-debug] bp:', currentBreakpoint, 'cols:', currentCols, 'width:', containerWidth, 'rowH:', rowHeight);
    console.log('[layout-debug] layout:', defaults.map((l: LayoutItem) =>
      `${l.i.replace('trades-positions-orders','tpo')} x=${l.x} y=${l.y} w=${l.w} h=${l.h}`));
    // If saved layouts exist for this breakpoint, use them (with defaults for any missing panels)
    if (layouts && layouts[currentBreakpoint]) {
      const saved = layouts[currentBreakpoint] as LayoutItem[];
      const savedIds = new Set(saved.map(l => l.i));
      const missing = defaults.filter(d => !savedIds.has(d.i));
      return missing.length > 0 ? [...saved, ...missing] : saved;
    }
    return defaults;
  }, [layouts, effectivePanels, currentBreakpoint, currentCols, containerWidth, rowHeight]);

  // Track the latest layout from react-grid-layout (fires on every render)
  const handleLayoutChange = useCallback(
    (newLayout: LayoutItem[]) => {
      console.log('[rgl-output]', newLayout.map((l: LayoutItem) =>
        `${l.i.replace('trades-positions-orders','tpo')} x=${l.x} y=${l.y} w=${l.w} h=${l.h}`));
      currentLayoutRef.current = { [currentBreakpoint]: newLayout } as unknown as LayoutsMap;
    },
    [currentBreakpoint]
  );

  // Persist layout on actual user drag/resize — use the layout RGL passes to the callback
  const handleUserLayoutChange = useCallback((
    _layout: LayoutItem[], _oldItem: LayoutItem, _newItem: LayoutItem,
    _placeholder: LayoutItem, _e: MouseEvent, _element: HTMLElement
  ) => {
    const merged: LayoutsMap = { ...(layouts || {}), [currentBreakpoint]: _layout } as LayoutsMap;
    setLayouts(merged as any);
  }, [setLayouts, layouts, currentBreakpoint]);

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
        setLayouts(newLayouts as any);
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
                      setLayouts(null as any);
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
                    setLayouts(null as any);
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
      <div ref={containerRef} className="flex-1 min-h-0 overflow-auto relative">
      {(containerWidth === 0 || rowHeight === 0) ? null : <GridLayout
        className="layout"
        width={containerWidth}
        layout={currentLayout}
        cols={currentCols}
        rowHeight={rowHeight}
        onLayoutChange={handleLayoutChange}
        onDragStop={handleUserLayoutChange}
        onResizeStop={handleUserLayoutChange}
        isDraggable={true}
        draggableHandle=".panel-header"
        draggableCancel=".no-drag,input,select,textarea,button,label,option,.cursor-help,[data-no-drag='true']"
        compactType="vertical"
        margin={[0, 0]}
        containerPadding={[0, 0]}
        useCSSTransforms={true}
      >
        {effectivePanels.map((panel) => (
          <div key={panel.id} className="relative overflow-hidden h-full p-[2px]">
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
            {renderPanel(panel)}
          </div>
        ))}
      </GridLayout>}
      </div>
    </div>
  );
}
