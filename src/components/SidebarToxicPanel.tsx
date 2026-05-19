import { memo } from 'react';
import { lazyWithChunkReload } from '../utils/lazyWithChunkReload';
import {
  refreshSidebarToxicFlow,
  useSidebarToxicFlowData,
  useSidebarToxicFlowRefreshing,
} from '../lib/sidebarToxicFlowStore';

const ToxicFlowDialogLazy = lazyWithChunkReload(() =>
  import('./ToxicFlowDialog').then((m) => ({ default: m.ToxicFlowDialog })),
);

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
  const data = useSidebarToxicFlowData();
  const refreshing = useSidebarToxicFlowRefreshing();
  return (
    <div className="flex flex-1 min-h-0 min-w-0 w-full flex-col overflow-hidden bg-gray-900 toxic-flow-scroll-stable">
      <ToxicFlowDialogLazy
        embedded
        open
        marketId={mid}
        marketName={marketName}
        yesTokenId={yesTokenId}
        streamData={data}
        onRefreshStream={refreshSidebarToxicFlow}
        streamRefreshing={refreshing}
        onClose={onClose}
      />
    </div>
  );
});
