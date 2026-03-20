import { useEffect, useState, useCallback } from 'react';

interface TickMark {
  y: number;
  color: string;
  width: number;
  height: number;
  zIndex: number;
}

interface PriceTicksProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  livePrice: number;
  slot0: { low: number; high: number } | null;
  slot1: { low: number; high: number } | null;
}

export function PriceTicks({ containerRef, livePrice, slot0, slot1 }: PriceTicksProps) {
  const [ticks, setTicks] = useState<TickMark[]>([]);

  const computeTicks = useCallback(() => {
    const container = containerRef.current;
    if (!container || livePrice <= 0) { setTicks([]); return; }

    const cells = Array.from(container.querySelectorAll<HTMLElement>('.price-col-cell'));
    if (cells.length === 0) { setTicks([]); return; }

    const containerRect = container.getBoundingClientRect();

    const rows = cells.map((c) => ({
      low: parseFloat(c.dataset.priceLow || '0') || 0,
      high: parseFloat(c.dataset.priceHigh || '0') || 0,
      rect: c.getBoundingClientRect(),
    }));

    const rowVal = (r: typeof rows[0]) => r.low;

    // Detect sort order
    let isAsc = false;
    for (let i = 0; i < rows.length - 1; i++) {
      const diff = rowVal(rows[i + 1]) - rowVal(rows[i]);
      if (Math.abs(diff) > 0.0001) { isAsc = diff > 0; break; }
    }

    // Map each row to value + Y position (relative to container)
    const pts = rows.map((r) => {
      const y = isAsc ? r.rect.top - containerRect.top : r.rect.bottom - containerRect.top;
      return { val: rowVal(r), midY: y };
    });

    // Right edge of price column relative to container
    const priceRight = rows.length > 0 ? rows[0].rect.right - containerRect.left : 0;

    function priceToY(price: number): number | null {
      if (pts.length === 0) return null;
      const vals = pts.map((p) => p.val);
      const minV = Math.min(...vals), maxV = Math.max(...vals);
      const clamped = Math.max(minV, Math.min(maxV, price));
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const lo = Math.min(a.val, b.val), hi = Math.max(a.val, b.val);
        if (clamped >= lo && clamped <= hi) {
          const frac = (hi - lo) > 0.0001 ? (clamped - a.val) / (b.val - a.val) : 0;
          return a.midY + frac * (b.midY - a.midY);
        }
      }
      return pts[0].midY;
    }

    const newTicks: TickMark[] = [];

    const addTick = (price: number, color: string, width: number, height: number, zIndex: number = 9999) => {
      const y = priceToY(price);
      if (y === null) return;
      newTicks.push({ y, color, width, height, zIndex });
    };

    // Red tick for live price
    addTick(livePrice, '#ef4444', 14, 3, 10001);

    // Pink ticks for slot 1 (range 2) — drawn first, longer, lower z
    if (slot1) {
      if (slot1.low > 0 && slot1.high > 0 && slot1.low !== slot1.high) {
        addTick(slot1.low, '#f472b6', 14, 3, 9999);
        addTick(slot1.high, '#f472b6', 14, 3, 9999);
      } else if (slot1.low > 0) {
        addTick(slot1.low, '#f472b6', 14, 3, 9999);
      }
    }

    // Cyan ticks for slot 0 (range 1) — drawn second, smaller, higher z
    if (slot0) {
      if (slot0.low > 0 && slot0.high > 0 && slot0.low !== slot0.high) {
        addTick(slot0.low, '#22d3ee', 8, 2, 10000);
        addTick(slot0.high, '#22d3ee', 8, 2, 10000);
      } else if (slot0.low > 0) {
        addTick(slot0.low, '#22d3ee', 8, 2, 10000);
      }
    }

    setTicks(newTicks);
    setPriceRight(priceRight);
  }, [containerRef, livePrice, slot0, slot1]);

  const [priceRight, setPriceRight] = useState(0);

  useEffect(() => {
    computeTicks();

    // Recompute on scroll and resize
    const container = containerRef.current;
    const scrollParent = container?.closest('.overflow-x-auto') || container?.parentElement;

    const handler = () => computeTicks();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    if (scrollParent) {
      scrollParent.addEventListener('scroll', handler);
    }

    // ResizeObserver on container
    let ro: ResizeObserver | null = null;
    if (container) {
      ro = new ResizeObserver(handler);
      ro.observe(container);
    }

    // Also recompute periodically (price data updates)
    const interval = setInterval(handler, 2000);

    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
      if (scrollParent) scrollParent.removeEventListener('scroll', handler);
      if (ro) ro.disconnect();
      clearInterval(interval);
    };
  }, [computeTicks, containerRef]);

  if (ticks.length === 0 || priceRight === 0) return null;

  return (
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
    </>
  );
}
