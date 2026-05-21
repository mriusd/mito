import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { fetchProxyWallet } from '../api/polymarket';
import { resolvePolymarketMakerAddress } from '../lib/polymarketTradingMaker';
import { useAppStore } from '../stores/appStore';

/** Lowercase maker → proxy → EOA for wallet dialogs (same resolution as Sidebar on-chain key). */
export function useTradingWalletAddress(): string {
  const { address: walletAddress } = useAccount();
  const pkAddress = useAppStore((s) => s.pkAddress);
  const pkRevision = useAppStore((s) => s.pkRevision);
  const signingMode = useAppStore((s) => s.signingMode);
  const effectiveEoa = (signingMode === 'privateKey' && pkAddress ? pkAddress : walletAddress ?? undefined)
    ?.trim()
    .toLowerCase() || '';
  const channelKey = effectiveEoa ? `${signingMode}|${effectiveEoa}|${signingMode === 'privateKey' ? pkRevision : 0}` : '';

  const channelKeyRef = useRef('');
  const [makerAddress, setMakerAddress] = useState('');

  useLayoutEffect(() => {
    if (channelKeyRef.current === channelKey) return;
    channelKeyRef.current = channelKey;
    setMakerAddress('');
  }, [channelKey]);

  useEffect(() => {
    let cancelled = false;
    if (!effectiveEoa) {
      setMakerAddress('');
      return;
    }
    void fetchProxyWallet(effectiveEoa).then((pw) => {
      if (cancelled || channelKeyRef.current !== channelKey) return;
      try {
        setMakerAddress(resolvePolymarketMakerAddress(effectiveEoa, pw).trim().toLowerCase());
      } catch {
        if (!cancelled && channelKeyRef.current === channelKey) setMakerAddress('');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveEoa, channelKey]);

  return makerAddress;
}
