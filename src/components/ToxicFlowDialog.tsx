import React, {
  memo,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useSyncExternalStore,
  useLayoutEffect,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  TrendingUp,
  TrendingDown,
  Crown,
  UsersRound,
  ExternalLink,
  Copy,
  RefreshCw,
  Star,
  Bell,
  Sparkles,
  Trophy,
  CircleHelp,
  Fish,
  Triangle,
  ChevronLeft,
  ChevronRight,
  Zap,
} from 'lucide-react';
import {
  fetchToxicFlow,
  fetchMarketStakedLegs,
  mergeMarketStakedLegsResponse,
  walletSummaryFromLedgerEmbed,
  type MarketStakedLegsResponse,
  type ToxicFlowSwarm,
  type ToxicFlowData,
  type WalletPosition,
  type WalletSummary,
} from '../api';
import {
  readToxicFavouriteWallets,
  readToxicBellWallets,
  getToxicBellWalletsSnapshot,
  subscribeToxicBellWallets,
  TOXIC_FAVOURITE_WALLETS_LS_KEY,
  TOXIC_FAVOURITES_CHANGED_EVENT,
} from '../lib/toxicFavouriteWallets';
import {
  readToxicXWallets,
  TOXIC_X_WALLETS_LS_KEY,
  TOXIC_X_CHANGED_EVENT,
} from '../lib/toxicXWallets';
import { primeTiltAudioContextFromUserGesture } from '../lib/tiltNotifySound';
import {
  getNotifyBellMinStakeUsdSnapshot,
  readNotifyBellMinStakeUsd,
  subscribeNotifyBellMinStakeUsd,
  useToxicBellRowRingSound,
} from '../lib/toxicBellRowRing';
import {
  getMarketNotifyMutedSnapshot,
  isMarketNotifyMuted,
  subscribeMarketNotifyMuted,
} from '../lib/marketNotifyMute';
import { WS_BASE } from '../lib/env';
import { useAppStore } from '../stores/appStore';
import { InlineWalletInfoPanelHost, WalletInfoDialog } from './WalletInfoPanel';
export { WalletInfoDialog } from './WalletInfoPanel';
export type { WalletInfoPanelVariant } from './WalletInfoPanel';
import { fmtPriceShare } from './WalletLatestMarketsTradedTable';
import { ToxicFlowWalletTable as WalletTable, SwarmSidePill } from './ToxicFlowWalletTable';
import { HelperTooltip } from './HelperTooltip';
import { formatPolymarketVolumeK, formatThousandsAsK } from '../utils/format';
import { ToxicFlowTabsTip } from './ToxicFlowTabsTip';
import { ToxicFlowRowActionsTip } from './ToxicFlowRowActionsTip';
import { persistToxicFlowTabsTipDismissed, readToxicFlowTabsTipDismissed } from '../lib/toxicFlowTabsTip';
import {
  persistToxicFlowRowActionsTipDismissed,
  readToxicFlowRowActionsTipDismissed,
} from '../lib/toxicFlowRowActionsTip';
import { useSidebarToxicFlowData } from '../lib/sidebarToxicFlowStore';
import { useSidebarToxicFlowTabViews } from '../lib/sidebarToxicFlowTabViews';
import {
  STAKED_NET_EPS,
  walletInvY,
  walletInvN,
  walletNet,
  walletStakeTotalUsd,
  walletStakeNetSignedUsd,
  walletStakeNetAbsUsd,
  toxicCohortStakedNetSurplusHalves,
  stakedNetSortKeyDesc,
  stakedNetSortKeyAsc,
  stakeSortKeyDesc,
  toxicFlowPayloadEqual,
  clearToxicFlowTabWalletViewsCache,
  buildToxicFlowTabWalletViews,
  type ToxicFlowTabWalletViews,
  ledgerWinRateFracFromStored,
  toxicRowMatchesSmartLedgerDefinition,
  toxicRowMissingWalletScoresLedgerEmbed,
  toxicRowLedgerLifetimePnlNegative,
  toxicRowSortWinRateFrac,
  toxicRowResolvedStatsLow,
  toxicFlowStakeStripWalletLists,
  toxicFlowSwarmsToWalletRows,
  toxicFlowSwarmByRowWallet,
  toxicSwarmDisplaySlot,
  toxicSwarmTimeSlot,
  swarmMarketActiveUnixFromMeta,
  swarmMarketDurationSecFromMeta,
} from '../lib/toxicFlowStakeCohort';
import { upDownTimeframeKeyFromMarket } from '../utils/format';
import {
  readTiltWhaleAmountUsd,
  DEFAULT_TILT_WHALE_AMOUNT_USD,
  TILT_WHALE_AMOUNT_USD_CHANGED_EVENT,
  TILT_WHALE_AMOUNT_USD_LS_KEY,
} from '../lib/tiltWhaleAmountUsd';
import { useNotifyTiltAppliesToSelectedMarket } from '../lib/notifyTiltMarketFilters';
import {
  applyToxicFlowWSMessage,
  marketConditionKeysEqual,
  toxicFlowFullSnapshot,
  type ToxicFlowWSMessage,
} from '../lib/toxicFlowWs';
import { TOXIC_TABLE_ROW_CLS } from '../lib/toxicFlowTableAnimate';
import {
  readToxicFlowLayoutMode,
  persistToxicFlowLayoutMode,
  type ToxicFlowLayoutMode,
} from '../lib/toxicFlowLayoutMode';
import { ToxicFlowResizableStack } from './ToxicFlowResizableStack';
import {
  persistToxicFlowPaneTab,
  readToxicFlowPaneTab,
  type ToxicFlowTabId,
} from '../lib/toxicFlowPaneTabs';

function subscribeTiltWhaleAmountUsd(listener: () => void): () => void {
  const onCustom = () => listener();
  const onStorage = (e: StorageEvent) => {
    if (e.key === TILT_WHALE_AMOUNT_USD_LS_KEY || e.key === null) listener();
  };
  window.addEventListener(TILT_WHALE_AMOUNT_USD_CHANGED_EVENT, onCustom);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(TILT_WHALE_AMOUNT_USD_CHANGED_EVENT, onCustom);
    window.removeEventListener('storage', onStorage);
  };
}

interface ToxicFlowDialogProps {
  open: boolean;
  marketId: string;
  marketName: string;
  yesTokenId?: string;
  noTokenId?: string;
  marketExpired?: boolean;
  onClose: () => void;
  /** In-sidebar panel: no modal backdrop; fills parent flex column. */
  embedded?: boolean;
  /**
   * When `embedded`, pass Sidebar `useToxicFlowMarketStream` — avoids a second `/ws/toxic-flow` + duplicate
   * 1–2k wallet row graphs retained in closures (MessageEvent / Function churn in heap snapshots).
   */
  streamData?: ToxicFlowData | null;
  /** Embedded: pre-built tab views (shared with SidebarToxicStrips cache). */
  streamTabWalletViews?: ToxicFlowTabWalletViews | null;
  /** Embedded panel: HTTP full refresh from parent stream hook. */
  onRefreshStream?: () => void | Promise<void>;
  streamRefreshing?: boolean;
  /** Embedded sidebar: sync parent width with inline wallet panel slide (≥1920px). */
  onInlineWalletExtraWidthChange?: (width: string) => void;
}

const TOXIC_INLINE_WALLET_WIDTH = '84rem';
const TOXIC_INLINE_WALLET_WIDTH_COMPACT = '42rem';
const TOXIC_INLINE_WALLET_MS = 250;

type Tab = ToxicFlowTabId;

const TOXIC_FLOW_TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'topHolders', label: 'Top', icon: <Crown size={11} /> },
  { key: 'swarms', label: 'Swarms', icon: <Zap size={11} /> },
  { key: 'smart', label: 'Smart', icon: <Sparkles size={11} /> },
  { key: 'favourites', label: 'Stars', icon: <Star size={11} /> },
  { key: 'whales', label: 'Whales', icon: <Fish size={11} /> },
  {
    key: 'favWhales',
    label: 'Stars & Whales',
    icon: (
      <span className="inline-flex items-center gap-px">
        <Star size={10} className="fill-current text-current" />
        <Fish size={10} />
      </span>
    ),
  },
  { key: 'winners', label: 'Greens', icon: <Trophy size={11} /> },
  { key: 'fresh', label: 'Fresh', icon: <CircleHelp size={11} /> },
  { key: 'topYes', label: 'Top YES', icon: <TrendingUp size={11} /> },
  { key: 'topNo', label: 'Top NO', icon: <TrendingDown size={11} /> },
];

function toxicFlowWalletsForTab(
  views: ToxicFlowTabWalletViews,
  tab: Tab,
): { wallets: WalletPosition[]; label: string } {
  switch (tab) {
    case 'topHolders':
      return { wallets: views.topHolders, label: 'holders' };
    case 'smart':
      return { wallets: views.smart, label: 'smart' };
    case 'favourites':
      return { wallets: views.favourites, label: 'favourites' };
    case 'whales':
      return { wallets: views.whales, label: 'whales' };
    case 'favWhales':
      return { wallets: views.favWhales, label: 'fav + whales' };
    case 'winners':
      return { wallets: views.winners, label: 'greens' };
    case 'fresh':
      return { wallets: views.stripLists.fresh, label: 'fresh' };
    case 'topYes':
      return { wallets: views.topYes, label: 'Net Y (Staked)' };
    case 'topNo':
      return { wallets: views.topNo, label: 'Net N (Staked)' };
    case 'swarms':
      return { wallets: [], label: 'swarms' };
  }
}

const ToxicFlowSwarmsPane = memo(function ToxicFlowSwarmsPane({
  swarms,
  marketId,
  totalStakedNetUsd,
  onOpenWallet,
  rowActionsTipOpen = false,
  onDismissRowActionsTip,
  rowActionsAnchorRef,
}: {
  swarms: ToxicFlowSwarm[];
  marketId: string;
  totalStakedNetUsd: number | null;
  onOpenWallet: (wallet: string, netShares?: number) => void;
  rowActionsTipOpen?: boolean;
  onDismissRowActionsTip?: () => void;
  rowActionsAnchorRef?: RefObject<HTMLTableCellElement>;
}) {
  const [detailRowWallet, setDetailRowWallet] = useState<string | null>(null);
  const [hoveredSwarmWallet, setHoveredSwarmWallet] = useState<string | null>(null);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const swarmUpDownMarket = useMemo(
    () =>
      !!(
        selectedMarket?.question?.match(/up\s+or\s+down/i) ||
        selectedMarket?.eventSlug?.match(/up-or-down|updown/i)
      ),
    [selectedMarket?.question, selectedMarket?.eventSlug],
  );
  const marketActiveUnix = useMemo(() => {
    if (!selectedMarket) return 0;
    const mid = marketId.trim();
    const sid = String(selectedMarket.id ?? '').trim();
    const cid = String(selectedMarket.conditionId ?? '').trim().toLowerCase();
    if (mid && sid !== mid && cid !== mid.toLowerCase()) return 0;
    return swarmMarketActiveUnixFromMeta(
      selectedMarket.eventSlug,
      selectedMarket.endDate,
      upDownTimeframeKeyFromMarket(selectedMarket) ?? undefined,
    );
  }, [selectedMarket, marketId]);
  const marketDurationSec = useMemo(() => {
    if (!selectedMarket) return 0;
    const mid = marketId.trim();
    const sid = String(selectedMarket.id ?? '').trim();
    const cid = String(selectedMarket.conditionId ?? '').trim().toLowerCase();
    if (mid && sid !== mid && cid !== mid.toLowerCase()) return 0;
    return swarmMarketDurationSecFromMeta(
      selectedMarket.eventSlug,
      selectedMarket.endDate,
      upDownTimeframeKeyFromMarket(selectedMarket) ?? undefined,
    );
  }, [selectedMarket, marketId]);
  const rows = useMemo(
    () => toxicFlowSwarmsToWalletRows(swarms, marketId, marketActiveUnix),
    [swarms, marketId, marketActiveUnix],
  );
  const detailSwarm = useMemo(
    () => (detailRowWallet ? toxicFlowSwarmByRowWallet(swarms, detailRowWallet) : null),
    [swarms, detailRowWallet],
  );
  const swarmHighlightSlot = useMemo(() => {
    if (!hoveredSwarmWallet) return null;
    const s = toxicFlowSwarmByRowWallet(swarms, hoveredSwarmWallet);
    if (!s) return null;
    return marketActiveUnix > 0
      ? toxicSwarmTimeSlot(s.startTime, marketActiveUnix)
      : toxicSwarmDisplaySlot(s, marketActiveUnix);
  }, [hoveredSwarmWallet, swarms, marketActiveUnix]);
  const detailPositions = detailSwarm?.positions ?? [];
  const detailStakedTotal = useMemo(() => {
    let sum = 0;
    for (const w of detailPositions) {
      const v = walletStakeNetAbsUsd(w);
      if (Number.isFinite(v)) sum += v;
    }
    return sum > 0 ? sum : null;
  }, [detailPositions]);
  if (rows.length === 0) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center text-[11px] text-gray-500">
        No swarms detected in this market.
      </div>
    );
  }
  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
      <WalletTable
        wallets={rows}
        label="swarms"
        variant="swarms"
        totalStakedNetUsd={totalStakedNetUsd}
        onOpenWallet={onOpenWallet}
        rowActionsTipOpen={rowActionsTipOpen}
        onDismissRowActionsTip={onDismissRowActionsTip}
        rowActionsAnchorRef={rowActionsAnchorRef}
        onRowClick={(wallet) => setDetailRowWallet(wallet)}
        selectedWallet={detailRowWallet}
        swarmsChart={swarms}
        marketActiveUnixForChart={marketActiveUnix}
        marketDurationSecForChart={marketDurationSec}
        swarmHighlightSlot={swarmHighlightSlot}
        onSwarmRowHover={setHoveredSwarmWallet}
      />
      {detailSwarm && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[60030] bg-black/70 flex items-center justify-center p-3"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setDetailRowWallet(null);
              }}
            >
              <div
                className="bg-gray-900 border border-gray-600 rounded-lg shadow-xl w-full max-w-[min(96rem,96vw)] h-[min(82vh,720px)] flex flex-col min-h-0"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-700 shrink-0">
                  <div className="flex items-center gap-2 min-w-0 text-sm font-bold text-white truncate">
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <span>
                        Swarm #{toxicSwarmDisplaySlot(detailSwarm, marketActiveUnix)} ({detailSwarm.walletCount})
                      </span>
                      <SwarmSidePill side={detailSwarm.side} upDown={swarmUpDownMarket} />
                    </span>
                    <span className="text-[10px] font-normal text-gray-500">
                      {detailPositions.length} with position
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailRowWallet(null)}
                    className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white shrink-0"
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="flex flex-col flex-1 min-h-0 p-2">
                  {detailPositions.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center text-[11px] text-gray-500">
                      No open positions for swarm members in this market.
                    </div>
                  ) : (
                    <WalletTable
                      wallets={detailPositions}
                      label={`swarm ${detailSwarm.swarmId} wallets`}
                      totalStakedNetUsd={detailStakedTotal ?? totalStakedNetUsd}
                      onOpenWallet={onOpenWallet}
                    />
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
});

function ToxicFlowLayoutSwitch({
  mode,
  onMode,
}: {
  mode: ToxicFlowLayoutMode;
  onMode: (mode: ToxicFlowLayoutMode) => void;
}) {
  return (
    <div
      className="ml-auto shrink-0 inline-flex rounded border border-gray-600 overflow-hidden divide-x divide-gray-600 bg-gray-900/90"
      role="group"
      aria-label="Table layout"
    >
      <button
        type="button"
        className={`px-2 py-0.5 text-[9px] font-bold transition ${
          mode === 'single' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
        }`}
        title="Single table"
        onClick={() => onMode('single')}
      >
        1
      </button>
      <button
        type="button"
        className={`px-2 py-0.5 text-[9px] font-bold transition ${
          mode === 'split' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
        }`}
        title="Two tables stacked (50% height each)"
        onClick={() => onMode('split')}
      >
        2
      </button>
      <button
        type="button"
        className={`px-2 py-0.5 text-[9px] font-bold transition ${
          mode === 'triple' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
        }`}
        title="Three tables stacked (~33% height each)"
        onClick={() => onMode('triple')}
      >
        3
      </button>
    </div>
  );
}

function ToxicFlowTabBar({
  tab,
  onTab,
  trailing,
  barRef,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  trailing?: ReactNode;
  barRef?: RefObject<HTMLDivElement>;
}) {
  return (
    <div
      ref={barRef}
      className="flex gap-1 border-b border-gray-700 pb-2 shrink-0 flex-nowrap items-center min-w-0 w-full overflow-x-auto toxic-flow-scroll-stable"
    >
      {TOXIC_FLOW_TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onTab(t.key)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors shrink-0 ${
            tab === t.key ? 'bg-yellow-400/20 text-yellow-400' : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          {t.icon} {t.label}
        </button>
      ))}
      {trailing}
    </div>
  );
}

const ToxicFlowTablePane = memo(function ToxicFlowTablePane({
  tab,
  onTab,
  tabWalletViews,
  marketId,
  swarms,
  totalStakedNetUsd,
  onOpenWallet,
  trailing,
  tabBarRef,
  rowActionsTipOpen = false,
  onDismissRowActionsTip,
  rowActionsAnchorRef,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  tabWalletViews: ToxicFlowTabWalletViews;
  marketId: string;
  swarms: ToxicFlowSwarm[];
  totalStakedNetUsd: number | null;
  onOpenWallet: (wallet: string, netShares?: number) => void;
  trailing?: ReactNode;
  tabBarRef?: RefObject<HTMLDivElement>;
  rowActionsTipOpen?: boolean;
  onDismissRowActionsTip?: () => void;
  rowActionsAnchorRef?: RefObject<HTMLTableCellElement>;
}) {
  const { wallets, label } = toxicFlowWalletsForTab(tabWalletViews, tab);
  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden gap-2">
      <ToxicFlowTabBar tab={tab} onTab={onTab} trailing={trailing} barRef={tabBarRef} />
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden min-w-0">
        {tab === 'swarms' ? (
          <ToxicFlowSwarmsPane
            swarms={swarms}
            marketId={marketId}
            totalStakedNetUsd={totalStakedNetUsd}
            onOpenWallet={onOpenWallet}
            rowActionsTipOpen={rowActionsTipOpen}
            onDismissRowActionsTip={onDismissRowActionsTip}
            rowActionsAnchorRef={rowActionsAnchorRef}
          />
        ) : (
          <WalletTable
            wallets={wallets}
            label={label}
            totalStakedNetUsd={totalStakedNetUsd}
            onOpenWallet={onOpenWallet}
            rowActionsTipOpen={rowActionsTipOpen}
            onDismissRowActionsTip={onDismissRowActionsTip}
            rowActionsAnchorRef={rowActionsAnchorRef}
          />
        )}
      </div>
    </div>
  );
}, (a, b) => {
  if (
    a.tab !== b.tab ||
    a.onTab !== b.onTab ||
    a.onOpenWallet !== b.onOpenWallet ||
    a.trailing !== b.trailing ||
    a.totalStakedNetUsd !== b.totalStakedNetUsd ||
    a.swarms !== b.swarms
  ) {
    return false;
  }
  if (a.tab === 'swarms') return true;
  if (a.tabWalletViews === b.tabWalletViews) return true;
  const wa = toxicFlowWalletsForTab(a.tabWalletViews, a.tab).wallets;
  const wb = toxicFlowWalletsForTab(b.tabWalletViews, b.tab).wallets;
  if (wa === wb) return true;
  if (wa.length !== wb.length) return false;
  for (let i = 0; i < wa.length; i++) {
    if (wa[i] !== wb[i]) return false;
  }
  return true;
});

function rPnlToneClass(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return 'text-gray-400';
  return v > 0 ? 'text-green-400' : 'text-red-400';
}

/** `roi` from API is decimal (0.12 → 12%). */
function fmtRoiPercent(roi: number | undefined): { text: string; tone: string } {
  if (roi == null || !Number.isFinite(roi)) return { text: '–', tone: 'text-gray-500' };
  const pct = roi * 100;
  const s = pct >= 0 ? '+' : '';
  const tone = Math.abs(roi) < 1e-12 ? 'text-gray-400' : roi > 0 ? 'text-green-400' : 'text-red-400';
  const txt = pct.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return { text: `${s}${txt}%`, tone };
}

function fmtIntEn(n: number): string {
  if (!Number.isFinite(n)) return '–';
  return Math.trunc(n).toLocaleString('en-US');
}

function fmtUsdSignedLedger(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const s = v >= 0 ? '+' : '−';
  const a = Math.abs(v);
  return `${s}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtUsd2En(absVal: number): string {
  if (!Number.isFinite(absVal)) return '–';
  return absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


const TOXIC_INLINE_WALLET_MIN_WIDTH_PX = 1920;

function useMinWidth1920(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia(`(min-width: ${TOXIC_INLINE_WALLET_MIN_WIDTH_PX}px)`);
      mq.addEventListener('change', onStoreChange);
      return () => mq.removeEventListener('change', onStoreChange);
    },
    () => window.matchMedia(`(min-width: ${TOXIC_INLINE_WALLET_MIN_WIDTH_PX}px)`).matches,
    () => false,
  );
}

export function ToxicFlowDialog(props: ToxicFlowDialogProps) {
  return <ToxicFlowDialogInner {...props} />;
}

function useToxicDialogStakedNetAbsUsd(yesTokenId: string, marketId: string, open: boolean): number | null {
  const yesTok = yesTokenId.trim();
  const stakedWyLive = useAppStore((s) => {
    if (!yesTok) return NaN;
    const v = s.marketLookup[yesTok]?.stakedUsdYesLeg;
    return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  });
  const stakedWnLive = useAppStore((s) => {
    if (!yesTok) return NaN;
    const v = s.marketLookup[yesTok]?.stakedUsdNoLeg;
    return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  });
  const stakedSumAbsLive = useAppStore((s) => {
    if (!yesTok) return NaN;
    const v = s.marketLookup[yesTok]?.stakedSumAbsSignedNetUsd;
    return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  });
  const [marketStakedLegsRest, setMarketStakedLegsRest] = useState<MarketStakedLegsResponse | null>(null);

  const liveStakedLegUsd = useMemo(() => {
    if (!Number.isFinite(stakedWyLive) || !Number.isFinite(stakedWnLive)) return null;
    const row: MarketStakedLegsResponse = { stakedUsdYesLeg: stakedWyLive, stakedUsdNoLeg: stakedWnLive };
    if (Number.isFinite(stakedSumAbsLive)) {
      row.stakedSumAbsSignedNetUsd = stakedSumAbsLive;
    }
    return row;
  }, [stakedWyLive, stakedWnLive, stakedSumAbsLive]);

  useEffect(() => {
    const mid = (marketId || '').trim();
    if (!open || !mid) {
      setMarketStakedLegsRest(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchMarketStakedLegs(mid);
        if (!cancelled) setMarketStakedLegsRest(row);
      } catch {
        if (!cancelled) setMarketStakedLegsRest(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, marketId]);

  const dialogMarketStakedLegs = useMemo(
    () => mergeMarketStakedLegsResponse(liveStakedLegUsd, marketStakedLegsRest),
    [liveStakedLegUsd, marketStakedLegsRest],
  );

  return useMemo(() => {
    if (!dialogMarketStakedLegs) return null;
    const n = dialogMarketStakedLegs.stakedSumAbsSignedNetUsd;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  }, [dialogMarketStakedLegs]);
}

const ToxicFlowStakedStatCell = memo(function ToxicFlowStakedStatCell({
  yesTokenId,
  marketId,
  open,
}: {
  yesTokenId: string;
  marketId: string;
  open: boolean;
}) {
  const dialogStakedNetAbsUsd = useToxicDialogStakedNetAbsUsd(yesTokenId, marketId, open);
  return (
    <div
      className="bg-gray-900 rounded p-1.5 text-center min-w-0"
      title="Σ_w |inv_y×px_y − inv_n×px_n| over all wallets (same basis as per-wallet Staked). Old ‖Σ|YES USD| − Σ|NO USD|‖ shown only if sum field missing."
    >
      <div className="text-[10px] text-gray-500 truncate">Staked</div>
      <div className="text-sm font-bold text-yellow-400 tabular-nums truncate">
        {dialogStakedNetAbsUsd != null ? (
          <span title={`$${dialogStakedNetAbsUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}>
            ${formatPolymarketVolumeK(dialogStakedNetAbsUsd)}
      </span>
        ) : (
          '—'
        )}
      </div>
    </div>
  );
});

const ToxicFlowDialogTableStack = memo(function ToxicFlowDialogTableStack({
  yesTokenId,
  noTokenId,
  marketId,
  open,
  marketExpired = false,
  tabWalletViews,
  swarms,
  layoutMode,
  tab,
  tabBottom,
  tabThird,
  setTab,
  setTabBottom,
  setTabThird,
  openWalletDialog,
  layoutSwitch,
  tabsTipOpen = false,
  onDismissTabsTip,
  tabsBarRef,
  rowActionsTipOpen = false,
  onDismissRowActionsTip,
  rowActionsAnchorRef,
}: {
  yesTokenId: string;
  noTokenId?: string;
  marketId: string;
  open: boolean;
  marketExpired?: boolean;
  tabWalletViews: ToxicFlowTabWalletViews;
  swarms: ToxicFlowSwarm[];
  layoutMode: ToxicFlowLayoutMode;
  tab: Tab;
  tabBottom: Tab;
  tabThird: Tab;
  setTab: (tab: Tab) => void;
  setTabBottom: (tab: Tab) => void;
  setTabThird: (tab: Tab) => void;
  openWalletDialog: (wallet: string, netShares?: number) => void;
  layoutSwitch: ReactNode;
  tabsTipOpen?: boolean;
  onDismissTabsTip?: () => void;
  tabsBarRef?: RefObject<HTMLDivElement>;
  rowActionsTipOpen?: boolean;
  onDismissRowActionsTip?: () => void;
  rowActionsAnchorRef?: RefObject<HTMLTableCellElement>;
}) {
  const totalStakedNetUsd = useToxicDialogStakedNetAbsUsd(yesTokenId, marketId, open);
  const bellWalletsKey = useSyncExternalStore(
    subscribeToxicBellWallets,
    getToxicBellWalletsSnapshot,
    () => '',
  );
  const bellMinStakeKey = useSyncExternalStore(
    subscribeNotifyBellMinStakeUsd,
    getNotifyBellMinStakeUsdSnapshot,
    () => '100',
  );
  const mutedMarketsKey = useSyncExternalStore(
    subscribeMarketNotifyMuted,
    getMarketNotifyMutedSnapshot,
    () => '[]',
  );
  const marketNotifyMuted = useMemo(
    () => isMarketNotifyMuted(marketId),
    [marketId, mutedMarketsKey],
  );
  const tiltNotifyApplies = useNotifyTiltAppliesToSelectedMarket();
  const bellFlashingRowCount = useMemo(() => {
    const bellWallets = readToxicBellWallets();
    const floor = readNotifyBellMinStakeUsd();
    let count = 0;
    for (const w of toxicFlowWalletsForTab(tabWalletViews, 'topHolders').wallets) {
      const k = (w.wallet || '').trim().toLowerCase();
      if (!k || !bellWallets.has(k)) continue;
      if (floor > 0 && walletStakeNetAbsUsd(w) < floor) continue;
      count += 1;
    }
    return count;
  }, [tabWalletViews, bellWalletsKey, bellMinStakeKey]);
  useToxicBellRowRingSound(
    bellFlashingRowCount,
    open && !marketNotifyMuted && !marketExpired && tiltNotifyApplies,
    yesTokenId,
    noTokenId,
  );
  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden mt-2 bg-gray-900/60 rounded p-2 w-full">
      {layoutMode === 'single' && (
        <ToxicFlowTablePane
          tab={tab}
          onTab={setTab}
          tabWalletViews={tabWalletViews}
          marketId={marketId}
          swarms={swarms}
          totalStakedNetUsd={totalStakedNetUsd}
          onOpenWallet={openWalletDialog}
          trailing={layoutSwitch}
          tabBarRef={tabsBarRef}
          rowActionsTipOpen={rowActionsTipOpen}
          onDismissRowActionsTip={onDismissRowActionsTip}
          rowActionsAnchorRef={rowActionsAnchorRef}
        />
      )}
      {layoutMode === 'split' && (
        <ToxicFlowResizableStack layoutKey="split">
          <ToxicFlowTablePane
            tab={tab}
            onTab={setTab}
            tabWalletViews={tabWalletViews}
            marketId={marketId}
            swarms={swarms}
            totalStakedNetUsd={totalStakedNetUsd}
            onOpenWallet={openWalletDialog}
            trailing={layoutSwitch}
            tabBarRef={tabsBarRef}
            rowActionsTipOpen={rowActionsTipOpen}
            onDismissRowActionsTip={onDismissRowActionsTip}
            rowActionsAnchorRef={rowActionsAnchorRef}
          />
          <ToxicFlowTablePane
            tab={tabBottom}
            onTab={setTabBottom}
            tabWalletViews={tabWalletViews}
            marketId={marketId}
            swarms={swarms}
            totalStakedNetUsd={totalStakedNetUsd}
            onOpenWallet={openWalletDialog}
          />
        </ToxicFlowResizableStack>
      )}
      {layoutMode === 'triple' && (
        <ToxicFlowResizableStack layoutKey="triple">
          <ToxicFlowTablePane
            tab={tab}
            onTab={setTab}
            tabWalletViews={tabWalletViews}
            marketId={marketId}
            swarms={swarms}
            totalStakedNetUsd={totalStakedNetUsd}
            onOpenWallet={openWalletDialog}
            trailing={layoutSwitch}
            tabBarRef={tabsBarRef}
            rowActionsTipOpen={rowActionsTipOpen}
            onDismissRowActionsTip={onDismissRowActionsTip}
            rowActionsAnchorRef={rowActionsAnchorRef}
          />
          <ToxicFlowTablePane
            tab={tabBottom}
            onTab={setTabBottom}
            tabWalletViews={tabWalletViews}
            marketId={marketId}
            swarms={swarms}
            totalStakedNetUsd={totalStakedNetUsd}
            onOpenWallet={openWalletDialog}
          />
          <ToxicFlowTablePane
            tab={tabThird}
            onTab={setTabThird}
            tabWalletViews={tabWalletViews}
            marketId={marketId}
            swarms={swarms}
            totalStakedNetUsd={totalStakedNetUsd}
            onOpenWallet={openWalletDialog}
          />
        </ToxicFlowResizableStack>
      )}
      {tabsBarRef && onDismissTabsTip ? (
        <ToxicFlowTabsTip anchorRef={tabsBarRef} open={tabsTipOpen} onDismiss={onDismissTabsTip} />
      ) : null}
    </div>
  );
}, (a, b) => {
  if (
    a.yesTokenId !== b.yesTokenId ||
    a.marketId !== b.marketId ||
    a.open !== b.open ||
    a.layoutMode !== b.layoutMode ||
    a.tab !== b.tab ||
    a.tabBottom !== b.tabBottom ||
    a.tabThird !== b.tabThird ||
    a.setTab !== b.setTab ||
    a.setTabBottom !== b.setTabBottom ||
    a.setTabThird !== b.setTabThird ||
    a.openWalletDialog !== b.openWalletDialog ||
    a.swarms !== b.swarms ||
    a.layoutSwitch !== b.layoutSwitch ||
    a.tabsTipOpen !== b.tabsTipOpen ||
    a.onDismissTabsTip !== b.onDismissTabsTip ||
    a.tabsBarRef !== b.tabsBarRef ||
    a.rowActionsTipOpen !== b.rowActionsTipOpen ||
    a.onDismissRowActionsTip !== b.onDismissRowActionsTip ||
    a.rowActionsAnchorRef !== b.rowActionsAnchorRef
  ) {
    return false;
  }
  if (a.tabWalletViews === b.tabWalletViews) return true;
  const va = a.tabWalletViews;
  const vb = b.tabWalletViews;
  const keys = ['topYes', 'topNo', 'topHolders', 'smart', 'favourites', 'whales', 'favWhales', 'winners'] as const;
  for (const k of keys) {
    const wa = va[k];
    const wb = vb[k];
    if (wa === wb) continue;
    if (wa.length !== wb.length) return false;
    for (let i = 0; i < wa.length; i++) {
      if (wa[i] !== wb[i]) return false;
    }
  }
  return true;
});

const ToxicFlowDialogLoadingLine = memo(function ToxicFlowDialogLoadingLine({
  open,
  marketId,
  loadingOverride,
}: {
  open: boolean;
  marketId: string;
  loadingOverride?: boolean;
}) {
  const storeData = useSidebarToxicFlowData();
  const loading =
    loadingOverride ?? Boolean(open && marketId.trim() && storeData === null);
  if (!loading) return null;
  return <div className="text-gray-500 text-center py-8 shrink-0">Loading on-chain data...</div>;
});

const ToxicFlowDialogStatsGrid = memo(function ToxicFlowDialogStatsGrid({
  yesTokenId,
  marketId,
  open,
  data: dataOverride,
}: {
  yesTokenId: string;
  marketId: string;
  open: boolean;
  data?: ToxicFlowData | null;
}) {
  const storeData = useSidebarToxicFlowData();
  const data = dataOverride !== undefined ? dataOverride : storeData;
  if (!data) return null;
  return (
    <div className="shrink-0 grid grid-cols-6 gap-1.5 min-w-0 w-full mb-2">
      <div className="bg-gray-900 rounded p-1.5 text-center min-w-0">
        <div className="text-[10px] text-gray-500 truncate">Wallets</div>
        <div className="text-sm font-bold text-white tabular-nums" title={String(data.totalWallets)}>
          {formatThousandsAsK(data.totalWallets)}
        </div>
      </div>
      <div className="bg-gray-900 rounded p-1.5 text-center min-w-0">
        <div className="text-[10px] text-gray-500 truncate">On-chain Fills</div>
        <div className="text-sm font-bold text-white tabular-nums" title={String(data.totalTrades)}>
          {formatThousandsAsK(data.totalTrades)}
        </div>
      </div>
      <div className="bg-gray-900 rounded p-1.5 text-center min-w-0">
        <div className="text-[10px] text-gray-500 truncate">USDC Volume</div>
        <div
          className="text-sm font-bold text-yellow-400 tabular-nums truncate"
          title={`$${data.totalUsdcIn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        >
          ${formatPolymarketVolumeK(data.totalUsdcIn)}
        </div>
      </div>
      <ToxicFlowStakedStatCell yesTokenId={yesTokenId} marketId={marketId} open={open} />
      <div className="bg-gray-900 rounded p-1.5 text-center min-w-0">
        <div className="text-[10px] text-gray-500 truncate">Concentration</div>
        <div className={`text-sm font-bold ${data.concentration > 0.5 ? 'text-red-400' : data.concentration > 0.3 ? 'text-yellow-400' : 'text-green-400'}`}>
          {(data.concentration * 100).toFixed(0)}%
        </div>
      </div>
      <div className="bg-gray-900 rounded p-1.5 text-center min-w-0">
        <div className="text-[10px] text-gray-500 truncate">Total Shares</div>
        <div
          className="text-sm font-bold text-gray-200 tabular-nums truncate"
          title={String(Math.floor(data.totalShares || 0))}
        >
          {formatThousandsAsK(Math.floor(data.totalShares || 0))}
        </div>
      </div>
    </div>
  );
});

const ToxicFlowDialogZeroWalletsHelp = memo(function ToxicFlowDialogZeroWalletsHelp({
  data: dataOverride,
}: {
  data?: ToxicFlowData | null;
}) {
  const storeData = useSidebarToxicFlowData();
  const data = dataOverride !== undefined ? dataOverride : storeData;
  if (!data || data.totalWallets !== 0) return null;
  return (
    <div className="rounded p-3 bg-gray-900 space-y-1.5 text-[10px] text-gray-500">
      {data.polygonWssConfigured === false && (
        <p className="text-amber-400/95">
          On-chain collection is off: polycandles needs <span className="font-mono">POLYGON_WSS_URL</span> (Polygon JSON-RPC WebSocket). Check server logs and{' '}
          <span className="font-mono">/api/onchain-status</span>.
        </p>
      )}
      {data.polygonWssConfigured === true && (data.orderFilledEventsProcessed ?? 0) === 0 && (
        <p>
          Polygon WSS is configured but no <span className="font-mono">OrderFilled</span> events have been processed yet — verify the endpoint, subscription, and that trading is happening on tracked contracts.
        </p>
      )}
      {data.polygonWssConfigured === true &&
        (data.orderFilledEventsProcessed ?? 0) > 0 &&
        (data.walletMarketTradesForMarket ?? 0) === 0 && (
        <p>
          Events are ingesting globally, but no ledger trades are linked to this market in <span className="font-mono">wallet_fill_ledger</span> yet. Wait for the next Gamma sync (token map refreshes after each refresh), or confirm this market&apos;s CLOB token IDs are in the DB.
        </p>
      )}
      {(data.walletMarketTradesForMarket ?? 0) > 0 && (
        <p className="text-gray-400">
          {data.walletMarketTradesForMarket} trade(s) rolled up for this market; wallet rollups only appear after fills are matched to token IDs. If tables stay empty, check <span className="font-mono">wallet_market_positions</span> and server logs.
        </p>
      )}
      <p>
        Holders aggregates <span className="font-mono">wallet_market_positions</span> (ledger) for this market (not the CLOB orderbook). Data persists across restarts and backfills missed blocks automatically.
      </p>
    </div>
  );
});

const ToxicFlowDialogEmbeddedTableStack = memo(function ToxicFlowDialogEmbeddedTableStack({
  yesTokenId,
  noTokenId,
  marketId,
  open,
  marketExpired = false,
  layoutMode,
  tab,
  tabBottom,
  tabThird,
  setTabWithDismiss,
  setTabBottomWithDismiss,
  setTabThirdWithDismiss,
  openWalletDialog,
  layoutSwitch,
  toxicFollowSet,
  toxicXSet,
  tiltWhaleAmountUsd,
}: {
  yesTokenId: string;
  noTokenId?: string;
  marketId: string;
  open: boolean;
  marketExpired?: boolean;
  layoutMode: ToxicFlowLayoutMode;
  tab: Tab;
  tabBottom: Tab;
  tabThird: Tab;
  setTabWithDismiss: (tab: Tab) => void;
  setTabBottomWithDismiss: (tab: Tab) => void;
  setTabThirdWithDismiss: (tab: Tab) => void;
  openWalletDialog: (wallet: string, netShares?: number) => void;
  layoutSwitch: ReactNode;
  toxicFollowSet: ReadonlySet<string>;
  toxicXSet: ReadonlySet<string>;
  tiltWhaleAmountUsd: number;
}) {
  const tabWalletViews = useSidebarToxicFlowTabViews(toxicFollowSet, tiltWhaleAmountUsd, toxicXSet);
  const storeData = useSidebarToxicFlowData();
  const swarms = storeData?.swarms ?? [];
  const loading = Boolean(open && marketId.trim() && storeData === null);

  const tabsBarRef = useRef<HTMLDivElement>(null);
  const [tabsTipOpen, setTabsTipOpen] = useState(false);
  const dismissTabsTip = useCallback(() => {
    persistToxicFlowTabsTipDismissed();
    setTabsTipOpen(false);
  }, []);

  useEffect(() => {
    if (!open) {
      setTabsTipOpen(false);
      return;
    }
    if (readToxicFlowTabsTipDismissed()) {
      setTabsTipOpen(false);
      return;
    }
    if (loading || !tabWalletViews) {
      setTabsTipOpen(false);
      return;
    }
    setTabsTipOpen(true);
  }, [open, loading, tabWalletViews]);

  const rowActionsAnchorRef = useRef<HTMLTableCellElement>(null);
  const [rowActionsTipOpen, setRowActionsTipOpen] = useState(false);
  const dismissRowActionsTip = useCallback(() => {
    persistToxicFlowRowActionsTipDismissed();
    setRowActionsTipOpen(false);
  }, []);

  const primaryTabWalletCount = useMemo(() => {
    if (!tabWalletViews) return 0;
    if (tab === 'swarms') return swarms.length;
    return toxicFlowWalletsForTab(tabWalletViews, tab).wallets.length;
  }, [tabWalletViews, tab, swarms]);

  useEffect(() => {
    if (!open) {
      setRowActionsTipOpen(false);
      return;
    }
    if (readToxicFlowRowActionsTipDismissed()) {
      setRowActionsTipOpen(false);
      return;
    }
    if (!readToxicFlowTabsTipDismissed() || tabsTipOpen) {
      setRowActionsTipOpen(false);
      return;
    }
    if (loading || primaryTabWalletCount === 0) {
      setRowActionsTipOpen(false);
      return;
    }
    setRowActionsTipOpen(true);
  }, [open, loading, tabsTipOpen, primaryTabWalletCount]);

  if (!tabWalletViews) return null;

  return (
    <ToxicFlowDialogTableStack
      yesTokenId={yesTokenId}
      noTokenId={noTokenId}
      marketId={marketId}
      open={open}
      marketExpired={marketExpired}
      tabWalletViews={tabWalletViews}
      swarms={swarms}
      layoutMode={layoutMode}
      tab={tab}
      tabBottom={tabBottom}
      tabThird={tabThird}
      setTab={setTabWithDismiss}
      setTabBottom={setTabBottomWithDismiss}
      setTabThird={setTabThirdWithDismiss}
      openWalletDialog={openWalletDialog}
      layoutSwitch={layoutSwitch}
      tabsTipOpen={tabsTipOpen}
      onDismissTabsTip={dismissTabsTip}
      tabsBarRef={tabsBarRef}
      rowActionsTipOpen={rowActionsTipOpen}
      onDismissRowActionsTip={dismissRowActionsTip}
      rowActionsAnchorRef={rowActionsAnchorRef}
    />
  );
});

const ToxicFlowDialogEmbeddedHoldersBody = memo(function ToxicFlowDialogEmbeddedHoldersBody({
  yesTokenId,
  noTokenId,
  marketId,
  open,
  marketExpired = false,
  layoutMode,
  tab,
  tabBottom,
  tabThird,
  setTabWithDismiss,
  setTabBottomWithDismiss,
  setTabThirdWithDismiss,
  openWalletDialog,
  layoutSwitch,
  toxicFollowSet,
  toxicXSet,
  tiltWhaleAmountUsd,
}: {
  yesTokenId: string;
  noTokenId?: string;
  marketId: string;
  open: boolean;
  marketExpired?: boolean;
  layoutMode: ToxicFlowLayoutMode;
  tab: Tab;
  tabBottom: Tab;
  tabThird: Tab;
  setTabWithDismiss: (tab: Tab) => void;
  setTabBottomWithDismiss: (tab: Tab) => void;
  setTabThirdWithDismiss: (tab: Tab) => void;
  openWalletDialog: (wallet: string, netShares?: number) => void;
  layoutSwitch: ReactNode;
  toxicFollowSet: ReadonlySet<string>;
  toxicXSet: ReadonlySet<string>;
  tiltWhaleAmountUsd: number;
}) {
  const yesTok = yesTokenId.trim();
  const midTrim = marketId.trim();
  return (
    <>
      <ToxicFlowDialogLoadingLine open={open} marketId={midTrim} />
      <ToxicFlowDialogStatsGrid yesTokenId={yesTok} marketId={midTrim} open={open} />
      <ToxicFlowDialogZeroWalletsHelp />
      <ToxicFlowDialogEmbeddedTableStack
        yesTokenId={yesTok}
        noTokenId={noTokenId}
        marketId={midTrim}
        open={open}
        marketExpired={marketExpired}
        layoutMode={layoutMode}
        tab={tab}
        tabBottom={tabBottom}
        tabThird={tabThird}
        setTabWithDismiss={setTabWithDismiss}
        setTabBottomWithDismiss={setTabBottomWithDismiss}
        setTabThirdWithDismiss={setTabThirdWithDismiss}
        openWalletDialog={openWalletDialog}
        layoutSwitch={layoutSwitch}
        toxicFollowSet={toxicFollowSet}
        toxicXSet={toxicXSet}
        tiltWhaleAmountUsd={tiltWhaleAmountUsd}
      />
    </>
  );
});

const ToxicFlowDialogInner = memo(function ToxicFlowDialogInner({
  open,
  marketId,
  marketName,
  yesTokenId,
  noTokenId,
  marketExpired = false,
  onClose,
  embedded = false,
  streamData: _streamData = undefined,
  streamTabWalletViews: _streamTabWalletViews = undefined,
  onRefreshStream: _onRefreshStream,
  streamRefreshing: _streamRefreshing = false,
  onInlineWalletExtraWidthChange,
}: ToxicFlowDialogProps) {
  const yesTok = (yesTokenId || '').trim();
  const [internalData, setInternalData] = useState<ToxicFlowData | null>(null);
  const internalDataRef = useRef<ToxicFlowData | null>(null);
  const [internalLoading, setInternalLoading] = useState(false);
  const [internalError, setInternalError] = useState('');
  const data = embedded ? null : internalData;
  const midTrim = (marketId || '').trim();
  const loading = embedded ? false : internalLoading;
  const error = embedded ? '' : internalError;
  const [layoutMode, setLayoutMode] = useState<ToxicFlowLayoutMode>(() => readToxicFlowLayoutMode());
  const onLayoutModeChange = useCallback((mode: ToxicFlowLayoutMode) => {
    setLayoutMode(mode);
    persistToxicFlowLayoutMode(mode);
  }, []);
  const [tab, setTabState] = useState<Tab>(() => readToxicFlowPaneTab('pane1'));
  const [tabBottom, setTabBottomState] = useState<Tab>(() => readToxicFlowPaneTab('pane2'));
  const [tabThird, setTabThirdState] = useState<Tab>(() => readToxicFlowPaneTab('pane3'));
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    persistToxicFlowPaneTab('pane1', next);
  }, []);
  const setTabBottom = useCallback((next: Tab) => {
    setTabBottomState(next);
    persistToxicFlowPaneTab('pane2', next);
  }, []);
  const setTabThird = useCallback((next: Tab) => {
    setTabThirdState(next);
    persistToxicFlowPaneTab('pane3', next);
  }, []);
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState('');
  const [focusMarketSeq, setFocusMarketSeq] = useState(0);
  const selectedWalletRef = useRef('');
  const walletDialogOpenRef = useRef(false);
  const isWide1920 = useMinWidth1920();
  const isWide1920Ref = useRef(isWide1920);
  isWide1920Ref.current = isWide1920;
  const [inlineWalletSlot, setInlineWalletSlot] = useState(false);
  const [inlineWalletWidth, setInlineWalletWidth] = useState('0px');
  const walletOpenAnimRef = useRef(false);
  const inlineWalletSlotRef = useRef(inlineWalletSlot);
  inlineWalletSlotRef.current = inlineWalletSlot;
  const inlineWalletWidthRef = useRef(inlineWalletWidth);
  inlineWalletWidthRef.current = inlineWalletWidth;
  selectedWalletRef.current = selectedWallet;
  walletDialogOpenRef.current = walletDialogOpen;

  useLayoutEffect(() => {
    if (!embedded) return;
    onInlineWalletExtraWidthChange?.(inlineWalletWidth);
  }, [embedded, inlineWalletWidth, onInlineWalletExtraWidthChange]);

  useLayoutEffect(() => {
    if (!walletOpenAnimRef.current || inlineWalletWidth !== '0px') return;
    walletOpenAnimRef.current = false;
    const id = requestAnimationFrame(() => {
      setInlineWalletWidth(TOXIC_INLINE_WALLET_WIDTH_COMPACT);
    });
    return () => cancelAnimationFrame(id);
  }, [inlineWalletSlot, inlineWalletWidth]);

  const onInlineMarketsListOpenChange = useCallback((open: boolean) => {
    setInlineWalletWidth(open ? TOXIC_INLINE_WALLET_WIDTH : TOXIC_INLINE_WALLET_WIDTH_COMPACT);
  }, []);

  useEffect(() => {
    if (open) return;
    setWalletDialogOpen(false);
    setSelectedWallet('');
    setInlineWalletSlot(false);
    setInlineWalletWidth('0px');
  }, [open]);
  const [toxicFollowSet, setToxicFollowSet] = useState(readToxicFavouriteWallets);
  const [toxicXSet, setToxicXSet] = useState(readToxicXWallets);
  useEffect(() => {
    const syncFav = () => setToxicFollowSet(readToxicFavouriteWallets());
    const syncX = () => setToxicXSet(readToxicXWallets());
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY || e.key === null) syncFav();
      if (e.key === TOXIC_X_WALLETS_LS_KEY || e.key === null) syncX();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, syncFav);
    window.addEventListener(TOXIC_X_CHANGED_EVENT, syncX);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, syncFav);
      window.removeEventListener(TOXIC_X_CHANGED_EVENT, syncX);
    };
  }, []);

  const [tiltWhaleAmountUsd, setTiltWhaleAmountUsd] = useState(readTiltWhaleAmountUsd);
  useEffect(() => {
    const sync = () => setTiltWhaleAmountUsd(readTiltWhaleAmountUsd());
    window.addEventListener(TILT_WHALE_AMOUNT_USD_CHANGED_EVENT, sync);
    const onStorage = (e: StorageEvent) => {
      if (e.key === TILT_WHALE_AMOUNT_USD_LS_KEY || e.key === null) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(TILT_WHALE_AMOUNT_USD_CHANGED_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const load = useCallback(async () => {
    if (!marketId) return;
    setInternalLoading(true);
    setInternalError('');
    try {
      const d = await fetchToxicFlow(marketId);
      const snap = toxicFlowFullSnapshot(d);
      internalDataRef.current = snap;
      setInternalData(snap);
    } catch (e: unknown) {
      setInternalError((e as Error).message || 'Failed to load');
    } finally {
      setInternalLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    if (embedded) return;
    if (open) {
      void load();
    } else {
      internalDataRef.current = null;
      setInternalData(null);
    }
  }, [embedded, open, load]);

  /** Initial load is HTTP; ongoing updates from /ws/toxic-flow (server ~1 Hz). Skipped when `embedded` (Sidebar owns the stream). */
  useEffect(() => {
    if (embedded) return;
    if (!open || !marketId.trim()) return;

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let attempt = 0;

    let pingIv: number | undefined;

    const connect = () => {
      if (cancelled) return;
      const url = `${WS_BASE}/ws/toxic-flow?market_id=${encodeURIComponent(marketId.trim())}`;
      ws = new WebSocket(url);
      ws.onopen = () => {
        attempt = 0;
        if (pingIv != null) window.clearInterval(pingIv);
        pingIv = window.setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25_000);
      };
      ws.onmessage = (ev) => {
      if (cancelled) return;
        try {
          const msg = JSON.parse(String(ev.data)) as ToxicFlowWSMessage;
          const next = applyToxicFlowWSMessage(internalDataRef.current, msg);
          if (!next) return;
          if (internalDataRef.current && toxicFlowPayloadEqual(internalDataRef.current, next)) return;
          internalDataRef.current = next;
          setInternalData(next);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (cancelled) return;
        const delay = Math.min(30_000, 800 * Math.pow(2, Math.min(attempt, 8)));
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (pingIv != null) window.clearInterval(pingIv);
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      if (ws != null) {
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [embedded, open, marketId]);

  const tabWalletViewsBuilt = useMemo(
    () => (data ? buildToxicFlowTabWalletViews(data, toxicFollowSet, tiltWhaleAmountUsd, toxicXSet) : null),
    [data, toxicFollowSet, tiltWhaleAmountUsd, toxicXSet],
  );
  const tabWalletViews = embedded ? null : tabWalletViewsBuilt;

  const tabsBarRef = useRef<HTMLDivElement>(null);
  const [tabsTipOpen, setTabsTipOpen] = useState(false);
  const dismissTabsTip = useCallback(() => {
    persistToxicFlowTabsTipDismissed();
    setTabsTipOpen(false);
  }, []);

  useEffect(() => {
    if (embedded || !open) {
      setTabsTipOpen(false);
      return;
    }
    if (readToxicFlowTabsTipDismissed()) {
      setTabsTipOpen(false);
      return;
    }
    if (loading || !tabWalletViews) {
      setTabsTipOpen(false);
      return;
    }
    setTabsTipOpen(true);
  }, [embedded, open, loading, tabWalletViews]);

  const setTabWithDismiss = useCallback(
    (next: Tab) => {
      dismissTabsTip();
      setTab(next);
    },
    [dismissTabsTip, setTab],
  );
  const setTabBottomWithDismiss = useCallback(
    (next: Tab) => {
      dismissTabsTip();
      setTabBottom(next);
    },
    [dismissTabsTip, setTabBottom],
  );
  const setTabThirdWithDismiss = useCallback(
    (next: Tab) => {
      dismissTabsTip();
      setTabThird(next);
    },
    [dismissTabsTip, setTabThird],
  );

  const rowActionsAnchorRef = useRef<HTMLTableCellElement>(null);
  const [rowActionsTipOpen, setRowActionsTipOpen] = useState(false);
  const dismissRowActionsTip = useCallback(() => {
    persistToxicFlowRowActionsTipDismissed();
    setRowActionsTipOpen(false);
  }, []);

  const flowSwarms = data?.swarms ?? [];

  const primaryTabWalletCount = useMemo(() => {
    if (!tabWalletViews) return 0;
    if (tab === 'swarms') return flowSwarms.length;
    return toxicFlowWalletsForTab(tabWalletViews, tab).wallets.length;
  }, [tabWalletViews, tab, flowSwarms]);

  useEffect(() => {
    if (embedded || !open) {
      setRowActionsTipOpen(false);
      return;
    }
    if (readToxicFlowRowActionsTipDismissed()) {
      setRowActionsTipOpen(false);
      return;
    }
    if (!readToxicFlowTabsTipDismissed() || tabsTipOpen) {
      setRowActionsTipOpen(false);
      return;
    }
    if (loading || primaryTabWalletCount === 0) {
      setRowActionsTipOpen(false);
      return;
    }
    setRowActionsTipOpen(true);
  }, [embedded, open, loading, tabsTipOpen, primaryTabWalletCount]);

  const openWalletDialog = useCallback((wallet: string, _netShares?: number) => {
    const w = wallet.trim();
    if (!w) return;
    const sameWalletOpen =
      walletDialogOpenRef.current &&
      selectedWalletRef.current.trim().toLowerCase() === w.toLowerCase();
    setSelectedWallet(w);
    setWalletDialogOpen(true);
    if (sameWalletOpen && midTrim) {
      setFocusMarketSeq((n) => n + 1);
    }
    if (!isWide1920Ref.current) return;
    if (inlineWalletSlotRef.current && inlineWalletWidthRef.current !== '0px') {
      walletOpenAnimRef.current = false;
      setInlineWalletWidth(TOXIC_INLINE_WALLET_WIDTH_COMPACT);
      return;
    }
    walletOpenAnimRef.current = true;
    setInlineWalletSlot(true);
    setInlineWalletWidth('0px');
  }, [midTrim]);

  const closeWalletPanel = useCallback(() => {
    setWalletDialogOpen(false);
    if (isWide1920Ref.current && inlineWalletSlot) {
      setInlineWalletWidth('0px');
      return;
    }
    setSelectedWallet('');
    setInlineWalletSlot(false);
    setInlineWalletWidth('0px');
  }, [inlineWalletSlot]);

  const onInlineWalletPanelTransitionEnd = useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget || e.propertyName !== 'grid-template-columns') return;
      if (inlineWalletWidth !== '0px') return;
      setInlineWalletSlot(false);
      setSelectedWallet('');
    },
    [inlineWalletWidth],
  );

  const showInlineWalletModal = walletDialogOpen && !isWide1920;
  const toxicBodyGridStyle: React.CSSProperties | undefined = isWide1920
    ? {
        gridTemplateColumns: `minmax(0, 1fr) ${inlineWalletWidth}`,
        transition: `grid-template-columns ${TOXIC_INLINE_WALLET_MS}ms ease`,
      }
    : undefined;

  const inlineSplit = isWide1920 && inlineWalletSlot;

  if (!open) return null;

  const layoutSwitch = useMemo(
    () => <ToxicFlowLayoutSwitch mode={layoutMode} onMode={onLayoutModeChange} />,
    [layoutMode, onLayoutModeChange],
  );

  const holdersHeader = useMemo(
    () => (
      <div className="flex items-center gap-2 min-w-0 mb-3 shrink-0">
        <UsersRound size={16} className="text-yellow-400 shrink-0" />
        <span className="text-sm font-bold text-yellow-400 shrink-0">Holders</span>
        <span className="text-xs text-gray-400 truncate min-w-0 flex-1">{marketName}</span>
        {!inlineSplit ? (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-0.5 rounded text-gray-500 hover:text-white hover:bg-gray-700/70 transition"
            title="Close holders"
            aria-label="Close holders"
          >
            <X size={16} strokeWidth={2} />
          </button>
        ) : null}
        </div>
    ),
    [marketName, inlineSplit, onClose],
  );

  const holdersBody = (
    <>
      <ToxicFlowDialogLoadingLine open={open} marketId={midTrim} loadingOverride={loading} />
      {error && <div className="text-red-400 text-center py-8 shrink-0">Error: {error}</div>}

          {!loading && !error && data && (
        <>
          <ToxicFlowDialogStatsGrid yesTokenId={yesTok} marketId={midTrim} open={open} data={data} />
          <ToxicFlowDialogZeroWalletsHelp data={data} />

          {tabWalletViews ? (
            <ToxicFlowDialogTableStack
              yesTokenId={yesTok}
              noTokenId={noTokenId}
              marketId={midTrim}
              open={open}
              marketExpired={marketExpired}
              tabWalletViews={tabWalletViews}
              swarms={flowSwarms}
              layoutMode={layoutMode}
              tab={tab}
              tabBottom={tabBottom}
              tabThird={tabThird}
              setTab={embedded ? setTabWithDismiss : setTab}
              setTabBottom={embedded ? setTabBottomWithDismiss : setTabBottom}
              setTabThird={embedded ? setTabThirdWithDismiss : setTabThird}
              openWalletDialog={openWalletDialog}
              layoutSwitch={layoutSwitch}
              tabsTipOpen={embedded ? tabsTipOpen : false}
              onDismissTabsTip={embedded ? dismissTabsTip : undefined}
              tabsBarRef={embedded ? tabsBarRef : undefined}
              rowActionsTipOpen={embedded ? rowActionsTipOpen : false}
              onDismissRowActionsTip={embedded ? dismissRowActionsTip : undefined}
              rowActionsAnchorRef={embedded ? rowActionsAnchorRef : undefined}
            />
          ) : null}
        </>
      )}
    </>
  );

  const inlineWalletPanel = useMemo(
    () =>
      inlineSplit && selectedWallet ? (
        <div className="toxic-inline-wallet-panel flex flex-col min-h-0 h-full overflow-hidden">
          <div
            className="flex flex-col min-h-0 h-full border-l border-gray-700/80 pl-2 overflow-hidden"
            style={{ width: inlineWalletWidth, maxWidth: inlineWalletWidth }}
          >
            <InlineWalletInfoPanelHost
              wallet={selectedWallet}
              initialMarketId={marketId}
              focusMarketId={midTrim}
              focusMarketSeq={focusMarketSeq}
              onClose={closeWalletPanel}
              onInlineMarketsListOpenChange={onInlineMarketsListOpenChange}
              toxicFlowMarketId={midTrim}
            />
                          </div>
                </div>
      ) : null,
    [
      inlineSplit,
      selectedWallet,
      marketId,
      midTrim,
      focusMarketSeq,
      closeWalletPanel,
      onInlineMarketsListOpenChange,
      inlineWalletWidth,
    ],
  );

  const rootClass = embedded
    ? 'flex flex-col flex-1 min-h-0 min-w-0 h-full w-full overflow-hidden bg-gray-900'
    : 'fixed inset-0 bg-black/60 z-[60010] flex items-center justify-center';
  const cardClass = embedded
    ? 'bg-gray-900 flex flex-col flex-1 min-h-0 min-w-0 p-3 border-0 border-gray-800/50 w-full rounded-none shadow-none'
    : inlineWalletSlot
      ? 'bg-gray-800 rounded-lg p-4 w-full mx-4 shadow-xl border border-gray-700 flex flex-col min-h-0'
      : 'bg-gray-800 rounded-lg p-4 max-w-4xl w-full mx-4 shadow-xl border border-gray-700 flex flex-col min-h-0';
  const cardStyle: React.CSSProperties = embedded
    ? { maxHeight: '100%', minHeight: 0 }
    : {
        maxHeight: '85vh',
        height: '85vh',
        minHeight: 0,
        ...(isWide1920
          ? {
              width: `min(98vw, calc(56rem + ${inlineWalletWidth}))`,
              maxWidth: `min(98vw, calc(56rem + ${inlineWalletWidth}))`,
              transition: `width ${TOXIC_INLINE_WALLET_MS}ms ease, max-width ${TOXIC_INLINE_WALLET_MS}ms ease`,
            }
          : {}),
      };

                return (
    <div
      className={rootClass}
      {...(!embedded
        ? {
            onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => {
              if (e.target === e.currentTarget) onClose();
            },
          }
        : {})}
    >
      <div className={cardClass} style={cardStyle}>
        {inlineSplit ? (
          <div
            className="flex-1 min-h-0 grid overflow-hidden"
            style={toxicBodyGridStyle}
            onTransitionEnd={onInlineWalletPanelTransitionEnd}
          >
            <div className="flex flex-col min-h-0 min-w-0 overflow-hidden">
              {holdersHeader}
              <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
                {embedded ? (
                  <ToxicFlowDialogEmbeddedHoldersBody
                    yesTokenId={yesTok}
                    noTokenId={noTokenId}
                    marketId={midTrim}
                    open={open}
                    marketExpired={marketExpired}
                    layoutMode={layoutMode}
                    tab={tab}
                    tabBottom={tabBottom}
                    tabThird={tabThird}
                    setTabWithDismiss={setTabWithDismiss}
                    setTabBottomWithDismiss={setTabBottomWithDismiss}
                    setTabThirdWithDismiss={setTabThirdWithDismiss}
                    openWalletDialog={openWalletDialog}
                    layoutSwitch={layoutSwitch}
                    toxicFollowSet={toxicFollowSet}
                    toxicXSet={toxicXSet}
                    tiltWhaleAmountUsd={tiltWhaleAmountUsd}
                  />
                ) : (
                  holdersBody
                )}
                          </div>
            </div>
            {inlineWalletPanel}
          </div>
        ) : (
          <>
            {holdersHeader}
            <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
              {embedded ? (
                <ToxicFlowDialogEmbeddedHoldersBody
                  yesTokenId={yesTok}
                  noTokenId={noTokenId}
                  marketId={midTrim}
                  open={open}
                  marketExpired={marketExpired}
                  layoutMode={layoutMode}
                  tab={tab}
                  tabBottom={tabBottom}
                  tabThird={tabThird}
                  setTabWithDismiss={setTabWithDismiss}
                  setTabBottomWithDismiss={setTabBottomWithDismiss}
                  setTabThirdWithDismiss={setTabThirdWithDismiss}
                  openWalletDialog={openWalletDialog}
                  layoutSwitch={layoutSwitch}
                  toxicFollowSet={toxicFollowSet}
                  toxicXSet={toxicXSet}
                  tiltWhaleAmountUsd={tiltWhaleAmountUsd}
                />
              ) : (
                holdersBody
              )}
                          </div>
          </>
        )}
        {showInlineWalletModal ? (
        <WalletInfoDialog
          open={walletDialogOpen}
          wallet={selectedWallet}
          initialMarketId={marketId}
            focusMarketId={midTrim}
            focusMarketSeq={focusMarketSeq}
            onClose={closeWalletPanel}
            toxicFlowMarketId={midTrim}
        />
        ) : null}
      </div>
    </div>
  );
}, (a, b) => {
  if (
    a.open !== b.open ||
    a.embedded !== b.embedded ||
    a.marketId !== b.marketId ||
    a.marketName !== b.marketName ||
    a.yesTokenId !== b.yesTokenId ||
    a.noTokenId !== b.noTokenId ||
    a.marketExpired !== b.marketExpired ||
    a.onClose !== b.onClose ||
    a.streamRefreshing !== b.streamRefreshing ||
    a.onRefreshStream !== b.onRefreshStream ||
    a.onInlineWalletExtraWidthChange !== b.onInlineWalletExtraWidthChange
  ) {
    return false;
  }
  return true;
});
