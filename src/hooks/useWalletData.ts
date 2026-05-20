import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import { useAppStore } from '../stores/appStore';
import { fetchProxyWallet, fetchWalletPositions, fetchWalletActivity, fetchWalletBalance } from '../api/polymarket';
import { fetchOpenOrdersDirect, setWalletRefreshFn, setOrdersRefreshFn, hasCredsForWallet, ensureCredsForWallet, refreshOpenOrdersInStore } from '../lib/clobClient';
import { usePolymarketUserOrdersWS } from './usePolymarketUserOrdersWS';
import { resolvePolymarketMakerAddress } from '../lib/polymarketTradingMaker';
import { showSignatureExplainer } from '../components/SignatureExplainerDialog';
import { isWebMode } from '../lib/env';
import { getStoredPrivateKey } from '../components/PrivateKeyImportDialog';

// Web mode only: Gamma → trading maker address; WalletConnect signer + RPC infer Safe vs deposit (POLY_1271) at order time.
// then fetch positions, orders, trades, balance from Polymarket directly.
// In app mode this hook is a no-op.
export function useWalletData() {
  const { address, isConnected } = useAccount();
  const signingMode = useAppStore((s) => s.signingMode);
  const selectedMarketId = useAppStore((s) => s.selectedMarket?.id ?? '');
  const setPkAddress = useAppStore((s) => s.setPkAddress);
  /** Bumped only on real channel change (layout) — stale in-flight loads must not write after PK↔wallet switch. */
  const walletLoadEpochRef = useRef(0);
  const walletChannelKeyRef = useRef<string>('');
  const [proxyWallet, setProxyWallet] = useState<string | null>(null);
  const credsCheckedRef = useRef(false);

  // Derive EOA from private key when PK mode is active
  const pkEoa = useMemo(() => {
    if (signingMode !== 'privateKey') return null;
    const pk = getStoredPrivateKey();
    if (!pk) return null;
    try {
      return new ethers.Wallet(pk).address.toLowerCase();
    } catch { return null; }
  }, [signingMode]);

  // Publish pkAddress to store so other components can read it
  useEffect(() => { setPkAddress(pkEoa); }, [pkEoa, setPkAddress]);

  // The effective EOA: PK address when in PK mode, otherwise wagmi address
  const effectiveEoa = signingMode === 'privateKey' && pkEoa ? pkEoa : address;
  const effectiveConnected = signingMode === 'privateKey' && pkEoa ? true : isConnected;

  const loadWalletData = useCallback(
    async (makerLocked: string) => {
      if (!isWebMode || !makerLocked.trim()) return;
      const epochAtStart = walletLoadEpochRef.current;
      try {
        const [positions, trades, orders, balance] = await Promise.all([
          fetchWalletPositions(makerLocked),
          fetchWalletActivity(makerLocked, 100),
          fetchOpenOrdersDirect(makerLocked),
          fetchWalletBalance(makerLocked),
        ]);

        if (epochAtStart !== walletLoadEpochRef.current) return;

        // Fix missing avgPrice: compute from trades when API returns 0
        for (const pos of positions) {
          if (pos.avgPrice && pos.avgPrice > 0) continue;
          const tokenId = pos.asset || '';
          if (!tokenId) continue;
          let totalCost = 0;
          let totalSize = 0;
          for (const t of trades) {
            const tAsset = t.asset || t.asset_id || t.token_id || '';
            if (tAsset !== tokenId) continue;
            if (t.side !== 'BUY') continue;
            const p = parseFloat(t.price) || 0;
            const s = parseFloat(t.size) || 0;
            if (p > 0 && s > 0) {
              totalCost += p * s;
              totalSize += s;
            }
          }
          if (totalSize > 0) {
            pos.avgPrice = totalCost / totalSize;
          }
        }

        if (epochAtStart !== walletLoadEpochRef.current) return;

        useAppStore.getState().setMarketData({
          positions,
          orders,
          trades,
          cashBalance: balance,
          makerAddress: makerLocked,
        });
      } catch (err) {
        console.warn('[useWalletData] Failed to fetch wallet data:', err);
      }
    },
    [isWebMode],
  );

  /** Clear maker before paint so cred checks never see (new EOA + old proxy) — fixes spurious wallet sign on PK↔wallet when addresses differ. */
  useLayoutEffect(() => {
    if (!isWebMode) return;
    if (!effectiveConnected || !effectiveEoa) {
      walletChannelKeyRef.current = '';
      walletLoadEpochRef.current += 1;
      setProxyWallet(null);
      return;
    }
    const key = `${signingMode}|${String(effectiveEoa).trim().toLowerCase()}`;
    if (walletChannelKeyRef.current !== key) {
      walletChannelKeyRef.current = key;
      walletLoadEpochRef.current += 1;
    }
    setProxyWallet(null);
  }, [isWebMode, effectiveConnected, effectiveEoa, signingMode]);

  // Resolve proxy wallet when EOA connects or signing channel toggles — always drop stale maker first (no wrong-user fetch).
  useEffect(() => {
    if (!isWebMode || !effectiveConnected || !effectiveEoa) {
      setProxyWallet(null);
      credsCheckedRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const eoaLc = typeof effectiveEoa === 'string' ? effectiveEoa.trim().toLowerCase() : '';
        const pw = await fetchProxyWallet(eoaLc);
        if (cancelled) return;
        const maker = resolvePolymarketMakerAddress(eoaLc, pw);
        console.log(`[useWalletData] EOA ${eoaLc} → trading maker ${maker}`);
        setProxyWallet(maker);
        void loadWalletData(maker);
      } catch (e) {
        if (!cancelled) {
          console.error('[useWalletData] resolve trading maker failed:', e);
          setProxyWallet(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveConnected, effectiveEoa, signingMode, loadWalletData]);

  /** Clear wallet-derived slice on PK ↔ Wallet transition only (same as wiping stale rows before reload). */
  const prevSigningForClearRef = useRef<'wallet' | 'privateKey' | null>(null);
  useEffect(() => {
    if (!isWebMode) return;
    if (prevSigningForClearRef.current === null) {
      prevSigningForClearRef.current = signingMode;
      return;
    }
    if (prevSigningForClearRef.current === signingMode) return;
    prevSigningForClearRef.current = signingMode;
    useAppStore.getState().setMarketData({
      positions: [],
      orders: [],
      trades: [],
      cashBalance: 0,
      makerAddress: '',
    });
  }, [signingMode]);

  const fetchAll = useCallback(() => {
    if (!proxyWallet) return;
    void loadWalletData(proxyWallet);
  }, [proxyWallet, loadWalletData]);

  /** Re-run L2 cred gate when signer EOA changes — avoid stale API keys from another wallet. */
  useEffect(() => {
    credsCheckedRef.current = false;
  }, [signingMode, effectiveEoa, proxyWallet]);

  // Auto-derive API creds if not available
  useEffect(() => {
    if (!isWebMode || !effectiveEoa || !proxyWallet || credsCheckedRef.current) return;
    const eoaNorm = typeof effectiveEoa === 'string' ? effectiveEoa.trim().toLowerCase() : '';
    if (!eoaNorm) return;
    credsCheckedRef.current = true;
    if (!hasCredsForWallet(proxyWallet, eoaNorm)) {
      if (signingMode === 'privateKey' && pkEoa) {
        // PK mode: sign silently in the background, no dialog needed
        console.log('[useWalletData] PK mode — deriving API creds silently...');
        ensureCredsForWallet(proxyWallet).then(() => {
          console.log('[useWalletData] API creds derived successfully (PK)');
          fetchAll();
        }).catch(() => { credsCheckedRef.current = false; });
      } else {
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
    }
  }, [effectiveEoa, proxyWallet, fetchAll, signingMode, pkEoa]);

  const fetchOrdersOnly = useCallback(() => {
    if (!proxyWallet) return;
    void refreshOpenOrdersInStore(proxyWallet);
  }, [proxyWallet]);

  usePolymarketUserOrdersWS(effectiveConnected ? effectiveEoa : null, proxyWallet);

  // Register global refresh callback so order/cancel can trigger immediate refresh
  useEffect(() => {
    if (isWebMode && proxyWallet) {
      setWalletRefreshFn(fetchAll);
      setOrdersRefreshFn(fetchOrdersOnly);
    }
    return () => {
      setWalletRefreshFn(() => {});
      setOrdersRefreshFn(() => {});
    };
  }, [proxyWallet, fetchAll, fetchOrdersOnly]);

  // Poll every 90s as WS backstop
  useEffect(() => {
    if (!isWebMode || !proxyWallet) return;
    const interval = setInterval(fetchAll, 90000);
    return () => clearInterval(interval);
  }, [proxyWallet, fetchAll]);

  // Refetch when user focuses a market (Data API can lag; sidebar filters need fresh rows)
  useEffect(() => {
    if (!isWebMode || !proxyWallet || !selectedMarketId) return;
    const t = window.setTimeout(() => {
      void fetchAll();
    }, 400);
    return () => clearTimeout(t);
  }, [selectedMarketId, proxyWallet, fetchAll]);

  return { refreshWalletData: fetchAll };
}
