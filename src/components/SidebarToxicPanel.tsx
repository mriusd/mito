import { memo, useEffect, useState } from 'react';
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
  const [toxicFavSet, setToxicFavSet] = useState(readToxicFavouriteWallets);
  const [whaleUsd, setWhaleUsd] = useState(readTiltWhaleAmountUsd);

  useEffect(() => {
    const syncFav = () => setToxicFavSet(readToxicFavouriteWallets());
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY || e.key === TILT_WHALE_AMOUNT_USD_LS_KEY || e.key === null) {
        syncFav();
        setWhaleUsd(readTiltWhaleAmountUsd());
      }
    };
    const syncWhale = () => setWhaleUsd(readTiltWhaleAmountUsd());
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, syncFav);
    window.addEventListener(TILT_WHALE_AMOUNT_USD_CHANGED_EVENT, syncWhale);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, syncFav);
      window.removeEventListener(TILT_WHALE_AMOUNT_USD_CHANGED_EVENT, syncWhale);
    };
  }, []);

  const tabWalletViews = useSidebarToxicFlowTabViews(toxicFavSet, whaleUsd);

  return (
    <ToxicFlowDialogLazy
      embedded
      open
      marketId={mid}
      marketName={marketName}
      yesTokenId={yesTokenId}
      streamData={data}
      streamTabWalletViews={tabWalletViews}
      onRefreshStream={refreshSidebarToxicFlow}
      streamRefreshing={refreshing}
      onClose={onClose}
    />
  );
});

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
  return (
    <div className="flex flex-1 min-h-0 min-w-0 w-full flex-col overflow-hidden bg-gray-900 toxic-flow-scroll-stable">
      <SidebarToxicPanelBody
        marketId={marketId}
        marketName={marketName}
        yesTokenId={yesTokenId}
        onClose={onClose}
      />
    </div>
  );
});
