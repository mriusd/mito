import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { ResponsiveGridLayout as RGLResponsive } from 'react-grid-layout';
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
import type { PanelConfig } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ResponsiveGridLayout = RGLResponsive as any;

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

function getDefaultLayout(panels: PanelConfig[]): LayoutItem[] {
  const layout: LayoutItem[] = [];
  const assetPanels = panels.filter((p) => p.type.startsWith('asset-'));
  const otherPanels = panels.filter((p) => !p.type.startsWith('asset-'));

  assetPanels.forEach((p, i) => {
    layout.push({
      i: p.id,
      x: (i % 2) * 12,
      y: Math.floor(i / 2) * 5,
      w: 12,
      h: 5,
      minW: 6,
      minH: 3,
    });
  });

  const bottomY = assetPanels.length > 0 ? Math.ceil(assetPanels.length / 2) * 5 : 0;
  const bottomWidths = [6, 6, 6, 6, 6];
  let bottomX = 0;
  otherPanels.forEach((p, i) => {
    const w = i < bottomWidths.length ? bottomWidths[i] : 6;
    if (bottomX + w > 24) {
      bottomX = 0;
    }
    layout.push({
      i: p.id,
      x: bottomX,
      y: bottomY + Math.floor(i / 4) * 5,
      w: w,
      h: 5,
      minW: 4,
      minH: 3,
    });
    bottomX += w;
  });

  return layout;
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
    default:
      return <div className="text-gray-500 p-4">Unknown panel: {panel.type}</div>;
  }
}

export function DraggableCanvas() {
  const panels = useAppStore((s) => s.panels);
  const layouts = useAppStore((s) => s.layouts);
  const setLayouts = useAppStore((s) => s.setLayouts);
  const removePanel = useAppStore((s) => s.removePanel);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);

  const [containerWidth, setContainerWidth] = useState(1200);
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  // Measure container width with ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Mark mounted after first render to skip initial onLayoutChange
  useEffect(() => {
    const t = setTimeout(() => { mountedRef.current = true; }, 500);
    return () => clearTimeout(t);
  }, []);

  const allLayouts = useMemo((): LayoutsMap => {
    const def = getDefaultLayout(panels);
    if (layouts) {
      // Ensure lg exists
      return { lg: def, ...layouts } as LayoutsMap;
    }
    return { lg: def };
  }, [layouts, panels]);

  const handleLayoutChange = useCallback(
    (_layout: LayoutItem[], reportedLayouts: LayoutsMap) => {
      if (!mountedRef.current) return; // skip initial auto-fire
      // Merge reported layouts with existing saved layouts to avoid losing breakpoints
      const merged: LayoutsMap = { ...(layouts || {}), ...reportedLayouts } as LayoutsMap;
      setLayouts(merged as any);
    },
    [setLayouts, layouts]
  );

  const handleRemovePanel = useCallback(
    (id: string) => {
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
    [removePanel, layouts, setLayouts]
  );

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-auto relative">
      <ResponsiveGridLayout
        className="layout"
        width={containerWidth}
        layouts={allLayouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 24, md: 20, sm: 12, xs: 8, xxs: 4 }}
        rowHeight={60}
        onLayoutChange={handleLayoutChange}
        dragConfig={{ enabled: true, handle: '.panel-header', cancel: '.no-drag', threshold: 0 }}
        compactType="vertical"
        margin={[4, 4]}
        containerPadding={[0, 0]}
        useCSSTransforms={false}
      >
        {panels.map((panel) => (
          <div key={panel.id} className="relative">
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
      </ResponsiveGridLayout>
    </div>
  );
}
