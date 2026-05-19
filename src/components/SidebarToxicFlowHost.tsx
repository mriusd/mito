import { memo } from 'react';
import { useToxicFlowMarketStream } from '../hooks/useToxicFlowMarketStream';

/** Null host — single toxic WS writes to sidebarToxicFlowStore (no parent re-render cascade). */
export const SidebarToxicFlowHost = memo(function SidebarToxicFlowHost({
  marketId,
}: {
  marketId: string;
}) {
  useToxicFlowMarketStream(marketId.trim(), Boolean(marketId.trim()), { sidebarStore: true });
  return null;
});
