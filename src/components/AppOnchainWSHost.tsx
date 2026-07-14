import { memo, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { useTradingWalletAddress } from '../hooks/useTradingWalletAddress';
import { SidebarOnchainTradesHost } from './SidebarOnchainTradesHost';
import { SidebarOnchainGridPositionsSync } from './SidebarOnchainGridPositionsSync';

/** App-level onchain WS — wallet positions/trades for TPO, pair trading, HUD (not gated on sidebar open). */
export const AppOnchainWSHost = memo(function AppOnchainWSHost() {
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const sidebarOutcome = useAppStore((s) => s.sidebarOutcome);
  const wallet = useTradingWalletAddress();
  const walletLc = wallet.trim().toLowerCase();

  const active = liveTradesSource === 'onchain' && !!walletLc;

  const marketId = useMemo(() => {
    if (!active || !selectedMarket) return null;
    // Prefer real condition id only — never token id / expired: stubs (breaks wallet+market trades WS).
    const cond = (selectedMarket.conditionId || '').trim();
    if (cond) return cond;
    const id = (selectedMarket.id || '').trim();
    if (!id || id.startsWith('expired:') || id.startsWith('token:')) return null;
    const toks = (selectedMarket.clobTokenIds || []).map((t) => String(t || '').trim()).filter(Boolean);
    if (toks.includes(id)) return null;
    return id;
  }, [active, selectedMarket?.conditionId, selectedMarket?.id, selectedMarket?.clobTokenIds]);

  const scopedClobPair = useMemo(() => {
    if (!selectedMarket?.clobTokenIds?.length) return null;
    return selectedMarket.clobTokenIds.map((x) => String(x || '').trim()).filter(Boolean);
  }, [selectedMarket?.clobTokenIds]);

  const tokenId = useMemo(() => {
    if (!active || !selectedMarket?.clobTokenIds?.length) return null;
    return selectedMarket.clobTokenIds[sidebarOutcome === 'YES' ? 0 : 1] || null;
  }, [active, selectedMarket?.clobTokenIds, sidebarOutcome]);

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
