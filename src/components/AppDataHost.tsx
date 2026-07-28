import { memo, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
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

/**
 * Owns polling / WS / wallet hooks so App shell does not re-render with them.
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

  const signingMode = useAppStore((s) => s.signingMode);
  const pkRevision = useAppStore((s) => s.pkRevision);
  const { address: walletAddress } = useAccount();
  const prevSigningRef = useRef<typeof signingMode | null>(null);
  const prevWalletChannelRef = useRef('');

  useEffect(() => {
    if (prevSigningRef.current === null) {
      prevSigningRef.current = signingMode;
      return;
    }
    if (prevSigningRef.current === signingMode) return;
    prevSigningRef.current = signingMode;
    invalidateClobMemoryCreds();
    void handleRefresh();
  }, [signingMode, handleRefresh]);

  useEffect(() => {
    const pk = useAppStore.getState().pkAddress;
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
    void handleRefresh();
  }, [signingMode, walletAddress, pkRevision, handleRefresh]);

  return null;
});
