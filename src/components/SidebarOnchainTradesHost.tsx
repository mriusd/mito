import { memo, useEffect, useLayoutEffect, useMemo } from 'react';
import { useOnchainTradesWS, type OnchainTradesWSOpts } from '../hooks/useOnchainTradesWS';
import {
  registerSidebarOnchainRefreshFns,
  refreshSidebarOnchainWallet,
  resetSidebarOnchainTradesStore,
  resetSidebarOnchainWalletMarketTradesScope,
  resetSidebarOnchainWalletSession,
  setSidebarOnchainGridWalletPositions,
  setSidebarOnchainWalletHistory,
  setSidebarOnchainWalletMarketTrades,
  setSidebarOnchainWalletPnlDaily,
  setSidebarOnchainWalletPositions,
  setSidebarOnchainWalletTrades,
} from '../lib/sidebarOnchainTradesStore';

/** Null host — onchain WS writes external store (Sidebar body stays off hot path). */
export const SidebarOnchainTradesHost = memo(function SidebarOnchainTradesHost(opts: OnchainTradesWSOpts) {
  const {
    walletPositions,
    gridWalletPositions,
    walletTrades,
    walletHistory,
    walletPnlDaily,
    walletMarketTrades,
    refreshWallet,
    refreshWalletMarketTrades,
    subscribeWalletPnl,
  } = useOnchainTradesWS(opts);

  const walletMarketTradesScopeKey = useMemo(
    () =>
      `${(opts.wallet || '').trim().toLowerCase()}|${(opts.marketId || '').trim()}|${(opts.scopedClobTokenIds || []).join('|')}`,
    [opts.wallet, opts.marketId, opts.scopedClobTokenIds?.join('|') ?? ''],
  );

  const walletKey = (opts.wallet || '').trim().toLowerCase();

  useLayoutEffect(() => {
    resetSidebarOnchainWalletMarketTradesScope(walletMarketTradesScopeKey);
  }, [walletMarketTradesScopeKey]);

  useLayoutEffect(() => {
    resetSidebarOnchainWalletSession();
  }, [walletKey]);

  useEffect(() => {
    setSidebarOnchainWalletPositions(walletPositions);
  }, [walletPositions]);

  useEffect(() => {
    setSidebarOnchainGridWalletPositions(gridWalletPositions);
  }, [gridWalletPositions]);

  useEffect(() => {
    setSidebarOnchainWalletTrades(walletTrades);
  }, [walletTrades]);

  useEffect(() => {
    setSidebarOnchainWalletHistory(walletHistory);
  }, [walletHistory]);

  useEffect(() => {
    setSidebarOnchainWalletPnlDaily(walletPnlDaily);
  }, [walletPnlDaily]);

  useEffect(() => {
    const scopedIds = new Set(
      (opts.scopedClobTokenIds || []).map((x) => String(x || '').trim()).filter(Boolean),
    );
    const norm = (tid: string) => {
      try {
        return BigInt(tid).toString();
      } catch {
        return tid;
      }
    };
    const rows =
      scopedIds.size === 0
        ? []
        : walletTrades.filter((t) => {
            const k = norm(String(t.tokenId || '').trim());
            for (const id of scopedIds) {
              if (norm(id) === k) return true;
            }
            return false;
          });
    setSidebarOnchainWalletMarketTrades(rows, walletMarketTradesScopeKey);
  }, [walletTrades, walletMarketTradesScopeKey, opts.scopedClobTokenIds?.join('|') ?? '']);

  useEffect(() => {
    registerSidebarOnchainRefreshFns({
      refreshWallet,
      refreshMarketTrades: refreshWalletMarketTrades,
      subscribeWalletPnl,
    });
  }, [refreshWallet, refreshWalletMarketTrades, subscribeWalletPnl]);

  useEffect(() => {
    if (!walletKey) return;
    refreshSidebarOnchainWallet();
  }, [walletKey]);

  useEffect(() => {
    return () => {
      registerSidebarOnchainRefreshFns({ refreshWallet: null, refreshMarketTrades: null, subscribeWalletPnl: null });
      resetSidebarOnchainTradesStore();
    };
  }, []);

  return null;
});
