import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import type { AssetSymbol } from '../types';

/** Subscribe to VWAP but re-render at most every `ms`. */
export function useThrottledStoreVwap(symbol: AssetSymbol, ms = 1000): number {
  const [price, setPrice] = useState(
    () => useAppStore.getState().vwapData[symbol]?.price || 0,
  );

  useEffect(() => {
    let latest = useAppStore.getState().vwapData[symbol]?.price || 0;
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
      const p = state.vwapData[symbol]?.price || 0;
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
