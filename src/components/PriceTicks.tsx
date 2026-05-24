import { useEffect, useState, useCallback, memo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../stores/appStore';
import { useThrottledStorePrice } from '../hooks/useThrottledStorePrice';
import type { AssetSymbol } from '../types';

interface TickMark {
  y: number;
  color: string;
  width: number;
  height: number;
  zIndex: number;
}

interface PriceTicksProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Subscribes to spot + manual slots internally — parent grid avoids price/slot re-renders. */
  symbol: AssetSymbol;
}

export const PriceTicks = memo(function PriceTicks({ containerRef, symbol }: PriceTicksProps) {
  const livePrice = useThrottledStorePrice(symbol, 1000);
  const slot0 = useAppStore((s) => s.manualPriceSlots[symbol]?.[0] ?? null);
  const slot1 = useAppStore((s) => s.manualPriceSlots[symbol]?.[1] ?? null);
  const [ticks, setTicks] = useState<TickMark[]>([]);
  const [priceRight, setPriceRight] = useState(0);
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      setPortalRoot(null);
      return;
    }
    let overlay = container.querySelector<HTMLDivElement>(':scope > .price-ticks-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'price-ticks-overlay';
      overlay.style.cssText =
        'position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:5';
      container.appendChild(overlay);
    }
    setPortalRoot(overlay);
    return () => {
      overlay?.remove();
      setPortalRoot(null);
    };
  }, [containerRef, symbol]);

  const computeTicks = useCallback(() => {
    const container = containerRef.current;
    if (!container || livePrice <= 0) {
      setTicks([]);
      setPriceRight(0);
      return;
    }

    const cells = Array.from(container.querySelectorAll<HTMLElement>('.price-col-cell'));
    if (cells.length === 0) {
      setTicks([]);
      setPriceRight(0);
      return;
    }

    const containerRect = container.getBoundingClientRect();

    const rows = cells.map((c) => ({
      low: parseFloat(c.dataset.priceLow || '0') || 0,
      high: parseFloat(c.dataset.priceHigh || '0') || 0,
      rect: c.getBoundingClientRect(),
    }));

    const rowVal = (r: (typeof rows)[0]) => r.low;

    let isAsc = false;
    for (let i = 0; i < rows.length - 1; i++) {
      const diff = rowVal(rows[i + 1]) - rowVal(rows[i]);
      if (Math.abs(diff) > 0.0001) {
        isAsc = diff > 0;
        break;
      }
    }

    const pts = rows.map((r) => {
      const y = isAsc ? r.rect.top - containerRect.top : r.rect.bottom - containerRect.top;
      return { val: rowVal(r), midY: y };
    });

    const nextPriceRight = rows.length > 0 ? rows[0].rect.right - containerRect.left : 0;

    function priceToY(price: number): number | null {
      if (pts.length === 0) return null;
      const vals = pts.map((p) => p.val);
      const minV = Math.min(...vals);
      const maxV = Math.max(...vals);
      const clamped = Math.max(minV, Math.min(maxV, price));
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const lo = Math.min(a.val, b.val);
        const hi = Math.max(a.val, b.val);
        if (clamped >= lo && clamped <= hi) {
          const frac = hi - lo > 0.0001 ? (clamped - a.val) / (b.val - a.val) : 0;
          return a.midY + frac * (b.midY - a.midY);
        }
      }
      return pts[0].midY;
    }

    const newTicks: TickMark[] = [];

    const addTick = (price: number, color: string, width: number, height: number, zIndex = 9999) => {
      const y = priceToY(price);
      if (y === null) return;
      newTicks.push({ y, color, width, height, zIndex });
    };

    addTick(livePrice, '#ef4444', 14, 3, 10001);

    if (slot1) {
      if (slot1.low > 0 && slot1.high > 0 && slot1.low !== slot1.high) {
        addTick(slot1.low, '#f472b6', 14, 3, 9999);
        addTick(slot1.high, '#f472b6', 14, 3, 9999);
      } else if (slot1.low > 0) {
        addTick(slot1.low, '#f472b6', 14, 3, 9999);
      }
    }

    if (slot0) {
      if (slot0.low > 0 && slot0.high > 0 && slot0.low !== slot0.high) {
        addTick(slot0.low, '#22d3ee', 8, 2, 10000);
        addTick(slot0.high, '#22d3ee', 8, 2, 10000);
      } else if (slot0.low > 0) {
        addTick(slot0.low, '#22d3ee', 8, 2, 10000);
      }
    }

    setTicks(newTicks);
    setPriceRight(nextPriceRight);
  }, [containerRef, livePrice, slot0, slot1]);

  useEffect(() => {
    computeTicks();

    const container = containerRef.current;
    const scrollParent = container?.closest('.overflow-x-auto') || container?.parentElement;

    const handler = () => computeTicks();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    scrollParent?.addEventListener('scroll', handler);

    let ro: ResizeObserver | null = null;
    if (container) {
      ro = new ResizeObserver(handler);
      ro.observe(container);
    }

    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
      scrollParent?.removeEventListener('scroll', handler);
      ro?.disconnect();
    };
  }, [computeTicks, containerRef]);

  if (!portalRoot || ticks.length === 0 || priceRight === 0) return null;

  return createPortal(
    <>
      {ticks.map((t, i) => (
        <div
          key={i}
          className="price-tick"
          style={{
            position: 'absolute',
            left: priceRight - t.width,
            top: t.y,
            transform: 'translateY(-50%)',
            width: t.width,
            height: t.height,
            background: t.color,
            zIndex: t.zIndex,
            pointerEvents: 'none',
            borderRadius: '1px 0 0 1px',
          }}
        />
      ))}
    </>,
    portalRoot,
  );
});
