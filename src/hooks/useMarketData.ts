import { useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { fetchMarkets, buildMarketLookup } from '../api';
import {
  coalesceRecordOfMarketArrays,
  coalesceUpOrDownMarkets,
} from '../lib/marketDataDedupe';
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
  'stakedNetYesUsd', 'stakedNetNoUsd',
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
      const aboveMarkets = coalesceRecordOfMarketArrays(store.aboveMarkets, data.aboveMarkets || {});
      const priceOnMarkets = coalesceRecordOfMarketArrays(store.priceOnMarkets, data.priceOnMarkets || {});
      const weeklyHitMarkets = coalesceRecordOfMarketArrays(store.weeklyHitMarkets, data.weeklyHitMarkets || {});
      const upOrDownMarkets = coalesceUpOrDownMarkets(store.upOrDownMarkets, data.upOrDownMarkets || {});
      const marketArraysChanged =
        aboveMarkets !== store.aboveMarkets ||
        priceOnMarkets !== store.priceOnMarkets ||
        weeklyHitMarkets !== store.weeklyHitMarkets ||
        upOrDownMarkets !== store.upOrDownMarkets;
      const lookup = marketArraysChanged
        ? mergeWsFields(
            buildMarketLookup(aboveMarkets, priceOnMarkets, weeklyHitMarkets, upOrDownMarkets, prevLookup),
            prevLookup,
          )
        : prevLookup;

      const marketPatch = marketArraysChanged
        ? { aboveMarkets, priceOnMarkets, weeklyHitMarkets, upOrDownMarkets, marketLookup: lookup }
        : {};

      if (isWebMode) {
        useAppStore.getState().setMarketData({
          ...marketPatch,
          tokenInfo: data.tokenInfo || {},
          progOrderMap: data.progOrderMap || {},
          marketCount: data.count || 0,
          lastUpdated: data.lastUpdated || '',
        });
      } else {
        useAppStore.getState().setMarketData({
          ...marketPatch,
          tokenInfo: data.tokenInfo || {},
          progOrderMap: data.progOrderMap || {},
          marketCount: data.count || 0,
          lastUpdated: data.lastUpdated || '',
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
