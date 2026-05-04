import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { fetchProxyWallet } from '../api/polymarket';
import { useAppStore } from '../stores/appStore';

/** Lowercase maker → proxy → EOA for wallet dialogs (same resolution as Sidebar on-chain key). */
export function useTradingWalletAddress(): string {
  const { address: walletAddress } = useAccount();
  const makerAddress = useAppStore((s) => s.makerAddress);
  const pkAddress = useAppStore((s) => s.pkAddress);
  const signingMode = useAppStore((s) => s.signingMode);
  const effectiveEoa = signingMode === 'privateKey' && pkAddress ? pkAddress : walletAddress ?? undefined;

  const [proxyWallet, setProxyWallet] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!effectiveEoa) {
      setProxyWallet(null);
      return;
    }
    void fetchProxyWallet(effectiveEoa).then((pw) => {
      if (!cancelled) setProxyWallet(pw);
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveEoa]);

  return (makerAddress || proxyWallet || walletAddress || '').trim().toLowerCase();
}
