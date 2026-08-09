import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, memo } from 'react';
import { Loader2 } from 'lucide-react';
import './lib/wallet';
import { useAppStore } from './stores/appStore';
import { Header } from './components/Header';
import { DraggableCanvas } from './components/DraggableCanvas';
import { AppOnchainWSHost } from './components/AppOnchainWSHost';
import { AppSignalsAndArbsHost } from './components/AppSignalsAndArbsHost';
import { AppDataHost } from './components/AppDataHost';
import { OrderbookPopup } from './components/OrderbookPopup';
import { CreateProgDialog } from './components/CreateProgDialog';
import { EditProgDialog } from './components/EditProgDialog';
import { ArbDialog } from './components/ArbDialog';
import { PnlDrilldownDialog } from './components/PnlDrilldownDialog';
import { SigningDialog } from './components/SigningDialog';
import { SignatureExplainerDialog } from './components/SignatureExplainerDialog';
import { MobileScreenNotice } from './components/MobileScreenNotice';
import { lazyWithChunkReload } from './utils/lazyWithChunkReload';
import { ErrorBoundary } from './components/ErrorBoundary';
import { buildMarketByIdRecord } from './components/WalletLatestMarketsTradedTable';
import {
  adjacentMarketCell,
  findMarketCellEl,
  gridDirFromKey,
  marketFromLookupById,
  shouldIgnoreGridKeyEvent,
} from './lib/marketGridKeyboard';
import { pickLiveUpDownMarketInTfBucket } from './utils/format';
import { installUiInteractionRecovery } from './lib/uiInteractionRecovery';
import { runAppRefresh } from './lib/appRefresh';
import { MOBILE_SCREEN_MEDIA_QUERY } from './lib/mobileScreenNotice';
import {
  isWsBidAskStubMarket,
  resolveCanonicalMarketForToken,
} from './lib/bidAskMarketLookup';

/** URL ?market= — Gamma numeric id preferred; never write quote-only `ws:` stubs. */
function marketIdForUrl(m: { id?: string; conditionId?: string } | null | undefined): string {
  if (!m) return '';
  const id = String(m.id || '').trim();
  if (id && !id.startsWith('ws:') && !id.startsWith('expired:')) return id;
  return String(m.conditionId || '').trim();
}

const SidebarLazy = lazyWithChunkReload(() =>
  import('./components/Sidebar').then((m) => ({ default: m.Sidebar })),
);

function useMountSidebarLazyChunk(): boolean {
  const [mount, setMount] = useState(() =>
    typeof window !== 'undefined' && !window.matchMedia(MOBILE_SCREEN_MEDIA_QUERY).matches,
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
  let marketId = (params.get('market') || '').trim();
  if (!marketId) return null;
  if (marketId.startsWith('ws:')) marketId = marketId.slice(3);
  if (marketId.startsWith('expired:')) marketId = marketId.slice('expired:'.length);
  if (!marketId) return null;
  const rawSide = (params.get('side') || 'yes').toLowerCase();
  return { marketId, side: rawSide === 'no' ? 'NO' : 'YES' };
}

function PnlDrilldownGlobal() {
  const { open, asset, endDates } = useAppStore((s) => s.pnlDrilldown);
  const close = useAppStore((s) => s.closePnlDrilldown);
  return <PnlDrilldownDialog open={open} asset={asset} endDates={endDates} onClose={close} />;
}

/** Delay before showing red banner — avoids flash on brief WS/probe blips. */
const SERVER_DOWN_BANNER_DELAY_MS = 8_000;

function App() {
  const loading = useAppStore((s) => s.loading);
  const backendConnected = useAppStore((s) => s.backendConnected);
  const [showServerDownBanner, setShowServerDownBanner] = useState(false);
  const serverDownDismissedRef = useRef(false);
  useEffect(() => {
    if (backendConnected !== false) {
      serverDownDismissedRef.current = false;
      setShowServerDownBanner(false);
      return;
    }
    if (serverDownDismissedRef.current) return;
    const t = window.setTimeout(() => {
      if (!serverDownDismissedRef.current) setShowServerDownBanner(true);
    }, SERVER_DOWN_BANNER_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [backendConnected]);
  const selectedMarketId = useAppStore((s) => marketIdForUrl(s.selectedMarket));
  const selectedMarketConditionId = useAppStore((s) => s.selectedMarket?.conditionId?.trim() ?? '');
  const hideSidebar = useAppStore((s) => s.hideSidebar);
  const sidebarOutcome = useAppStore((s) => s.sidebarOutcome);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const [pendingLink, setPendingLink] = useState<{ marketId: string; side: 'YES' | 'NO' } | null>(() =>
    parseMarketLinkFromUrl(),
  );
  const didApplyDefaultBtc5mMarketRef = useRef(false);
  const selectedMarketRef = useRef(useAppStore.getState().selectedMarket);
  useEffect(() => {
    return useAppStore.subscribe((state) => {
      selectedMarketRef.current = state.selectedMarket;
    });
  }, []);
  const mountSidebarChunk = useMountSidebarLazyChunk();

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia(MOBILE_SCREEN_MEDIA_QUERY).matches) {
      useAppStore.getState().setSidebarOpen(false);
    }
  }, []);

  useEffect(() => installUiInteractionRecovery(), []);

  const handleRefresh = useCallback(async () => {
    await runAppRefresh();
  }, []);

  // Queue URL -> state sync when browser history changes.
  useEffect(() => {
    const onPopState = () => setPendingLink(parseMarketLinkFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Apply URL deep-link once it can be resolved from marketLookup.
  useEffect(() => {
    if (!pendingLink) return;

    const tryApply = () => {
      const st = useAppStore.getState();
      const key = pendingLink.marketId.trim();
      const byId = buildMarketByIdRecord(st.marketLookup);
      let m = byId[key] ?? byId[key.toLowerCase()];
      if (!m || isWsBidAskStubMarket(m)) {
        const byToken = resolveCanonicalMarketForToken(key);
        if (byToken && !isWsBidAskStubMarket(byToken)) m = byToken;
      }
      if (!m || isWsBidAskStubMarket(m)) return;

      if (!st.selectedMarket || st.selectedMarket.id !== m.id) setSelectedMarket(m);
      if (st.sidebarOutcome !== pendingLink.side) setSidebarOutcome(pendingLink.side);
      setSidebarOpen(true);
      setPendingLink(null);
    };

    tryApply();
    return useAppStore.subscribe((state, prev) => {
      if (state.lastUpdated === prev.lastUpdated) return;
      tryApply();
    });
  }, [pendingLink, setSelectedMarket, setSidebarOutcome, setSidebarOpen]);

  // No ?market= and no sidebar pick yet → open on live BTC 5m Up/Down.
  useEffect(() => {
    if (loading) return;
    if (pendingLink != null) return;
    if (didApplyDefaultBtc5mMarketRef.current) return;

    const tryDefault = () => {
      let urlMarketIntent = '';
      if (typeof window !== 'undefined') {
        urlMarketIntent = new URLSearchParams(window.location.search).get('market') || '';
        if (urlMarketIntent.trim()) {
          didApplyDefaultBtc5mMarketRef.current = true;
          return;
        }
      }

      const st = useAppStore.getState();
      if (st.selectedMarket != null) {
        didApplyDefaultBtc5mMarketRef.current = true;
        return;
      }

      const live = pickLiveUpDownMarketInTfBucket(st.upOrDownMarkets?.BTC?.['5m'], Date.now());
      if (!live?.id) return;

      didApplyDefaultBtc5mMarketRef.current = true;
      const m = marketFromLookupById(st.marketLookup, live.id) ?? live;
      setSelectedMarket(m);
    };

    tryDefault();
    return useAppStore.subscribe((state, prev) => {
      if (state.lastUpdated === prev.lastUpdated) return;
      tryDefault();
    });
  }, [loading, pendingLink, setSelectedMarket]);

  // Upgrade quote-only selectedMarket once Gamma seed lands.
  useEffect(() => {
    const tryUpgrade = () => {
      const sm = useAppStore.getState().selectedMarket;
      if (!sm || !isWsBidAskStubMarket(sm)) return;
      const toks = (sm.clobTokenIds || []).map((t) => String(t || '').trim()).filter(Boolean);
      for (const tid of toks) {
        const next = resolveCanonicalMarketForToken(tid);
        if (next && !isWsBidAskStubMarket(next)) {
          setSelectedMarket(next);
          return;
        }
      }
    };
    tryUpgrade();
    return useAppStore.subscribe((state, prev) => {
      if (
        state.marketLookup === prev.marketLookup &&
        state.upOrDownMarkets === prev.upOrDownMarkets &&
        state.weatherMarkets === prev.weatherMarkets &&
        state.lastUpdated === prev.lastUpdated
      ) {
        return;
      }
      tryUpgrade();
    });
  }, [setSelectedMarket]);

  // selected market -> URL sync (debounced — rapid hops don't spam history API)
  useEffect(() => {
    const t = window.setTimeout(() => {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      const desiredMarket = selectedMarketId;
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
    }, 200);
    return () => window.clearTimeout(t);
  }, [selectedMarketId, sidebarOutcome]);

  // Arrow keys / WASD: move selection to adjacent grid cell.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const sm = selectedMarketRef.current;
      if (!sm) return;
      if (shouldIgnoreGridKeyEvent(e)) return;
      const dir = gridDirFromKey(e.key);
      if (!dir) return;
      if ((dir === 'left' || dir === 'right') && document.activeElement?.closest('[data-temp-odds-panel]')) {
        return;
      }

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
      <AppDataHost />

      <div className="flex-shrink-0 px-3 pt-2 pb-1">
        <Header onRefresh={handleRefresh} />
      </div>

      <div
        className={`flex-1 min-h-0 flex max-[559px]:ml-0 min-[560px]:transition-[margin-left] min-[560px]:duration-[250ms] min-[560px]:ease-[ease] ${
          hideSidebar
            ? 'min-[560px]:ml-0'
            : selectedMarketConditionId
              ? 'min-[560px]:ml-[calc(18rem+1.5rem)]'
              : 'min-[560px]:ml-72'
        }`}
      >
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

      <AppOnchainWSHost />
      <AppSignalsAndArbsHost />

      {mountSidebarChunk && (
        <ErrorBoundary name="sidebar">
          <Suspense fallback={null}>
            <SidebarLazy />
          </Suspense>
        </ErrorBoundary>
      )}

      <OrderbookPopup />
      <CreateProgDialog />
      <EditProgDialog />
      <ArbDialog />
      <PnlDrilldownGlobal />
      <SigningDialog />
      <SignatureExplainerDialog />
      <MobileScreenNotice />

      <div id="toastContainer" className="toast-container" />

      {showServerDownBanner && (
        <button
          type="button"
          className="server-down-toast fixed bottom-5 right-5 z-[60001] flex max-w-[320px] items-start gap-2.5 rounded-lg bg-red-600 px-3.5 py-3 text-left text-white shadow-lg cursor-pointer hover:bg-red-500"
          role="alert"
          title="Click to dismiss"
          onClick={() => {
            serverDownDismissedRef.current = true;
            setShowServerDownBanner(false);
          }}
        >
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">Server is down or being restarted</p>
            <p className="mt-1 text-[11px] leading-snug text-red-50/90">
              Please allow for several minutes for it to get back online. Click to dismiss.
            </p>
          </div>
        </button>
      )}
    </div>
  );
}

export default memo(App);
