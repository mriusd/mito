import { useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { fetchMarkets, buildMarketLookup } from '../api';
import { isWebMode } from '../lib/env';
import type { Market } from '../types';

const WS_FIELDS: (keyof Market)[] = [
  'bestBid', 'bestAsk', 'volume', 'sharesInExistence', 'marketNetDirection',
  'holders', 'smartMoneyBias', 'provenSMS', 'crowdBias', 'liveBias',
  'liveBiasWindowMin', 'concentration', 'winnerBias', 'winnerBiasYesWR', 'winnerBiasNoWR',
  'winBiasShares', 'winBiasSharesYes', 'winBiasSharesNo',
];

function mergeWsFields(fresh: Record<string, Market>, prev: Record<string, Market>): Record<string, Market> {
  for (const tokenId of Object.keys(fresh)) {
    const old = prev[tokenId];
    if (!old) continue;
    const entry = fresh[tokenId];
    for (const key of WS_FIELDS) {
      if (entry[key] == null && old[key] != null) {
        (entry as any)[key] = old[key];
      }
    }
  }
  return fresh;
}

export function useMarketData() {
  const store = useAppStore();
  const refreshingRef = useRef(false);

  const refreshData = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const data = await fetchMarkets();
      const prevLookup = useAppStore.getState().marketLookup;
      const lookup = mergeWsFields(
        buildMarketLookup(data.aboveMarkets || {}, data.priceOnMarkets || {}, data.weeklyHitMarkets || {}, data.upOrDownMarkets || {}),
        prevLookup,
      );

      if (isWebMode) {
        // Web mode: only market/smart-order data from backend; wallet data comes from useWalletData
        store.setMarketData({
          aboveMarkets: data.aboveMarkets || {},
          priceOnMarkets: data.priceOnMarkets || {},
          weeklyHitMarkets: data.weeklyHitMarkets || {},
          upOrDownMarkets: data.upOrDownMarkets || {},
          tokenInfo: data.tokenInfo || {},
          progOrderMap: data.progOrderMap || {},
          marketCount: data.count || 0,
          lastUpdated: data.lastUpdated || '',
          marketLookup: lookup,
        });
      } else {
        // App/desktop mode: all data from backend cache
        store.setMarketData({
          aboveMarkets: data.aboveMarkets || {},
          priceOnMarkets: data.priceOnMarkets || {},
          weeklyHitMarkets: data.weeklyHitMarkets || {},
          upOrDownMarkets: data.upOrDownMarkets || {},
          positions: data.positions || [],
          orders: data.orders || [],
          trades: data.trades || [],
          cashBalance: data.cashBalance || 0,
          makerAddress: data.makerAddress || '',
          tokenInfo: data.tokenInfo || {},
          progOrderMap: data.progOrderMap || {},
          marketCount: data.count || 0,
          lastUpdated: data.lastUpdated || '',
          marketLookup: lookup,
        });
      }
      store.setLoading(false);
    } catch (err) {
      console.error('Failed to fetch markets:', err);
      store.setLoading(false);
    } finally {
      refreshingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load data on mount
  useEffect(() => {
    refreshData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(refreshData, 30000);
    return () => clearInterval(interval);
  }, [refreshData]);

  return { refreshData };
}
