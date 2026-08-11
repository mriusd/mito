import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo, startTransition } from 'react';
import { getAccount, watchAccount } from '@wagmi/core';
import { ethers } from 'ethers';
import { useAppStore } from '../stores/appStore';
import { fetchProxyWallet, fetchWalletPositions, fetchWalletActivity, fetchWalletBalance } from '../api/polymarket';
import { fetchOpenOrdersDirect, setWalletRefreshFn, setOrdersRefreshFn, hasCredsForWallet, ensureCredsForWallet, refreshOpenOrdersInStore } from '../lib/clobClient';
import { usePolymarketUserOrdersWS } from './usePolymarketUserOrdersWS';
import { resolvePolymarketMakerAddress } from '../lib/polymarketTradingMaker';
import { clearWalletAccountSlice } from '../lib/clearWalletAccountSlice';
import { isWebMode } from '../lib/env';
import { getStoredPrivateKey } from '../components/PrivateKeyImportDialog';
import { normalizeClobTokenId } from '../utils/format';
import { wagmiAdapter } from '../lib/wallet';

const wagmiConfig = wagmiAdapter.wagmiConfig;

function walletChannelKey(
  signingMode: 'wallet' | 'privateKey',
  effectiveEoa: string,
  pkRevision: number,
): string {
  const eoa = effectiveEoa.trim().toLowerCase();
  if (!eoa) return '';
  return `${signingMode}|${eoa}|${signingMode === 'privateKey' ? pkRevision : 0}`;
}

// Web mode only: Gamma → trading maker address; WalletConnect signer + RPC infer Safe vs deposit (POLY_1271) at order time.
// then fetch positions, orders, trades, balance from Polymarket directly.
// In app mode this hook is a no-op.
export function useWalletData() {
  // No useAccount / live store selects — those re-rendered AppDataHost every wagmi/store tick.
  const [address, setAddress] = useState(() => getAccount(wagmiConfig).address);
  const [isConnected, setIsConnected] = useState(() => Boolean(getAccount(wagmiConfig).isConnected));
  const [signingMode, setSigningMode] = useState(() => useAppStore.getState().signingMode);
  const [pkRevision, setPkRevision] = useState(() => useAppStore.getState().pkRevision);
  /** Bumped only on real channel change (layout) — stale in-flight loads must not write after PK↔wallet switch. */
  const walletLoadEpochRef = useRef(0);
  const walletChannelKeyRef = useRef<string>('');
  const proxyWalletRef = useRef<string | null>(null);
  const [proxyWallet, setProxyWallet] = useState<string | null>(null);
  const credsCheckedRef = useRef(false);

  proxyWalletRef.current = proxyWallet;

  useEffect(() => {
    return watchAccount(wagmiConfig, {
      onChange(data) {
        setAddress(data.address);
        setIsConnected(Boolean(data.isConnected));
      },
    });
  }, []);

  useEffect(() => {
    return useAppStore.subscribe((state, prev) => {
      if (state.signingMode !== prev.signingMode) setSigningMode(state.signingMode);
      if (state.pkRevision !== prev.pkRevision) setPkRevision(state.pkRevision);
    });
  }, []);

  // Derive EOA from private key when PK mode is active
  const pkEoa = useMemo(() => {
    if (signingMode !== 'privateKey') return null;
    const pk = getStoredPrivateKey();
    if (!pk) return null;
    try {
      return new ethers.Wallet(pk).address.toLowerCase();
    } catch { return null; }
  }, [signingMode, pkRevision]);

  // Publish pkAddress to store so other components can read it
  useEffect(() => {
    useAppStore.getState().setPkAddress(pkEoa);
  }, [pkEoa]);

  // The effective EOA: PK address when in PK mode, otherwise wagmi address
  const effectiveEoa = signingMode === 'privateKey' && pkEoa ? pkEoa : address;
  const effectiveConnected = signingMode === 'privateKey' && pkEoa ? true : isConnected;

  const stillCurrent = useCallback(
    (epochAtStart: number, channelAtStart: string, maker: string) => {
      if (epochAtStart !== walletLoadEpochRef.current) return false;
      if (channelAtStart !== walletChannelKeyRef.current) return false;
      return proxyWalletRef.current?.trim().toLowerCase() === maker;
    },
    [],
  );

  const loadWalletData = useCallback(
    async (makerLocked: string) => {
      const maker = makerLocked.trim().toLowerCase();
      if (!maker) return;
      const epochAtStart = walletLoadEpochRef.current;
      const channelAtStart = walletChannelKeyRef.current;

      // Publish maker immediately so Header Cash/Val is not stuck at 0 while
      // positions paginate (prod Data API can take many seconds / hit 429s).
      if (stillCurrent(epochAtStart, channelAtStart, maker)) {
        useAppStore.getState().setMarketData({ makerAddress: makerLocked });
      }

      // Balance first and independently — header cash must not wait on positions.
      void (async () => {
        try {
          const balance = await fetchWalletBalance(makerLocked);
          if (!stillCurrent(epochAtStart, channelAtStart, maker)) return;
          useAppStore.getState().setMarketData({
            cashBalance: balance,
            makerAddress: makerLocked,
          });
        } catch (err) {
          console.warn('[useWalletData] balance fetch failed:', err);
        }
      })();

      try {
        const [positions, trades, orders] = await Promise.all([
          fetchWalletPositions(makerLocked),
          fetchWalletActivity(makerLocked, 500),
          fetchOpenOrdersDirect(makerLocked),
        ]);

        if (!stillCurrent(epochAtStart, channelAtStart, maker)) return;

        // Fix missing avgPrice: compute from trades when API returns 0
        for (const pos of positions) {
          if (pos.avgPrice && pos.avgPrice > 0) continue;
          const tokenKey = normalizeClobTokenId(pos.asset || '');
          if (!tokenKey) continue;
          let totalCost = 0;
          let totalSize = 0;
          for (const t of trades) {
            const tKey = normalizeClobTokenId(t.asset || t.asset_id || t.token_id || '');
            if (tKey !== tokenKey) continue;
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

        if (!stillCurrent(epochAtStart, channelAtStart, maker)) return;

        startTransition(() => {
          useAppStore.getState().setMarketData({
            positions,
            orders,
            trades,
            makerAddress: makerLocked,
          });
        });
      } catch (err) {
        console.warn('[useWalletData] Failed to fetch wallet data:', err);
        // Keep makerAddress so header can still show cash if balance landed.
        if (stillCurrent(epochAtStart, channelAtStart, maker)) {
          useAppStore.getState().setMarketData({ makerAddress: makerLocked });
        }
      }
    },
    [stillCurrent],
  );

  useLayoutEffect(() => {
    const clearWalletSlice = () => clearWalletAccountSlice();
    if (!effectiveConnected || !effectiveEoa) {
      if (walletChannelKeyRef.current !== '') {
        walletChannelKeyRef.current = '';
        walletLoadEpochRef.current += 1;
        clearWalletSlice();
      }
      proxyWalletRef.current = null;
      setProxyWallet(null);
      return;
    }
    const key = walletChannelKey(signingMode, String(effectiveEoa), pkRevision);
    if (walletChannelKeyRef.current !== key) {
      walletChannelKeyRef.current = key;
      walletLoadEpochRef.current += 1;
      clearWalletSlice();
      proxyWalletRef.current = null;
      setProxyWallet(null);
    }
  }, [effectiveConnected, effectiveEoa, signingMode, pkRevision]);

  // Resolve proxy wallet when EOA connects or signing channel toggles — always drop stale maker first (no wrong-user fetch).
  useEffect(() => {
    if (!effectiveConnected || !effectiveEoa) {
      setProxyWallet(null);
      credsCheckedRef.current = false;
      return;
    }
    const channelAtStart = walletChannelKeyRef.current;
    let cancelled = false;
    (async () => {
      try {
        const eoaLc = typeof effectiveEoa === 'string' ? effectiveEoa.trim().toLowerCase() : '';
        const pw = await fetchProxyWallet(eoaLc);
        if (cancelled) return;
        if (channelAtStart !== walletChannelKeyRef.current) return;
        const maker = resolvePolymarketMakerAddress(eoaLc, pw);
        console.log(`[useWalletData] EOA ${eoaLc} → trading maker ${maker}`);
        proxyWalletRef.current = maker;
        setProxyWallet(maker);
        void loadWalletData(maker);
      } catch (e) {
        if (!cancelled) {
          console.error('[useWalletData] resolve trading maker failed:', e);
          proxyWalletRef.current = null;
          setProxyWallet(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveConnected, effectiveEoa, signingMode, pkRevision, loadWalletData]);

  /** Clear wallet-derived slice on PK ↔ Wallet transition only (same as wiping stale rows before reload). */
  const prevSigningForClearRef = useRef<'wallet' | 'privateKey' | null>(null);
  useEffect(() => {
    if (prevSigningForClearRef.current === null) {
      prevSigningForClearRef.current = signingMode;
      return;
    }
    if (prevSigningForClearRef.current === signingMode) return;
    prevSigningForClearRef.current = signingMode;
    clearWalletAccountSlice();
  }, [signingMode]);

  const fetchAll = useCallback(() => {
    const pw = proxyWalletRef.current;
    if (!pw) return;
    void loadWalletData(pw);
  }, [loadWalletData]);

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
      }
      // Wallet mode: defer L1 auth until place/cancel/merge (SigningDialog + ensureCreds).
    }
  }, [effectiveEoa, proxyWallet, fetchAll, signingMode, pkEoa]);

  const fetchOrdersOnly = useCallback(() => {
    if (!proxyWallet) return;
    void refreshOpenOrdersInStore(proxyWallet);
  }, [proxyWallet]);

  usePolymarketUserOrdersWS(effectiveConnected ? effectiveEoa : null, proxyWallet);

  // Register global refresh callback so order/cancel can trigger immediate refresh
  useEffect(() => {
    if (proxyWallet) {
      setWalletRefreshFn(fetchAll);
      setOrdersRefreshFn(fetchOrdersOnly);
    }
    return () => {
      setWalletRefreshFn(() => {});
      setOrdersRefreshFn(() => {});
    };
  }, [proxyWallet, fetchAll, fetchOrdersOnly]);

  // Orders HTTP backstop every 30s (WS is primary)
  useEffect(() => {
    if (!proxyWallet) return;
    const interval = setInterval(fetchOrdersOnly, 30000);
    return () => clearInterval(interval);
  }, [proxyWallet, fetchOrdersOnly]);

  // Full wallet poll every 90s as WS / order-poll backstop
  useEffect(() => {
    if (!proxyWallet) return;
    const interval = setInterval(fetchAll, 90000);
    return () => clearInterval(interval);
  }, [proxyWallet, fetchAll]);

  // Refetch when user focuses a market (Data API can lag; sidebar filters need fresh rows)
  useEffect(() => {
    if (!proxyWallet) return;
    let prevId = useAppStore.getState().selectedMarket?.id ?? '';
    let t: ReturnType<typeof setTimeout> | null = null;
    const unsub = useAppStore.subscribe((state) => {
      const id = state.selectedMarket?.id ?? '';
      if (id === prevId) return;
      prevId = id;
      if (!id) return;
      if (t != null) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        void fetchAll();
      }, 400);
    });
    return () => {
      unsub();
      if (t != null) clearTimeout(t);
    };
  }, [proxyWallet, fetchAll]);

  return { refreshWalletData: fetchAll };
}
