import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import type { AssetSymbol } from '../types';

/** Subscribe to spot price but re-render at most every `ms` — grid panels were 4 Hz × 4 assets. */
export function useThrottledStorePrice(symbol: AssetSymbol, ms = 1000): number {
  const [price, setPrice] = useState(
    () => useAppStore.getState().priceData[symbol]?.price || 0,
  );

  useEffect(() => {
    let latest = useAppStore.getState().priceData[symbol]?.price || 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      setPrice((prev) => (prev === latest ? prev : latest));
    };

    const schedule = () => {
      if (timer != null) return;
      timer = setTimeout(flush, ms);
    };

    schedule();
    const unsub = useAppStore.subscribe((state) => {
      const p = state.priceData[symbol]?.price || 0;
      if (p === latest) return;
      latest = p;
      schedule();
    });

    return () => {
      unsub();
      if (timer != null) clearTimeout(timer);
    };
  }, [symbol, ms]);

  return price;
}
