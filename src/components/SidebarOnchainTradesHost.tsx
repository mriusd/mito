import { memo, useEffect } from 'react';
import { useOnchainTradesWS, type OnchainTradesWSOpts } from '../hooks/useOnchainTradesWS';
import {
  registerSidebarOnchainRefreshFns,
  resetSidebarOnchainTradesStore,
  setSidebarOnchainGridWalletPositions,
  setSidebarOnchainLiveTrades,
  setSidebarOnchainWalletMarketTrades,
  setSidebarOnchainWalletPositions,
} from '../lib/sidebarOnchainTradesStore';

/** Null host — onchain WS writes external store (Sidebar body stays off hot path). */
export const SidebarOnchainTradesHost = memo(function SidebarOnchainTradesHost(opts: OnchainTradesWSOpts) {
  const {
    trades,
    walletPositions,
    gridWalletPositions,
    walletMarketTrades,
    refreshWallet,
    refreshWalletMarketTrades,
  } = useOnchainTradesWS(opts);

  useEffect(() => {
    setSidebarOnchainLiveTrades(trades);
  }, [trades]);

  useEffect(() => {
    setSidebarOnchainWalletPositions(walletPositions);
  }, [walletPositions]);

  useEffect(() => {
    setSidebarOnchainGridWalletPositions(gridWalletPositions);
  }, [gridWalletPositions]);

  useEffect(() => {
    setSidebarOnchainWalletMarketTrades(walletMarketTrades);
  }, [walletMarketTrades]);

  useEffect(() => {
    registerSidebarOnchainRefreshFns({
      refreshWallet,
      refreshMarketTrades: refreshWalletMarketTrades,
    });
    return () => {
      registerSidebarOnchainRefreshFns({ refreshWallet: null, refreshMarketTrades: null });
      resetSidebarOnchainTradesStore();
    };
  }, [refreshWallet, refreshWalletMarketTrades]);

  return null;
});
