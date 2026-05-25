import { memo, useEffect, useState, type ComponentType } from 'react';
import { importWithChunkReload } from '../utils/lazyWithChunkReload';
import { setSidebarToxicWalletExtraWidth } from '../lib/sidebarToxicWalletWidthStore';

type ToxicFlowDialogModule = typeof import('./ToxicFlowDialog');
type ToxicFlowDialogComponent = ComponentType<
  Parameters<ToxicFlowDialogModule['ToxicFlowDialog']>[0]
>;

let toxicFlowDialogModule: ToxicFlowDialogModule | null = null;
let toxicFlowDialogLoad: Promise<ToxicFlowDialogModule> | null = null;

export function preloadSidebarToxicFlowDialog(): void {
  if (toxicFlowDialogModule) return;
  if (!toxicFlowDialogLoad) {
    toxicFlowDialogLoad = importWithChunkReload(() => import('./ToxicFlowDialog')).then((mod) => {
      toxicFlowDialogModule = mod;
      return mod;
    });
  }
}

function useSidebarToxicFlowDialog(): ToxicFlowDialogComponent | null {
  const [Dialog, setDialog] = useState<ToxicFlowDialogComponent | null>(
    () => toxicFlowDialogModule?.ToxicFlowDialog ?? null,
  );

  useEffect(() => {
    if (toxicFlowDialogModule) {
      setDialog(() => toxicFlowDialogModule!.ToxicFlowDialog);
      return;
    }
    preloadSidebarToxicFlowDialog();
    let cancelled = false;
    void toxicFlowDialogLoad!.then((mod) => {
      if (!cancelled) setDialog(() => mod.ToxicFlowDialog);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return Dialog;
}

const SidebarToxicPanelBody = memo(function SidebarToxicPanelBody({
  marketId,
  marketName,
  yesTokenId,
  noTokenId,
  marketExpired,
  onClose,
}: {
  marketId: string;
  marketName: string;
  yesTokenId: string;
  noTokenId?: string;
  marketExpired?: boolean;
  onClose: () => void;
}) {
  const ToxicFlowDialog = useSidebarToxicFlowDialog();
  const mid = marketId.trim();

  useEffect(() => {
    preloadSidebarToxicFlowDialog();
  }, []);

  if (!ToxicFlowDialog) {
    return <div className="p-2 text-[10px] text-gray-500">Loading holders…</div>;
  }

  return (
    <ToxicFlowDialog
      embedded
      open
      marketId={mid}
      marketName={marketName}
      yesTokenId={yesTokenId}
      noTokenId={noTokenId}
      marketExpired={marketExpired}
      onClose={onClose}
      onInlineWalletExtraWidthChange={setSidebarToxicWalletExtraWidth}
    />
  );
});

export const SidebarToxicPanel = memo(function SidebarToxicPanel({
  marketId,
  marketName,
  yesTokenId,
  noTokenId,
  marketExpired,
  onClose,
}: {
  marketId: string;
  marketName: string;
  yesTokenId: string;
  noTokenId?: string;
  marketExpired?: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-1 min-h-0 min-w-0 w-full flex-col overflow-hidden bg-gray-900 toxic-flow-scroll-stable">
      <SidebarToxicPanelBody
        marketId={marketId}
        marketName={marketName}
        yesTokenId={yesTokenId}
        noTokenId={noTokenId}
        marketExpired={marketExpired}
        onClose={onClose}
      />
    </div>
  );
});
