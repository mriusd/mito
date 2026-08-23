import { memo, useEffect, useMemo, useRef } from 'react';
import { useOnchainTradesWS, type OnchainTradesWSOpts } from '../hooks/useOnchainTradesWS';
import {
  registerSidebarOnchainRefreshFns,
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

const BRIDGE_MS = 50;

/** Null host — onchain WS → external store. Coalesce bridge (was 141ms passive storms). */
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({
    walletPositions,
    gridWalletPositions,
    walletTrades,
    walletHistory,
    walletPnlDaily,
    walletMarketTrades,
    walletMarketTradesScopeKey,
  });
  latestRef.current = {
    walletPositions,
    gridWalletPositions,
    walletTrades,
    walletHistory,
    walletPnlDaily,
    walletMarketTrades,
    walletMarketTradesScopeKey,
  };

  // Passive effects only — never notify the external store from useLayoutEffect / render.
  // Synchronous notify() was updating SidebarChartsRowChart mid-commit of this host.
  useEffect(() => {
    resetSidebarOnchainWalletMarketTradesScope(walletMarketTradesScopeKey);
  }, [walletMarketTradesScopeKey]);

  useEffect(() => {
    resetSidebarOnchainWalletSession();
  }, [walletKey]);

  useEffect(() => {
    const flush = () => {
      timerRef.current = null;
      const s = latestRef.current;
      setSidebarOnchainWalletPositions(s.walletPositions);
      setSidebarOnchainGridWalletPositions(s.gridWalletPositions);
      setSidebarOnchainWalletTrades(s.walletTrades);
      setSidebarOnchainWalletHistory(s.walletHistory);
      setSidebarOnchainWalletPnlDaily(s.walletPnlDaily);
      setSidebarOnchainWalletMarketTrades(s.walletMarketTrades, s.walletMarketTradesScopeKey);
    };
    // Always (re)arm — previous cleanup only clears; do not sync-flush on dep change
    // (that notified chart subscribers while React was still committing this host).
    timerRef.current = setTimeout(flush, BRIDGE_MS);
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
    walletPositions,
    gridWalletPositions,
    walletTrades,
    walletHistory,
    walletPnlDaily,
    walletMarketTrades,
    walletMarketTradesScopeKey,
  ]);

  useEffect(() => {
    registerSidebarOnchainRefreshFns({
      refreshWallet,
      refreshMarketTrades: refreshWalletMarketTrades,
      subscribeWalletPnl,
    });
  }, [refreshWallet, refreshWalletMarketTrades, subscribeWalletPnl]);

  useEffect(() => () => resetSidebarOnchainTradesStore(), []);

  return null;
});
