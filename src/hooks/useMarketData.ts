import { useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { fetchMarkets, buildMarketLookup } from '../api';
import { recordOfMarketArraysEqual, upOrDownMarketsEqual } from '../lib/marketDataDedupe';
import { isWebMode } from '../lib/env';
import type { Market } from '../types';

const WS_FIELDS: (keyof Market)[] = [
  'bestBid', 'bestAsk', 'volume', 'sharesInExistence', 'marketNetDirection',
  'holders', 'smartMoneyBias', 'provenSMS', 'crowdBias', 'liveBias',
  'liveBiasWindowMin', 'concentration', 'winnerBias', 'winnerBiasYesWR', 'winnerBiasNoWR',
  'winBiasShares', 'winBiasSharesYes', 'winBiasSharesNo',
  'winnerBiasConviction', 'winnerBiasConvictionYesWR', 'winnerBiasConvictionNoWR',
  'winBiasConvictionShares', 'winBiasConvictionSharesYes', 'winBiasConvictionSharesNo',
  'stakedUsdYesLeg', 'stakedUsdNoLeg',
  'stakedSumAbsSignedNetUsd',
  'stakedTopHoldersCohortYesUsd', 'stakedTopHoldersCohortNoUsd',
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
  const refreshingRef = useRef(false);

  const refreshData = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const data = await fetchMarkets();
      const store = useAppStore.getState();
      const prevLookup = store.marketLookup;
      const aboveMarkets = data.aboveMarkets || {};
      const priceOnMarkets = data.priceOnMarkets || {};
      const weeklyHitMarkets = data.weeklyHitMarkets || {};
      const upOrDownMarkets = data.upOrDownMarkets || {};
      const marketArraysChanged =
        !recordOfMarketArraysEqual(aboveMarkets, store.aboveMarkets) ||
        !recordOfMarketArraysEqual(priceOnMarkets, store.priceOnMarkets) ||
        !recordOfMarketArraysEqual(weeklyHitMarkets, store.weeklyHitMarkets) ||
        !upOrDownMarketsEqual(upOrDownMarkets, store.upOrDownMarkets);
      const lookup = marketArraysChanged
        ? mergeWsFields(
            buildMarketLookup(aboveMarkets, priceOnMarkets, weeklyHitMarkets, upOrDownMarkets),
            prevLookup,
          )
        : prevLookup;

      if (isWebMode) {
        // Web mode: only market/smart-order data from backend; wallet data comes from useWalletData
        useAppStore.getState().setMarketData({
          aboveMarkets,
          priceOnMarkets,
          weeklyHitMarkets,
          upOrDownMarkets,
          tokenInfo: data.tokenInfo || {},
          progOrderMap: data.progOrderMap || {},
          marketCount: data.count || 0,
          lastUpdated: data.lastUpdated || '',
          ...(marketArraysChanged ? { marketLookup: lookup } : {}),
        });
      } else {
        // App/desktop mode: all data from backend cache
        useAppStore.getState().setMarketData({
          aboveMarkets,
          priceOnMarkets,
          weeklyHitMarkets,
          upOrDownMarkets,
          positions: data.positions || [],
          orders: data.orders || [],
          trades: data.trades || [],
          cashBalance: data.cashBalance || 0,
          makerAddress: data.makerAddress || '',
          tokenInfo: data.tokenInfo || {},
          progOrderMap: data.progOrderMap || {},
          marketCount: data.count || 0,
          lastUpdated: data.lastUpdated || '',
          ...(marketArraysChanged ? { marketLookup: lookup } : {}),
        });
      }
      useAppStore.getState().setBackendConnected(true);
      useAppStore.getState().setLoading(false);
    } catch (err) {
      console.error('Failed to fetch markets:', err);
      useAppStore.getState().setBackendConnected(false);
      useAppStore.getState().setLoading(false);
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
