import { memo, useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { buildSidebarUserOrderHighlightSets } from '../lib/sidebarOrderbookAggregate';
import { setSidebarOrderHighlightSets } from '../lib/sidebarOrderHighlightStore';

const EMPTY_SET = new Set<string>();
const FLUSH_MS = 500;

/** Bridge open-order prices → orderbook highlight store. Throttled — no live orders React sub. */
export const SidebarOrderHighlightHost = memo(function SidebarOrderHighlightHost() {
  const selectedClobKey = useAppStore((s) => (s.selectedMarket?.clobTokenIds || []).join('\0'));
  const orderOutcome = useAppStore((s) => s.sidebarOutcome);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flush = () => {
      timerRef.current = null;
      const toks = selectedClobKey ? selectedClobKey.split('\0') : [];
      const yesToken = toks[0] || '';
      const noToken = toks[1] || '';
      if (!yesToken && !noToken) {
        setSidebarOrderHighlightSets(EMPTY_SET, EMPTY_SET);
        return;
      }
      const { bidPrices, askPrices } = buildSidebarUserOrderHighlightSets(
        useAppStore.getState().orders,
        yesToken,
        noToken,
        orderOutcome,
      );
      setSidebarOrderHighlightSets(bidPrices, askPrices);
    };

    const schedule = () => {
      if (timerRef.current != null) return;
      timerRef.current = setTimeout(flush, FLUSH_MS);
    };

    flush();
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.orders === prev.orders) return;
      schedule();
    });
    return () => {
      unsub();
      if (timerRef.current != null) clearTimeout(timerRef.current);
    };
  }, [selectedClobKey, orderOutcome]);

  return null;
});
