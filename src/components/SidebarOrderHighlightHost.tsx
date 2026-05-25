import { memo, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { buildSidebarUserOrderHighlightSets } from '../lib/sidebarOrderbookAggregate';
import { setSidebarOrderHighlightSets } from '../lib/sidebarOrderHighlightStore';

const EMPTY_SET = new Set<string>();

export const SidebarOrderHighlightHost = memo(function SidebarOrderHighlightHost() {
  const orders = useAppStore((s) => s.orders);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const orderOutcome = useAppStore((s) => s.sidebarOutcome);

  useEffect(() => {
    const yesToken = selectedMarket?.clobTokenIds?.[0] || '';
    const noToken = selectedMarket?.clobTokenIds?.[1] || '';
    if (!yesToken && !noToken) {
      setSidebarOrderHighlightSets(EMPTY_SET, EMPTY_SET);
      return;
    }
    const { bidPrices, askPrices } = buildSidebarUserOrderHighlightSets(
      orders,
      yesToken,
      noToken,
      orderOutcome,
    );
    setSidebarOrderHighlightSets(bidPrices, askPrices);
  }, [orders, selectedMarket?.clobTokenIds, orderOutcome]);

  return null;
});
