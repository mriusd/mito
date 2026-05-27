import {
  memo,
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
} from 'react';
import { createPortal } from 'react-dom';
import { fetchWalletSummary, fetchWalletPositions, type WalletPosition, type WalletSummary } from '../api';
import {
  recordToxicFavouriteNicknamesFromRows,
  setToxicFavouriteNickname,
  readToxicFavouriteWallets,
} from '../lib/toxicFavouriteWallets';
import { useAppStore } from '../stores/appStore';
import {
  buildMarketByIdRecord,
  sortWalletPositionsByDisplayedDateDesc,
} from './WalletLatestMarketsTradedTable';
import { fetchPolymarketNickname } from '../api/polymarket';
import { enrichMarketByIdFromWalletPositions } from '../lib/walletInfoChartMarket';
import type { Market } from '../types';
import { WalletInfoPanelHeader } from './WalletInfoPanelHeader';
import {
  WalletInfoPanelInlineMarketsToggle,
  WalletInfoPanelMarketsSection,
  WalletInfoPanelSummarySection,
  WalletInfoPanelTradesSection,
} from './WalletInfoPanelSections';
import { polymarketNicknameFromEmbed, polymarketNicknameTrim } from './walletInfoPanelSummaryGrid';

export type WalletInfoPanelVariant = 'modal' | 'inline';

const WalletInfoPanelShell = memo(function WalletInfoPanelShell({
  variant,
  overlayZClass,
  onClose,
  children,
}: {
  variant: WalletInfoPanelVariant;
  overlayZClass: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (variant === 'inline') {
    return (
      <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
        {children}
      </div>
    );
  }

  return (
    <div
      className={`fixed inset-0 bg-black/60 ${overlayZClass} flex items-center justify-center`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg p-3 w-full mx-4 shadow-xl border border-gray-700 max-w-[min(98vw,93.6rem)] max-h-[88vh] min-h-[50vh] flex flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
});

const WalletInfoPanelInner = memo(function WalletInfoPanelInner({
  open,
  wallet,
  initialMarketId,
  focusMarketId,
  focusMarketSeq = 0,
  onClose,
  variant = 'modal',
  onInlineMarketsListOpenChange,
  overlayZClass = 'z-[49999]',
  toxicFlowMarketId = '',
}: {
  open: boolean;
  wallet: string;
  initialMarketId?: string;
  focusMarketId?: string;
  focusMarketSeq?: number;
  onClose: () => void;
  variant?: WalletInfoPanelVariant;
  onInlineMarketsListOpenChange?: (open: boolean) => void;
  overlayZClass?: string;
  toxicFlowMarketId?: string;
}) {
  const [marketById, setMarketById] = useState<Record<string, Market>>({});
  const [summary, setSummary] = useState<WalletSummary | null | undefined>(undefined);
  const [markets, setMarkets] = useState<WalletPosition[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [fillsRefreshToken, setFillsRefreshToken] = useState(0);
  const [dailySnapshotsRefresh, setDailySnapshotsRefresh] = useState(0);
  const [profileNickname, setProfileNickname] = useState('');
  const [inlineMarketsListOpen, setInlineMarketsListOpen] = useState(false);
  const isInlineWalletInfo = variant === 'inline';
  const showMarketsList = !isInlineWalletInfo || inlineMarketsListOpen;

  const loadMarketsAndSelect = useCallback(
    async (preserveSelected: string | null) => {
      if (!wallet) return '';
      const prefRaw = (initialMarketId || '').trim();
      const pref = prefRaw.toLowerCase();
      const [s, p] = await Promise.all([
        fetchWalletSummary(wallet),
        fetchWalletPositions({ wallet, limit: 1000, ledger: true, order: 'end_date_desc' }),
      ]);
      setSummary(s);
      const sorted = sortWalletPositionsByDisplayedDateDesc(p.positions || [], buildMarketByIdRecord(useAppStore.getState().marketLookup));
      const byId = enrichMarketByIdFromWalletPositions(useAppStore.getState().marketLookup, sorted);
      setMarketById(byId);
      setMarkets(sorted);
      let pick = '';
      if (preserveSelected && sorted.some((row) => row.marketId === preserveSelected)) {
        pick = preserveSelected;
      } else if (pref) {
        const hit = sorted.find((row) => String(row.marketId || '').trim().toLowerCase() === pref);
        if (hit) pick = hit.marketId;
        else pick = prefRaw;
      }
      if (!pick && sorted.length > 0) pick = sorted[0].marketId;
      setSelectedMarketId(pick);
      return pick;
    },
    [wallet, initialMarketId],
  );

  const prevFocusMarketSeqRef = useRef(0);

  useEffect(() => {
    if (!open || !wallet) return;
    setSummary(undefined);
    setMarkets([]);
    setSelectedMarketId('');
    setInlineMarketsListOpen(false);
    setFillsRefreshToken(0);
    setDailySnapshotsRefresh(0);
    prevFocusMarketSeqRef.current = 0;
    setLoadingMarkets(true);
    (async () => {
      try {
        await loadMarketsAndSelect(null);
      } finally {
        setLoadingMarkets(false);
      }
    })();
  }, [open, wallet, initialMarketId, loadMarketsAndSelect]);

  useEffect(() => {
    if (!open || !wallet || !focusMarketSeq || focusMarketSeq === prevFocusMarketSeqRef.current) return;
    prevFocusMarketSeqRef.current = focusMarketSeq;
    const prefRaw = (focusMarketId || initialMarketId || '').trim();
    if (!prefRaw) return;
    const prefLc = prefRaw.toLowerCase();
    const hit = markets.find((row) => String(row.marketId || '').trim().toLowerCase() === prefLc);
    setSelectedMarketId(hit ? hit.marketId : prefRaw);
    setFillsRefreshToken((n) => n + 1);
  }, [focusMarketSeq, focusMarketId, initialMarketId, open, wallet, markets]);

  useEffect(() => {
    if (!isInlineWalletInfo) return;
    onInlineMarketsListOpenChange?.(inlineMarketsListOpen);
  }, [isInlineWalletInfo, inlineMarketsListOpen, onInlineMarketsListOpenChange]);

  useEffect(() => {
    if (!open || !wallet.trim()) {
      setProfileNickname('');
      return;
    }
    let cancelled = false;
    void fetchPolymarketNickname(wallet.trim()).then((nick) => {
      if (!cancelled) setProfileNickname(nick);
    });
    return () => {
      cancelled = true;
    };
  }, [open, wallet]);

  const onRefreshMarketsAndTrades = useCallback(async () => {
    if (!open || !wallet) return;
    setLoadingMarkets(true);
    try {
      await loadMarketsAndSelect(selectedMarketId);
      setFillsRefreshToken((n) => n + 1);
      setDailySnapshotsRefresh((n) => n + 1);
    } finally {
      setLoadingMarkets(false);
    }
  }, [open, wallet, selectedMarketId, loadMarketsAndSelect]);

  const onMarketRowClick = useCallback((id: string) => {
    setSelectedMarketId(id);
  }, []);

  const summaryLeftRef = useRef<HTMLDivElement>(null);
  const [summaryLeftH, setSummaryLeftH] = useState(0);
  const [lgChartsSync, setLgChartsSync] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );

  useLayoutEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setLgChartsSync(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const el = summaryLeftRef.current;
    if (!el) return;
    const measure = () => setSummaryLeftH(Math.round(el.getBoundingClientRect().height));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [open, summary, wallet, lgChartsSync, dailySnapshotsRefresh]);

  useEffect(() => {
    if (!open || !wallet.trim()) return;
    const k = wallet.trim().toLowerCase();
    if (!readToxicFavouriteWallets().has(k)) return;
    const polymarketNick = (() => {
      const fromSummary = polymarketNicknameTrim(summary?.polymarketNickname);
      if (fromSummary) return fromSummary;
      const fromProfile = polymarketNicknameTrim(profileNickname);
      if (fromProfile) return fromProfile;
      for (const row of markets) {
        const n = polymarketNicknameFromEmbed(row.walletLedgerSummary);
        if (n) return n;
      }
      return '';
    })();
    recordToxicFavouriteNicknamesFromRows(markets, new Set([k]));
    if (polymarketNick) setToxicFavouriteNickname(k, polymarketNick);
  }, [open, wallet, summary, profileNickname, markets]);

  const toggleInlineMarketsList = useCallback(() => {
    setInlineMarketsListOpen((v) => !v);
  }, []);

  if (!open) return null;

  return (
    <WalletInfoPanelShell variant={variant} overlayZClass={overlayZClass} onClose={onClose}>
      <WalletInfoPanelHeader
        wallet={wallet}
        summary={summary}
        markets={markets}
        profileNickname={profileNickname}
        onClose={onClose}
      />
      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
        <WalletInfoPanelSummarySection
          wallet={wallet}
          summary={summary}
          loadingMarkets={loadingMarkets}
          onRefresh={onRefreshMarketsAndTrades}
          dailySnapshotsRefresh={dailySnapshotsRefresh}
          summaryLeftRef={summaryLeftRef}
          summaryLeftH={summaryLeftH}
          lgChartsSync={lgChartsSync}
        />
        <div
          className={
            isInlineWalletInfo
              ? 'flex flex-1 min-h-0 overflow-hidden gap-0'
              : 'grid gap-2 flex-1 min-h-0 overflow-hidden'
          }
          style={
            isInlineWalletInfo
              ? undefined
              : { gridTemplateColumns: 'minmax(0, 1fr) minmax(16rem, 36rem)', gridTemplateRows: 'minmax(0, 1fr)' }
          }
        >
          {showMarketsList ? (
            <WalletInfoPanelMarketsSection
              wallet={wallet}
              markets={markets}
              marketById={marketById}
              loadingMarkets={loadingMarkets}
              selectedMarketId={selectedMarketId}
              onRowClick={onMarketRowClick}
              isInlineWalletInfo={isInlineWalletInfo}
            />
          ) : null}
          {isInlineWalletInfo ? (
            <WalletInfoPanelInlineMarketsToggle
              inlineMarketsListOpen={inlineMarketsListOpen}
              onToggle={toggleInlineMarketsList}
            />
          ) : null}
          <div className={`bg-gray-900 rounded p-2 min-h-0 h-full min-w-0 flex flex-col overflow-hidden${isInlineWalletInfo ? ' flex-1' : ''}`}>
            <WalletInfoPanelTradesSection
              open={open}
              wallet={wallet}
              selectedMarketId={selectedMarketId}
              marketById={marketById}
              markets={markets}
              toxicFlowMarketId={toxicFlowMarketId}
              fillsRefreshToken={fillsRefreshToken}
              focusMarketSeq={focusMarketSeq}
              variant={variant}
            />
          </div>
        </div>
      </div>
    </WalletInfoPanelShell>
  );
}, (a, b) =>
  a.open === b.open &&
  a.wallet === b.wallet &&
  a.initialMarketId === b.initialMarketId &&
  a.focusMarketId === b.focusMarketId &&
  a.focusMarketSeq === b.focusMarketSeq &&
  a.variant === b.variant &&
  a.overlayZClass === b.overlayZClass &&
  a.toxicFlowMarketId === b.toxicFlowMarketId &&
  a.onClose === b.onClose &&
  a.onInlineMarketsListOpenChange === b.onInlineMarketsListOpenChange);

export function WalletInfoPanel(props: {
  open: boolean;
  wallet: string;
  initialMarketId?: string;
  focusMarketId?: string;
  focusMarketSeq?: number;
  onClose: () => void;
  variant?: WalletInfoPanelVariant;
  overlayZClass?: string;
  toxicFlowMarketId?: string;
  onInlineMarketsListOpenChange?: (open: boolean) => void;
}) {
  return <WalletInfoPanelInner {...props} />;
}

export const InlineWalletInfoPanelHost = memo(function InlineWalletInfoPanelHost({
  wallet,
  initialMarketId,
  focusMarketId,
  focusMarketSeq,
  onClose,
  onInlineMarketsListOpenChange,
  toxicFlowMarketId,
}: {
  wallet: string;
  initialMarketId: string;
  focusMarketId: string;
  focusMarketSeq: number;
  onClose: () => void;
  onInlineMarketsListOpenChange?: (open: boolean) => void;
  toxicFlowMarketId: string;
}) {
  return (
    <WalletInfoPanelInner
      variant="inline"
      open
      wallet={wallet}
      initialMarketId={initialMarketId}
      focusMarketId={focusMarketId}
      focusMarketSeq={focusMarketSeq}
      onClose={onClose}
      onInlineMarketsListOpenChange={onInlineMarketsListOpenChange}
      toxicFlowMarketId={toxicFlowMarketId}
    />
  );
}, (a, b) =>
  a.wallet === b.wallet &&
  a.initialMarketId === b.initialMarketId &&
  a.focusMarketId === b.focusMarketId &&
  a.focusMarketSeq === b.focusMarketSeq &&
  a.toxicFlowMarketId === b.toxicFlowMarketId &&
  a.onClose === b.onClose &&
  a.onInlineMarketsListOpenChange === b.onInlineMarketsListOpenChange);

export function WalletInfoDialog({
  open,
  wallet,
  initialMarketId,
  focusMarketId,
  focusMarketSeq,
  onClose,
  overlayZClass,
  toxicFlowMarketId,
}: {
  open: boolean;
  wallet: string;
  initialMarketId?: string;
  focusMarketId?: string;
  focusMarketSeq?: number;
  onClose: () => void;
  overlayZClass?: string;
  toxicFlowMarketId?: string;
}) {
  if (!open) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <WalletInfoPanel
      open={open}
      wallet={wallet}
      initialMarketId={initialMarketId}
      focusMarketId={focusMarketId}
      focusMarketSeq={focusMarketSeq}
      onClose={onClose}
      variant="modal"
      overlayZClass={overlayZClass}
      toxicFlowMarketId={toxicFlowMarketId}
    />,
    document.body,
  );
}
