import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import './lib/wallet';
import { useAppStore } from './stores/appStore';
import { useBinanceWS } from './hooks/useBinanceWS';
import { useMarketData } from './hooks/useMarketData';
import { useWalletData } from './hooks/useWalletData';
import { useVwapAndVolatility } from './hooks/useVwapAndVolatility';
import { useSignalsAndArbs } from './hooks/useSignalsAndArbs';
import { useBidAskWS } from './hooks/useBidAskWS';
import { Header } from './components/Header';
import { DraggableCanvas } from './components/DraggableCanvas';
import { OrderbookPopup } from './components/OrderbookPopup';
import { CreateProgDialog } from './components/CreateProgDialog';
import { EditProgDialog } from './components/EditProgDialog';
import { ArbDialog } from './components/ArbDialog';
import { PnlDrilldownDialog } from './components/PnlDrilldownDialog';
import { SigningDialog } from './components/SigningDialog';
import { SignatureExplainerDialog } from './components/SignatureExplainerDialog';
import { lazyWithChunkReload } from './utils/lazyWithChunkReload';
import {
  adjacentMarketCell,
  findMarketCellEl,
  gridDirFromKey,
  marketFromLookupById,
  shouldIgnoreGridKeyEvent,
} from './lib/marketGridKeyboard';

const SidebarLazy = lazyWithChunkReload(() =>
  import('./components/Sidebar').then((m) => ({ default: m.Sidebar })),
);

function useMountSidebarLazyChunk(): boolean {
  const [mount, setMount] = useState(() =>
    typeof window !== 'undefined' && !window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const check = () => {
      const { sidebarOpen, selectedMarket } = useAppStore.getState();
      if (sidebarOpen || selectedMarket) setMount(true);
    };
    check();
    return useAppStore.subscribe(check);
  }, []);
  return mount;
}

function parseMarketLinkFromUrl(): { marketId: string; side: 'YES' | 'NO' } | null {
  const params = new URLSearchParams(window.location.search);
  const marketId = params.get('market') || '';
  if (!marketId) return null;
  const rawSide = (params.get('side') || 'yes').toLowerCase();
  return { marketId, side: rawSide === 'no' ? 'NO' : 'YES' };
}

function PnlDrilldownGlobal() {
  const { open, asset, endDates } = useAppStore((s) => s.pnlDrilldown);
  const close = useAppStore((s) => s.closePnlDrilldown);
  return <PnlDrilldownDialog open={open} asset={asset} endDates={endDates} onClose={close} />;
}

function App() {
  const loading = useAppStore((s) => s.loading);
  const backendConnected = useAppStore((s) => s.backendConnected);
  /** Bumps when backend refresh fills marketLookup — deep-link effect reads lookup via getState(), not this subscription. */
  const marketLookupEpoch = useAppStore((s) => s.lastUpdated);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const sidebarOutcome = useAppStore((s) => s.sidebarOutcome);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const [pendingLink, setPendingLink] = useState<{ marketId: string; side: 'YES' | 'NO' } | null>(() => parseMarketLinkFromUrl());
  const selectedMarketRef = useRef(selectedMarket);
  selectedMarketRef.current = selectedMarket;
  const mountSidebarChunk = useMountSidebarLazyChunk();

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 767px)').matches) {
      useAppStore.getState().setSidebarOpen(false);
    }
  }, []);

  useBinanceWS();
  useVwapAndVolatility();
  useSignalsAndArbs();
  useBidAskWS();
  const { refreshData } = useMarketData();
  const { refreshWalletData } = useWalletData();

  const handleRefresh = useCallback(async () => {
    await Promise.all([refreshData(), refreshWalletData()]);
  }, [refreshData, refreshWalletData]);

  const signingMode = useAppStore((s) => s.signingMode);
  const prevSigningRef = useRef<typeof signingMode | null>(null);
  useEffect(() => {
    if (prevSigningRef.current === null) {
      prevSigningRef.current = signingMode;
      return;
    }
    if (prevSigningRef.current === signingMode) return;
    prevSigningRef.current = signingMode;
    void handleRefresh();
  }, [signingMode, handleRefresh]);

  // Queue URL -> state sync when browser history changes.
  useEffect(() => {
    const onPopState = () => setPendingLink(parseMarketLinkFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Apply URL deep-link once it can be resolved from marketLookup (read from store inside effect to avoid subscribing to full map).
  useEffect(() => {
    if (!pendingLink) return;

    const marketLookup = useAppStore.getState().marketLookup;
    const byId = new Map<string, (typeof selectedMarket)>();
    for (const m of Object.values(marketLookup)) byId.set(m.id, m);
    const m = byId.get(pendingLink.marketId);
    if (!m) return;

    if (!selectedMarket || selectedMarket.id !== m.id) setSelectedMarket(m);
    if (sidebarOutcome !== pendingLink.side) setSidebarOutcome(pendingLink.side);
    setSidebarOpen(true);
    setPendingLink(null);
  }, [pendingLink, marketLookupEpoch, selectedMarket, sidebarOutcome, setSelectedMarket, setSidebarOutcome, setSidebarOpen]);

  // selected market -> URL sync
  useEffect(() => {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    const desiredMarket = selectedMarket?.id || '';
    const desiredSide = sidebarOutcome.toLowerCase();

    if (!desiredMarket) {
      if (!params.has('market') && !params.has('side')) return;
      params.delete('market');
      params.delete('side');
    } else {
      const curMarket = params.get('market') || '';
      const curSide = (params.get('side') || '').toLowerCase();
      if (curMarket === desiredMarket && curSide === desiredSide) return;
      params.set('market', desiredMarket);
      params.set('side', desiredSide);
    }

    const next = `${url.pathname}${params.toString() ? `?${params.toString()}` : ''}${url.hash}`;
    window.history.replaceState(null, '', next);
  }, [selectedMarket, sidebarOutcome]);

  // Arrow keys / WASD: move selection to adjacent grid cell (same YES/NO side).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const sm = selectedMarketRef.current;
      if (!sm) return;
      if (shouldIgnoreGridKeyEvent(e)) return;
      const dir = gridDirFromKey(e.key);
      if (!dir) return;

      const cell = findMarketCellEl(sm.id);
      if (!cell) return;

      const nextCell = adjacentMarketCell(cell, dir);
      if (!nextCell) return;

      const nextId = nextCell.dataset.marketId;
      if (!nextId) return;

      const { marketLookup, setSelectedMarket: sel } = useAppStore.getState();
      const nextMarket = marketFromLookupById(marketLookup, nextId);
      if (!nextMarket) return;

      e.preventDefault();
      sel(nextMarket);
      nextCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="gradient-bg h-full flex flex-col text-white">
      {/* Header - static at top */}
      <div className="flex-shrink-0 px-3 pt-2 pb-1">
        <Header onRefresh={handleRefresh} />
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 flex ml-[288px] max-[767px]:ml-0">
        {/* Canvas area */}
        <div className="flex-1 min-h-0 overflow-auto px-2 pb-2">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500 text-sm pulse">Loading markets...</div>
            </div>
          ) : (
            <DraggableCanvas />
          )}
        </div>
      </div>

      {/* Right Sidebar — lazy chunk until desktop (always) or mobile (open / market selected) */}
      {mountSidebarChunk && (
        <Suspense fallback={null}>
          <SidebarLazy />
        </Suspense>
      )}

      {/* Orderbook hover popup */}
      <OrderbookPopup />

      {/* Create Smart Order Dialog */}
      <CreateProgDialog />

      {/* Edit Smart Order Dialog */}
      <EditProgDialog />

      {/* Arb Confirm Dialog */}
      <ArbDialog />

      {/* PnL Drilldown Dialog */}
      <PnlDrilldownGlobal />

      {/* Signing Dialog */}
      <SigningDialog />
      <SignatureExplainerDialog />

      {/* Toast container */}
      <div id="toastContainer" className="toast-container" />

      {backendConnected === false && (
        <div
          className="server-down-banner fixed top-0 left-0 right-0 z-[350] border-b border-red-700/70 bg-red-950/95 px-3 py-2 text-center shadow-lg pointer-events-auto"
          role="alert"
        >
          <p className="text-xs font-bold text-red-200">Server is down or being restarted</p>
          <p className="mt-0.5 text-[11px] text-red-100/90">
            Please allow for several minutes for it to get back online. This clears automatically once the server is back online.
          </p>
        </div>
      )}
    </div>
  );
}

export default App;
