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

type PriceDataMap = ReturnType<typeof useAppStore.getState>['priceData'];

function priceDataMapsEqual(a: PriceDataMap, b: PriceDataMap): boolean {
  if (a === b) return true;
  for (const k of Object.keys(b) as AssetSymbol[]) {
    if ((a[k]?.price ?? 0) !== (b[k]?.price ?? 0)) return false;
  }
  return true;
}

/** Full Binance spot map, re-render at most every `ms` (Markov / multi-asset grids). */
export function useThrottledPriceDataMap(ms = 1000): PriceDataMap {
  const [prices, setPrices] = useState(() => useAppStore.getState().priceData);

  useEffect(() => {
    let latest = useAppStore.getState().priceData;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      setPrices((prev) => (priceDataMapsEqual(prev, latest) ? prev : latest));
    };

    const schedule = () => {
      if (timer != null) return;
      timer = setTimeout(flush, ms);
    };

    schedule();
    const unsub = useAppStore.subscribe((state) => {
      if (state.priceData === latest) return;
      latest = state.priceData;
      schedule();
    });

    return () => {
      unsub();
      if (timer != null) clearTimeout(timer);
    };
  }, [ms]);

  return prices;
}
