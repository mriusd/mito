import { memo, useCallback, useEffect, useRef } from 'react';
import { getAccount, watchAccount } from '@wagmi/core';
import { useBinanceWS } from '../hooks/useBinanceWS';
import { useRwaSpotPrices } from '../hooks/useRwaSpotPrices';
import { useMarketData } from '../hooks/useMarketData';
import { useWalletData } from '../hooks/useWalletData';
import { useVwapAndVolatility } from '../hooks/useVwapAndVolatility';
import { useBidAskWS } from '../hooks/useBidAskWS';
import { setMarketDataRefreshFn } from '../lib/marketDataRefresh';
import { setAppRefreshFn } from '../lib/appRefresh';
import { useAppStore } from '../stores/appStore';
import { invalidateClobMemoryCreds } from '../lib/clobClient';
import { clearWalletAccountSlice } from '../lib/clearWalletAccountSlice';
import { wagmiAdapter } from '../lib/wallet';

const wagmiConfig = wagmiAdapter.wagmiConfig;

/**
 * Owns polling / WS / wallet hooks. No useAccount / live store selects —
 * those re-rendered this host on every tick and showed up as the storm root.
 */
export const AppDataHost = memo(function AppDataHost() {
  useBinanceWS();
  useRwaSpotPrices();
  useVwapAndVolatility();
  useBidAskWS();
  const { refreshData } = useMarketData();
  const { refreshWalletData } = useWalletData();

  const handleRefresh = useCallback(async () => {
    await Promise.all([refreshData(), refreshWalletData()]);
  }, [refreshData, refreshWalletData]);

  useEffect(() => {
    setMarketDataRefreshFn(refreshData);
    setAppRefreshFn(handleRefresh);
    return () => {
      setMarketDataRefreshFn(null);
      setAppRefreshFn(null);
    };
  }, [refreshData, handleRefresh]);

  const handleRefreshRef = useRef(handleRefresh);
  handleRefreshRef.current = handleRefresh;
  const prevSigningRef = useRef<string | null>(null);
  const prevWalletChannelRef = useRef('');

  useEffect(() => {
    const runChannelCheck = () => {
      const st = useAppStore.getState();
      const signingMode = st.signingMode;
      const pkRevision = st.pkRevision;
      const pk = st.pkAddress;
      const walletAddress = getAccount(wagmiConfig).address;

      if (prevSigningRef.current === null) {
        prevSigningRef.current = signingMode;
      } else if (prevSigningRef.current !== signingMode) {
        prevSigningRef.current = signingMode;
        invalidateClobMemoryCreds();
        void handleRefreshRef.current();
      }

      const eoa =
        signingMode === 'privateKey' && pk
          ? pk.trim().toLowerCase()
          : (walletAddress || '').trim().toLowerCase();
      const channel = eoa
        ? `${signingMode}|${eoa}|${signingMode === 'privateKey' ? pkRevision : 0}`
        : '';
      if (channel === prevWalletChannelRef.current) return;
      prevWalletChannelRef.current = channel;
      if (!channel) return;
      clearWalletAccountSlice();
      invalidateClobMemoryCreds();
      void handleRefreshRef.current();
    };

    runChannelCheck();
    const unsubStore = useAppStore.subscribe((state, prev) => {
      if (
        state.signingMode === prev.signingMode &&
        state.pkRevision === prev.pkRevision &&
        state.pkAddress === prev.pkAddress
      ) {
        return;
      }
      runChannelCheck();
    });
    const unsubAccount = watchAccount(wagmiConfig, {
      onChange() {
        runChannelCheck();
      },
    });
    return () => {
      unsubStore();
      unsubAccount();
    };
  }, []);

  return null;
});
