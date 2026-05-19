import { createContext, memo, useContext, useMemo } from 'react';
import { useToxicFlowMarketStream, type ToxicFlowMarketStream } from '../hooks/useToxicFlowMarketStream';

const SidebarToxicFlowCtx = createContext<ToxicFlowMarketStream | null>(null);

export const SidebarToxicFlowProvider = memo(function SidebarToxicFlowProvider({
  marketId,
  children,
}: {
  marketId: string;
  children: React.ReactNode;
}) {
  const mid = marketId.trim();
  const stream = useToxicFlowMarketStream(mid, Boolean(mid));
  const value = useMemo(
    () => stream,
    [stream.data, stream.refresh, stream.refreshing],
  );
  return <SidebarToxicFlowCtx.Provider value={value}>{children}</SidebarToxicFlowCtx.Provider>;
});

export function useSidebarToxicFlowStream(): ToxicFlowMarketStream {
  const ctx = useContext(SidebarToxicFlowCtx);
  if (!ctx) {
    throw new Error('useSidebarToxicFlowStream requires SidebarToxicFlowProvider');
  }
  return ctx;
}
