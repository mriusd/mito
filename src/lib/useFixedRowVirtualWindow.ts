import { useEffect, useMemo, useState, type RefObject } from 'react';

export function useFixedRowVirtualWindow(
  count: number,
  rowHeight: number,
  scrollRef: RefObject<HTMLDivElement | null>,
  overscan = 8,
) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(el);
    onScroll();
    setViewportHeight(el.clientHeight);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, [scrollRef, count]);

  return useMemo(() => {
    if (count === 0 || viewportHeight <= 0) {
      return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
    }
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(count, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
    return {
      start,
      end,
      paddingTop: start * rowHeight,
      paddingBottom: (count - end) * rowHeight,
    };
  }, [count, rowHeight, scrollTop, viewportHeight, overscan]);
}
