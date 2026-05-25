import { memo, useEffect, useState, type ComponentType } from 'react';
import { importWithChunkReload } from '../utils/lazyWithChunkReload';
import {
  refreshSidebarToxicFlow,
  useSidebarToxicFlowData,
  useSidebarToxicFlowRefreshing,
} from '../lib/sidebarToxicFlowStore';
import { useSidebarToxicFlowTabViews } from '../lib/sidebarToxicFlowTabViews';
import {
  TOXIC_FAVOURITE_WALLETS_LS_KEY,
  TOXIC_FAVOURITES_CHANGED_EVENT,
  readToxicFavouriteWallets,
} from '../lib/toxicFavouriteWallets';
import {
  readToxicXWallets,
  TOXIC_X_CHANGED_EVENT,
  TOXIC_X_WALLETS_LS_KEY,
} from '../lib/toxicXWallets';
import {
  readTiltWhaleAmountUsd,
  TILT_WHALE_AMOUNT_USD_CHANGED_EVENT,
  TILT_WHALE_AMOUNT_USD_LS_KEY,
} from '../lib/tiltWhaleAmountUsd';
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
  const data = useSidebarToxicFlowData();
  const refreshing = useSidebarToxicFlowRefreshing();
  const [toxicFavSet, setToxicFavSet] = useState(readToxicFavouriteWallets);
  const [toxicXSet, setToxicXSet] = useState(readToxicXWallets);
  const [whaleUsd, setWhaleUsd] = useState(readTiltWhaleAmountUsd);

  useEffect(() => {
    preloadSidebarToxicFlowDialog();
  }, []);

  useEffect(() => {
    const syncFav = () => setToxicFavSet(readToxicFavouriteWallets());
    const syncX = () => setToxicXSet(readToxicXWallets());
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY || e.key === TILT_WHALE_AMOUNT_USD_LS_KEY || e.key === null) {
        syncFav();
        setWhaleUsd(readTiltWhaleAmountUsd());
      }
      if (e.key === TOXIC_X_WALLETS_LS_KEY || e.key === null) syncX();
    };
    const syncWhale = () => setWhaleUsd(readTiltWhaleAmountUsd());
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, syncFav);
    window.addEventListener(TOXIC_X_CHANGED_EVENT, syncX);
    window.addEventListener(TILT_WHALE_AMOUNT_USD_CHANGED_EVENT, syncWhale);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, syncFav);
      window.removeEventListener(TOXIC_X_CHANGED_EVENT, syncX);
      window.removeEventListener(TILT_WHALE_AMOUNT_USD_CHANGED_EVENT, syncWhale);
    };
  }, []);

  const tabWalletViews = useSidebarToxicFlowTabViews(toxicFavSet, whaleUsd, toxicXSet);

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
      streamData={data}
      streamTabWalletViews={tabWalletViews}
      onRefreshStream={refreshSidebarToxicFlow}
      streamRefreshing={refreshing}
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
