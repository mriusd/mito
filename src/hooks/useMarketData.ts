import { useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { fetchMarkets, buildMarketLookup } from '../api';
import {
  coalesceRecordOfMarketArrays,
  coalesceUpOrDownMarkets,
} from '../lib/marketDataDedupe';
import { fetchBackend, markBackendRecovered } from '../lib/fetchBackend';
import { notifyBackendReconnect } from '../lib/backendReconnect';
import type { Market } from '../types';
import { resolveUpDownStrikeSync } from '../utils/format';

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
  /** Consecutive probe successes while down — require 2 before declaring recovery (backend may serve /api/markets before WS/DB endpoints are warm). */
  const recoverySuccessesRef = useRef(0);

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
      const weatherMarkets = coalesceRecordOfMarketArrays(store.weatherMarkets, data.weatherMarkets || {});
      const marketArraysChanged =
        aboveMarkets !== store.aboveMarkets ||
        priceOnMarkets !== store.priceOnMarkets ||
        weeklyHitMarkets !== store.weeklyHitMarkets ||
        upOrDownMarkets !== store.upOrDownMarkets ||
        weatherMarkets !== store.weatherMarkets;
      const lookup = marketArraysChanged
        ? mergeWsFields(
            buildMarketLookup(aboveMarkets, priceOnMarkets, weeklyHitMarkets, upOrDownMarkets, weatherMarkets, prevLookup),
            prevLookup,
          )
        : prevLookup;

      const marketPatch = marketArraysChanged
        ? { aboveMarkets, priceOnMarkets, weeklyHitMarkets, upOrDownMarkets, weatherMarkets, marketLookup: lookup }
        : {};

      const patchPayload = {
        ...marketPatch,
        tokenInfo: data.tokenInfo || {},
        progOrderMap: data.progOrderMap || {},
        marketCount: data.count || 0,
        lastUpdated: data.lastUpdated || '',
      };
      useAppStore.getState().setMarketData(patchPayload);

      const sel = store.selectedMarket;
      if (sel?.id && marketArraysChanged) {
        const strike = resolveUpDownStrikeSync(sel, lookup, upOrDownMarkets);
        if (strike != null && sel.priceToBeat !== strike) {
          useAppStore.getState().setSelectedMarket({ ...sel, priceToBeat: strike });
        }
      }
      const wasDown = useAppStore.getState().backendConnected === false;
      if (wasDown) {
        recoverySuccessesRef.current += 1;
        if (recoverySuccessesRef.current < 2) return;
      }
      recoverySuccessesRef.current = 0;
      markBackendRecovered();
      useAppStore.getState().setBackendConnected(true);
      useAppStore.getState().setLoading(false);
      if (wasDown) notifyBackendReconnect();
    } catch (err) {
      console.error('Failed to fetch markets:', err);
      recoverySuccessesRef.current = 0;
      useAppStore.getState().setBackendConnected(false);
      useAppStore.getState().setLoading(false);
    } finally {
      refreshingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backendConnected = useAppStore((s) => s.backendConnected);
  useEffect(() => {
    const ms = backendConnected === false ? 3000 : 30000;
    refreshData();
    const interval = setInterval(refreshData, ms);
    return () => clearInterval(interval);
  }, [backendConnected, refreshData]);

  return { refreshData };
}
