import { memo, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { useSidebarOnchainGridWalletPositions } from '../lib/sidebarOnchainTradesStore';

/** Pushes onchain grid wallet dots into zustand without re-rendering Sidebar. */
export const SidebarOnchainGridPositionsSync = memo(function SidebarOnchainGridPositionsSync({
  liveTradesSource,
}: {
  liveTradesSource: string;
}) {
  const gridWalletPositions = useSidebarOnchainGridWalletPositions();
  const setOnchainGridPositions = useAppStore((s) => s.setOnchainGridPositions);

  useEffect(() => {
    if (liveTradesSource !== 'onchain') return;
    setOnchainGridPositions(gridWalletPositions.map((p) => ({ tokenId: p.tokenId, size: p.size })));
  }, [liveTradesSource, gridWalletPositions, setOnchainGridPositions]);

  return null;
});
