import { memo, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { useTradingWalletAddress } from '../hooks/useTradingWalletAddress';
import { SidebarOnchainTradesHost } from './SidebarOnchainTradesHost';
import { SidebarOnchainGridPositionsSync } from './SidebarOnchainGridPositionsSync';

/** App-level onchain WS — wallet positions/trades for TPO, pair trading, HUD (not gated on sidebar open). */
export const AppOnchainWSHost = memo(function AppOnchainWSHost() {
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const selectedConditionId = useAppStore((s) => s.selectedMarket?.conditionId?.trim() ?? '');
  const selectedMarketId = useAppStore((s) => s.selectedMarket?.id?.trim() ?? '');
  const selectedClobKey = useAppStore((s) => (s.selectedMarket?.clobTokenIds || []).join('\0'));
  const sidebarOutcome = useAppStore((s) => s.sidebarOutcome);
  const wallet = useTradingWalletAddress();
  const walletLc = wallet.trim().toLowerCase();

  const active = liveTradesSource === 'onchain' && !!walletLc;

  const marketId = useMemo(() => {
    if (!active) return null;
    // Prefer real condition id only — never token id / expired: stubs (breaks wallet+market trades WS).
    if (selectedConditionId) return selectedConditionId;
    const id = selectedMarketId;
    if (!id || id.startsWith('expired:') || id.startsWith('token:')) return null;
    const toks = selectedClobKey ? selectedClobKey.split('\0').filter(Boolean) : [];
    if (toks.includes(id)) return null;
    return id;
  }, [active, selectedConditionId, selectedMarketId, selectedClobKey]);

  const scopedClobPair = useMemo(() => {
    if (!selectedClobKey) return null;
    const toks = selectedClobKey.split('\0').filter(Boolean);
    return toks.length ? toks : null;
  }, [selectedClobKey]);

  const tokenId = useMemo(() => {
    if (!active || !scopedClobPair?.length) return null;
    return scopedClobPair[sidebarOutcome === 'YES' ? 0 : 1] || null;
  }, [active, scopedClobPair, sidebarOutcome]);

  if (!active) return null;

  return (
    <>
      <SidebarOnchainTradesHost
        wallet={walletLc}
        marketId={marketId}
        tokenId={tokenId}
        scopedClobTokenIds={scopedClobPair}
      />
      <SidebarOnchainGridPositionsSync liveTradesSource={liveTradesSource} />
    </>
  );
});
