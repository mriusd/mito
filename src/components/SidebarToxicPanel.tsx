import { memo, Suspense, useEffect, useState } from 'react';
import { lazyWithChunkReload } from '../utils/lazyWithChunkReload';
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

const ToxicFlowDialogLazy = lazyWithChunkReload(() =>
  import('./ToxicFlowDialog').then((m) => ({ default: m.ToxicFlowDialog })),
);

const SidebarToxicPanelBody = memo(function SidebarToxicPanelBody({
  marketId,
  marketName,
  yesTokenId,
  noTokenId,
  marketExpired,
  onClose,
  onInlineWalletExtraWidthChange,
}: {
  marketId: string;
  marketName: string;
  yesTokenId: string;
  noTokenId?: string;
  marketExpired?: boolean;
  onClose: () => void;
  onInlineWalletExtraWidthChange?: (width: string) => void;
}) {
  const mid = marketId.trim();
  const data = useSidebarToxicFlowData();
  const refreshing = useSidebarToxicFlowRefreshing();
  const [toxicFavSet, setToxicFavSet] = useState(readToxicFavouriteWallets);
  const [toxicXSet, setToxicXSet] = useState(readToxicXWallets);
  const [whaleUsd, setWhaleUsd] = useState(readTiltWhaleAmountUsd);

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

  return (
    <ToxicFlowDialogLazy
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
      onInlineWalletExtraWidthChange={onInlineWalletExtraWidthChange}
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
  onInlineWalletExtraWidthChange,
}: {
  marketId: string;
  marketName: string;
  yesTokenId: string;
  noTokenId?: string;
  marketExpired?: boolean;
  onClose: () => void;
  onInlineWalletExtraWidthChange?: (width: string) => void;
}) {
  return (
    <div className="flex flex-1 min-h-0 min-w-0 w-full flex-col overflow-hidden bg-gray-900 toxic-flow-scroll-stable">
      <Suspense fallback={<div className="p-2 text-[10px] text-gray-500">Loading holders…</div>}>
        <SidebarToxicPanelBody
          marketId={marketId}
          marketName={marketName}
          yesTokenId={yesTokenId}
          noTokenId={noTokenId}
          marketExpired={marketExpired}
          onClose={onClose}
          onInlineWalletExtraWidthChange={onInlineWalletExtraWidthChange}
        />
      </Suspense>
    </div>
  );
});
