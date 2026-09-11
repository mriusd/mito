import { memo, useEffect, useRef } from 'react';
import type { AssetSymbol } from '../../types';
import { useGridAssetLivePrice } from '../../lib/gridAssetLivePriceStore';
import { parsePriceBounds } from './AssetMarketTablePriceCol';

function isPriceConditionTrue(priceStr: string, live: number): boolean {
  if (live <= 0) return false;
  const cleaned = priceStr.replace(/\$/g, '').replace(/,/g, '');
  if (cleaned.startsWith('>')) {
    const val = parseFloat(cleaned.substring(1));
    return !isNaN(val) && live > val;
  }
  if (cleaned.startsWith('<')) {
    const val = parseFloat(cleaned.substring(1));
    return !isNaN(val) && live < val;
  }
  if (cleaned.includes('-')) {
    const parts = cleaned.split('-');
    const lo = parseFloat(parts[0]);
    const hi = parseFloat(parts[1]);
    return !isNaN(lo) && !isNaN(hi) && live >= lo && live <= hi;
  }
  const threshold = parseFloat(cleaned);
  return !isNaN(threshold) && live >= threshold;
}

function scrollRowToCenter(container: HTMLElement, row: HTMLElement): void {
  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const scrollOffset =
    rowRect.top - containerRect.top + container.scrollTop - containerRect.height / 2 + rowRect.height / 2;
  container.scrollTop = Math.max(0, scrollOffset);
}

function findScrollContainer(from: HTMLElement): HTMLElement | null {
  let container = from.parentElement as HTMLElement | null;
  while (container && container.scrollHeight <= container.clientHeight) {
    container = container.parentElement;
  }
  return container;
}

type Props = {
  containerRef: React.RefObject<HTMLElement | null>;
  symbol: AssetSymbol;
  tableType: string;
  prices: string[];
  hitPrice?: (t: string) => number;
};

/**
 * One-shot scroll-to-live-strike on first quote.
 * Never re-centers after the user scrolls — that fought wheel/trackpad and felt "frozen".
 */
export const AssetMarketTableScrollSync = memo(function AssetMarketTableScrollSync({
  containerRef,
  symbol,
  tableType,
  prices,
  hitPrice,
}: Props) {
  const livePrice = useGridAssetLivePrice(symbol);
  const didAutoScrollRef = useRef(false);
  const userScrolledRef = useRef(false);
  const pricesLenRef = useRef(prices.length);

  // Reset only when the table identity changes — not on every live tick / prices[] identity churn.
  useEffect(() => {
    didAutoScrollRef.current = false;
    userScrolledRef.current = false;
    pricesLenRef.current = prices.length;
  }, [symbol, tableType]);

  // If strike list grows/shrinks a lot (catalog reload), allow one more auto-scroll — unless user already scrolled.
  useEffect(() => {
    if (userScrolledRef.current) return;
    if (Math.abs(prices.length - pricesLenRef.current) < 3) return;
    pricesLenRef.current = prices.length;
    didAutoScrollRef.current = false;
  }, [prices.length]);

  // Any user scroll/wheel on the panel cancels future auto-centering.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const onUserScroll = () => {
      userScrolledRef.current = true;
      didAutoScrollRef.current = true;
    };
    root.addEventListener('wheel', onUserScroll, { passive: true, capture: true });
    root.addEventListener('touchmove', onUserScroll, { passive: true, capture: true });
    root.addEventListener('scroll', onUserScroll, { passive: true, capture: true });
    return () => {
      root.removeEventListener('wheel', onUserScroll, true);
      root.removeEventListener('touchmove', onUserScroll, true);
      root.removeEventListener('scroll', onUserScroll, true);
    };
  }, [containerRef, symbol, tableType]);

  useEffect(() => {
    if (didAutoScrollRef.current || userScrolledRef.current) return;
    if (livePrice <= 0 || prices.length === 0) return;
    const container = containerRef.current;
    if (!container) return;

    let targetIdx = -1;
    if (tableType === 'above') {
      for (let i = 0; i < prices.length; i++) {
        if (isPriceConditionTrue(prices[i]!, livePrice)) targetIdx = i;
      }
    } else if (tableType === 'hit' && hitPrice) {
      for (let i = 0; i < prices.length; i++) {
        if (prices[i]!.includes('↓')) targetIdx = i;
      }
      if (targetIdx === -1) {
        let minDist = Infinity;
        for (let i = 0; i < prices.length; i++) {
          const dist = Math.abs(hitPrice(prices[i]!) - livePrice);
          if (dist < minDist) {
            minDist = dist;
            targetIdx = i;
          }
        }
      }
    } else if (tableType === 'price') {
      let minDist = Infinity;
      for (let i = 0; i < prices.length; i++) {
        const b = parsePriceBounds(prices[i]!);
        const mid = b.high === Infinity ? b.low : (b.low + b.high) / 2;
        const dist = Math.abs(mid - livePrice);
        if (dist < minDist) {
          minDist = dist;
          targetIdx = i;
        }
      }
    }

    if (targetIdx < 0) return;
    const priceStr = prices[targetIdx]!;
    const cells = Array.from(container.querySelectorAll<HTMLElement>('.price-col-cell'));
    const cell = cells.find((c) => {
      const low = parseFloat(c.dataset.priceLow || '0');
      if (tableType === 'hit' && hitPrice) return Math.abs(low - hitPrice(priceStr)) < 1e-6;
      const bounds = parsePriceBounds(priceStr);
      return Math.abs(low - bounds.low) < 1e-6;
    });
    const row = cell?.closest('tr');
    if (!row) return;
    const scrollContainer = findScrollContainer(row as HTMLElement);
    if (!scrollContainer) return;

    const t = window.setTimeout(() => {
      if (userScrolledRef.current) return;
      scrollRowToCenter(scrollContainer, row as HTMLElement);
      didAutoScrollRef.current = true;
    }, 100);
    return () => window.clearTimeout(t);
    // Intentionally omit `prices` array identity — only length / livePrice / type matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePrice, tableType, prices.length, hitPrice, containerRef, symbol]);

  return null;
});
