import { memo } from 'react';
import { lazyWithChunkReload } from '../utils/lazyWithChunkReload';
import { useToxicFlowMarketStream } from '../hooks/useToxicFlowMarketStream';

const ToxicFlowDialogLazy = lazyWithChunkReload(() =>
  import('./ToxicFlowDialog').then((m) => ({ default: m.ToxicFlowDialog })),
);

/** Own stream + memo shell — Sidebar OB ticks must not re-render WalletTable. */
export const SidebarToxicPanel = memo(function SidebarToxicPanel({
  marketId,
  marketName,
  yesTokenId,
  onClose,
}: {
  marketId: string;
  marketName: string;
  yesTokenId: string;
  onClose: () => void;
}) {
  const mid = marketId.trim();
  const { data, refresh, refreshing } = useToxicFlowMarketStream(mid, Boolean(mid));
  return (
    <div className="flex flex-1 min-h-0 min-w-0 w-full flex-col overflow-hidden bg-gray-900 toxic-flow-scroll-stable">
      <ToxicFlowDialogLazy
        embedded
        open
        marketId={mid}
        marketName={marketName}
        yesTokenId={yesTokenId}
        streamData={data}
        onRefreshStream={refresh}
        streamRefreshing={refreshing}
        onClose={onClose}
      />
    </div>
  );
});
