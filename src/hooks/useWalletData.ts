import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import { useAppStore } from '../stores/appStore';
import { fetchProxyWallet, fetchWalletPositions, fetchWalletActivity, fetchWalletBalance } from '../api/polymarket';
import { fetchOpenOrdersDirect, setWalletRefreshFn, hasCredsForWallet, ensureCredsForWallet } from '../lib/clobClient';
import { showSignatureExplainer } from '../components/SignatureExplainerDialog';
import { isWebMode } from '../lib/env';
import { getStoredPrivateKey } from '../components/PrivateKeyImportDialog';

// Web mode only: resolve the Polymarket Safe proxy wallet for the connected EOA,
// then fetch positions, orders, trades, balance from Polymarket directly.
// In app mode this hook is a no-op.
export function useWalletData() {
  const { address, isConnected } = useAccount();
  const signingMode = useAppStore((s) => s.signingMode);
  const setPkAddress = useAppStore((s) => s.setPkAddress);
  const store = useAppStore();
  const fetchingRef = useRef(false);
  const [proxyWallet, setProxyWallet] = useState<string | null>(null);
  const credsCheckedRef = useRef(false);

  // Derive EOA from private key when PK mode is active
  const pkEoa = useMemo(() => {
    if (signingMode !== 'privateKey') return null;
    const pk = getStoredPrivateKey();
    if (!pk) return null;
    try {
      return new ethers.Wallet(pk).address;
    } catch { return null; }
  }, [signingMode]);

  // Publish pkAddress to store so other components can read it
  useEffect(() => { setPkAddress(pkEoa); }, [pkEoa, setPkAddress]);

  // The effective EOA: PK address when in PK mode, otherwise wagmi address
  const effectiveEoa = signingMode === 'privateKey' && pkEoa ? pkEoa : address;
  const effectiveConnected = signingMode === 'privateKey' && pkEoa ? true : isConnected;

  // Resolve proxy wallet when EOA connects (or changes due to PK switch)
  useEffect(() => {
    if (!isWebMode || !effectiveConnected || !effectiveEoa) {
      setProxyWallet(null);
      credsCheckedRef.current = false;
      return;
    }
    (async () => {
      const pw = await fetchProxyWallet(effectiveEoa);
      console.log(`[useWalletData] EOA ${effectiveEoa} → proxy wallet ${pw}`);
      setProxyWallet(pw);
    })();
  }, [effectiveConnected, effectiveEoa]);

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

      // Fix missing avgPrice: compute from trades when API returns 0
      for (const pos of positions) {
        if (pos.avgPrice && pos.avgPrice > 0) continue;
        const tokenId = pos.asset || '';
        if (!tokenId) continue;
        // Find BUY trades for this token and compute VWAP
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

  // Auto-derive API creds if not available
  useEffect(() => {
    if (!isWebMode || !proxyWallet || credsCheckedRef.current) return;
    credsCheckedRef.current = true;
    if (!hasCredsForWallet(proxyWallet)) {
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
  }, [proxyWallet, fetchAll, signingMode, pkEoa]);

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
