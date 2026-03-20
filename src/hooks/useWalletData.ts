import { useEffect, useRef, useCallback, useState } from 'react';
import { useAccount } from 'wagmi';
import { useAppStore } from '../stores/appStore';
import { fetchProxyWallet, fetchWalletPositions, fetchWalletActivity, fetchWalletBalance } from '../api/polymarket';
import { fetchOpenOrdersDirect, setWalletRefreshFn, hasCredsForWallet, ensureCredsForWallet } from '../lib/clobClient';
import { showSignatureExplainer } from '../components/SignatureExplainerDialog';
import { isWebMode } from '../lib/env';

// Web mode only: resolve the Polymarket Safe proxy wallet for the connected EOA,
// then fetch positions, orders, trades, balance from Polymarket directly.
// In app mode this hook is a no-op.
export function useWalletData() {
  const { address, isConnected } = useAccount();
  const store = useAppStore();
  const fetchingRef = useRef(false);
  const [proxyWallet, setProxyWallet] = useState<string | null>(null);
  const credsCheckedRef = useRef(false);

  // Resolve proxy wallet when EOA connects
  useEffect(() => {
    if (!isWebMode || !isConnected || !address) {
      setProxyWallet(null);
      credsCheckedRef.current = false;
      return;
    }
    (async () => {
      const pw = await fetchProxyWallet(address);
      console.log(`[useWalletData] EOA ${address} → proxy wallet ${pw}`);
      setProxyWallet(pw);
    })();
  }, [isConnected, address]);

  const fetchAll = useCallback(async () => {
    if (!isWebMode || !proxyWallet || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const [positions, trades, orders, balance] = await Promise.all([
        fetchWalletPositions(proxyWallet),
        fetchWalletActivity(proxyWallet, 100),
        fetchOpenOrdersDirect(proxyWallet),
        fetchWalletBalance(proxyWallet),
      ]);
      store.setMarketData({
        positions,
        orders,
        trades,
        cashBalance: balance,
        makerAddress: proxyWallet,
      });
    } catch (err) {
      console.warn('[useWalletData] Failed to fetch wallet data:', err);
    } finally {
      fetchingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxyWallet]);

  // Auto-derive API creds if not available (triggers wallet signature once per session)
  useEffect(() => {
    if (!isWebMode || !proxyWallet || credsCheckedRef.current) return;
    credsCheckedRef.current = true;
    if (!hasCredsForWallet(proxyWallet)) {
      console.log('[useWalletData] No cached API creds for wallet, asking user...');
      showSignatureExplainer(
        'Wallet Signature Required',
        'Your wallet will request a signature to derive your Polymarket API credentials. These credentials are used for reading your open orders, positions, and trades, and for cancelling orders.\n\nPlacing new orders requires a separate signature each time. No withdrawals or transfers are possible with these keys.',
        () => ensureCredsForWallet(proxyWallet),
      ).then((success) => {
        if (success) {
          console.log('[useWalletData] API creds derived successfully');
          fetchAll();
        } else {
          credsCheckedRef.current = false;
        }
      });
    }
  }, [proxyWallet, fetchAll]);

  // Fetch once proxy wallet is resolved
  useEffect(() => {
    if (!isWebMode || !proxyWallet) return;
    fetchAll();
  }, [proxyWallet, fetchAll]);

  // Register global refresh callback so order/cancel can trigger immediate refresh
  useEffect(() => {
    if (isWebMode && proxyWallet) setWalletRefreshFn(fetchAll);
  }, [proxyWallet, fetchAll]);

  // Poll every 30s while connected
  useEffect(() => {
    if (!isWebMode || !proxyWallet) return;
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [proxyWallet, fetchAll]);

  return { refreshWalletData: fetchAll };
}
