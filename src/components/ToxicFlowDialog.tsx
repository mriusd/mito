import {
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
} from 'lucide-react';
import {
  fetchToxicFlow,
  fetchWalletSummary,
  fetchWalletPositions,
  fetchMarketStakedLegs,
  fetchMarketOutcomeTokens,
  mergeMarketStakedLegsResponse,
  type MarketOutcomeTokensResponse,
  walletSummaryFromLedgerEmbed,
  type MarketStakedLegsResponse,
  type ToxicFlowData,
  type WalletPosition,
  type WalletSummary,
  type OnchainFillRow,
  type WalletScoresLedgerEmbed,
} from '../api';
import {
  readToxicFavouriteWallets,
  persistToxicFavouriteWallets,
  readToxicBellWallets,
  getToxicBellWalletsSnapshot,
  subscribeToxicBellWallets,
  persistToxicBellWallets,
  recordToxicFavouriteNicknamesFromRows,
  setToxicFavouriteNickname,
  TOXIC_FAVOURITE_WALLETS_LS_KEY,
  TOXIC_FAVOURITES_CHANGED_EVENT,
  TOXIC_BELL_WALLETS_LS_KEY,
  TOXIC_BELLS_CHANGED_EVENT,
} from '../lib/toxicFavouriteWallets';
import {
  readToxicXWallets,
  persistToxicXWallets,
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
import { InlineConfirmCancelInput } from './InlineConfirmCancelInput';
import {
  normalizeToxicWalletTagInput,
  removeToxicWalletTag,
  setToxicWalletTag,
  useToxicWalletTag,
} from '../lib/toxicWalletTags';
import { WS_BASE } from '../lib/env';
import { toxicFlowFillKey } from '../lib/tradeKeys';
import { useAppStore } from '../stores/appStore';
import { useWalletMarketTradesWS, type WSTrade } from '../hooks/useOnchainTradesWS';
import {
  buildMarketByIdRecord,
  sortWalletPositionsByDisplayedDateDesc,
  WalletLatestMarketsTradedTable,
  fmtPriceShare,
} from './WalletLatestMarketsTradedTable';
import { exportWalletFillsCsv, exportWalletMarketsCsv } from '../lib/walletInfoCsvExport';
import { fetchPolymarketNickname } from '../api/polymarket';
import { polymarketSiteUrl } from '../lib/polymarketSiteUrl';
import { WalletScoresDailyCharts } from './WalletScoresDailyCharts';
import { SidebarRightLiveTradeChart, type ChartTradeMarker } from './SidebarRightLiveTradeChart';
import {
  enrichMarketByIdFromWalletPositions,
  resolveWalletInfoChartMarket,
  walletInfoChartMarketWithOutcomeTokens,
} from '../lib/walletInfoChartMarket';
import { useSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import type { Market } from '../types';
import { HelperTooltip } from './HelperTooltip';
import { formatPolymarketVolumeK, formatThousandsAsK } from '../utils/format';
import { StakedLegUsdBar } from './StakedLegUsdBar';
import { WalletAddressGlyph } from './WalletAddressGlyph';
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
} from '../lib/toxicFlowStakeCohort';
import {
  readTiltWhaleAmountUsd,
  DEFAULT_TILT_WHALE_AMOUNT_USD,
  TILT_WHALE_AMOUNT_USD_CHANGED_EVENT,
  TILT_WHALE_AMOUNT_USD_LS_KEY,
} from '../lib/tiltWhaleAmountUsd';
import {
  applyToxicFlowWSMessage,
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
  { key: 'topHolders', label: 'Top Holders', icon: <Crown size={11} /> },
  { key: 'smart', label: 'Smart', icon: <Sparkles size={11} /> },
  { key: 'favourites', label: 'Favourites', icon: <Star size={11} /> },
  { key: 'whales', label: 'Whales', icon: <Fish size={11} /> },
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
    case 'winners':
      return { wallets: views.winners, label: 'greens' };
    case 'fresh':
      return { wallets: views.stripLists.fresh, label: 'fresh' };
    case 'topYes':
      return { wallets: views.topYes, label: 'Net Y (Staked)' };
    case 'topNo':
      return { wallets: views.topNo, label: 'Net N (Staked)' };
  }
}

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
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex gap-1 border-b border-gray-700 pb-2 shrink-0 flex-nowrap items-center min-w-0 w-full overflow-x-auto toxic-flow-scroll-stable">
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
  totalStakedNetUsd,
  onOpenWallet,
  trailing,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  tabWalletViews: ToxicFlowTabWalletViews;
  totalStakedNetUsd: number | null;
  onOpenWallet: (wallet: string, netShares?: number) => void;
  trailing?: ReactNode;
}) {
  const { wallets, label } = toxicFlowWalletsForTab(tabWalletViews, tab);
  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden gap-2">
      <ToxicFlowTabBar tab={tab} onTab={onTab} trailing={trailing} />
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden min-w-0">
        <WalletTable
          wallets={wallets}
          label={label}
          totalStakedNetUsd={totalStakedNetUsd}
          onOpenWallet={onOpenWallet}
        />
      </div>
    </div>
  );
}, (a, b) => {
  if (
    a.tab !== b.tab ||
    a.onTab !== b.onTab ||
    a.onOpenWallet !== b.onOpenWallet ||
    a.trailing !== b.trailing ||
    a.totalStakedNetUsd !== b.totalStakedNetUsd
  ) {
    return false;
  }
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

/** Ignore sub-dollar staked-net ticks when flashing triangles. */
const STAKED_NET_FLASH_MIN_USD = 1;

const STAKED_NET_FLASH_MS = 2000;

type StakedNetFlashDir = 'up' | 'down';

function stakedNetDominantSide(signed: number): 'yes' | 'no' | 'flat' {
  if (signed < -STAKED_NET_EPS) return 'yes';
  if (signed > STAKED_NET_EPS) return 'no';
  return 'flat';
}

function stakedNetDeltaFlashDir(prev: number, next: number): StakedNetFlashDir | null {
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return null;
  const prevSide = stakedNetDominantSide(prev);
  const nextSide = stakedNetDominantSide(next);
  if (prevSide === 'flat' || nextSide === 'flat' || prevSide !== nextSide) return null;
  const prevMag = Math.abs(prev);
  const nextMag = Math.abs(next);
  if (nextMag > prevMag + STAKED_NET_FLASH_MIN_USD) return 'up';
  if (nextMag < prevMag - STAKED_NET_FLASH_MIN_USD) return 'down';
  return null;
}

function stakedNetUsdTableCell(signed: number): ReactNode {
  if (!Number.isFinite(signed)) return '–';
  const mag = Math.round(Math.abs(signed)).toLocaleString('en-US');
  if (Math.abs(signed) <= STAKED_NET_EPS) {
    return <span className="tabular-nums font-bold text-gray-500">${mag}</span>;
  }
  if (signed < -STAKED_NET_EPS) {
    return (
      <span className="tabular-nums font-bold text-green-400">
        ${mag} Y
      </span>
    );
  }
  return (
    <span className="tabular-nums font-bold text-red-400">
      ${mag} N
    </span>
  );
}

function stakedNetUsdTableCellWithFlash(signed: number, flash: StakedNetFlashDir | null): ReactNode {
  return (
    <span className="inline-flex w-full items-center justify-end gap-0.5">
      {flash === 'up' && (
        <span
          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-green-600/45 bg-green-900/65 text-green-100 updown-triangle-badge-flash"
          title="Staked net increased on same side (Y or N)"
        >
          <Triangle className="h-2 w-2 fill-current stroke-current" strokeWidth={1.5} aria-hidden />
        </span>
      )}
      {flash === 'down' && (
        <span
          className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-red-600/45 bg-red-900/65 text-red-100 updown-triangle-badge-flash"
          title="Staked net decreased on same side (Y or N)"
        >
          <Triangle className="h-2 w-2 rotate-180 fill-current stroke-current" strokeWidth={1.5} aria-hidden />
        </span>
      )}
      {stakedNetUsdTableCell(signed)}
    </span>
  );
}

/** Inv Y − Inv N in shares: |net| + Y/N suffix (no leading minus), same layout idea as Staked Net. */
const SHARE_INV_NET_EPS = 0.001;

function inventoryNetSharesTableCell(signed: number): ReactNode {
  if (!Number.isFinite(signed)) return '–';
  const mag = Math.round(Math.abs(signed)).toLocaleString('en-US');
  if (Math.abs(signed) <= SHARE_INV_NET_EPS) {
    return <span className="tabular-nums font-bold text-gray-500">{mag}</span>;
  }
  if (signed > SHARE_INV_NET_EPS) {
    return (
      <span className="tabular-nums font-bold text-green-400">
        {mag} Y
      </span>
    );
  }
  return (
    <span className="tabular-nums font-bold text-red-400">
      {mag} N
    </span>
  );
}

/** Hot path: cached class strings (avoid per-row template-literal allocations on tick rerender). */
/** Fixed width for rank # (1–100+) so column does not grow at row 10/100 and jitter layout. */
const TOXIC_TABLE_BODY_TD_CLS = 'box-border align-middle py-0';
/** Fixed 23px row inner — keeps star/bell and wallet+glyph vertically centered together. */
const TOXIC_TABLE_ROW_INNER_CLS = 'flex h-[23px] max-h-[23px] min-h-[23px] items-center';
const TOXIC_TABLE_RANK_COL_CLS =
  'w-[1.85rem] min-w-[1.85rem] max-w-[1.85rem] box-border tabular-nums text-left shrink-0 pl-1';
const TOXIC_TABLE_FAV_COL_CLS = 'w-[2.85rem] min-w-[2.85rem] max-w-[2.85rem] box-border shrink-0 px-0.5';
/** Fixed width for % / Cum% (e.g. 100.0%) so stake updates do not jitter column width. */
const TOXIC_TABLE_STAKED_PCT_COL_CLS =
  'w-[3.35rem] min-w-[3.35rem] max-w-[3.35rem] box-border shrink-0 tabular-nums text-right';
/** Fixed width for Staked ($mag Y/N + flash badge) so layout does not jitter on tick. */
const TOXIC_TABLE_STAKED_COL_CLS =
  'w-[8rem] min-w-[8rem] max-w-[8rem] box-border shrink-0 tabular-nums text-right whitespace-nowrap overflow-hidden';

const ROW_CLS_NEUTRAL = 'border-b border-gray-800 hover:bg-gray-700/30';
const ROW_CLS_GREEN = 'border-b border-gray-800 bg-green-900/25 hover:bg-green-900/40';
const ROW_CLS_RED = 'border-b border-gray-800 bg-red-900/25 hover:bg-red-900/40';

function walletRowClassForStakedNet(shadeRows: boolean, stakeNetSigned: number): string {
  if (!shadeRows) return ROW_CLS_NEUTRAL;
  if (!Number.isFinite(stakeNetSigned) || Math.abs(stakeNetSigned) <= STAKED_NET_EPS) return ROW_CLS_NEUTRAL;
  if (stakeNetSigned < -STAKED_NET_EPS) return ROW_CLS_GREEN;
  return ROW_CLS_RED;
}

/** Hot path: shared `Intl.NumberFormat` instances (`.toLocaleString(opts)` allocates a fresh one each call). */
const NF_INT_EN = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const NF_PCT_1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function rowFmtInt(v: number): string {
  return NF_INT_EN.format(Math.round(v));
}

/** Pulse class lookup (ordering: bell+whale > bell > whale > none). */
const ROW_PULSE_NONE = '';
const ROW_PULSE_BELL = ' toxic-flow-bell-row-flash';
const ROW_PULSE_WHALE = ' toxic-flow-high-stake-net-row-flash';
const ROW_PULSE_BELL_WHALE = ' toxic-flow-bell-high-stake-combo-row-flash';

function rowPulseClassFor(bellActive: boolean, whaleFlash: boolean): string {
  if (bellActive && whaleFlash) return ROW_PULSE_BELL_WHALE;
  if (bellActive) return ROW_PULSE_BELL;
  if (whaleFlash) return ROW_PULSE_WHALE;
  return ROW_PULSE_NONE;
}

/** Share price at or above 95¢ (resolved / near-certain). */
function sharePriceAtOrAbove95Cents(p: number | undefined): boolean {
  return p != null && Number.isFinite(p) && p >= 0.95;
}

function walletHasSharePriceAtOrAbove95Cents(w: WalletPosition): boolean {
  return sharePriceAtOrAbove95Cents(w.priceYes) || sharePriceAtOrAbove95Cents(w.priceNo);
}

/** Px Y / Px N: gray when share price ≥ 95¢. */
function priceSharePxClass(p: number | undefined): string {
  if (sharePriceAtOrAbove95Cents(p)) return 'text-gray-500';
  return 'text-yellow-400';
}

function biasToneClass(signedLegNet: number): string {
  if (signedLegNet > STAKED_NET_EPS) return 'text-green-400';
  if (signedLegNet < -STAKED_NET_EPS) return 'text-red-400';
  return 'text-gray-400';
}

function invYToneClass(iy: number): string {
  if (iy > 0.001) return 'text-green-400';
  if (iy < -0.001) return 'text-red-400';
  return 'text-gray-500';
}

const STAR_CLS_ON = 'text-yellow-400 fill-yellow-400';
const STAR_CLS_OFF = 'fill-none stroke-gray-400';
const BELL_CLS_ON = 'text-amber-400 fill-amber-400/25';
const BELL_CLS_OFF = 'stroke-gray-400 fill-none';
const X_CLS_ON = 'text-red-500 fill-red-500/20 stroke-red-500';
const X_CLS_OFF = 'stroke-gray-400 fill-none';

function LedgerSummaryField({
  label,
  help,
  value,
  valueClassName = 'text-white font-medium',
  rowClass,
}: {
  label: ReactNode;
  help: string;
  value: ReactNode;
  valueClassName?: string;
  rowClass: string;
}) {
  return (
    <div className={rowClass}>
      <span className="flex items-center gap-0.5 min-w-0 shrink text-gray-500">
        <span className="truncate min-w-0">{label}</span>
        <HelperTooltip text={help} openOnHover />
      </span>
      <span className={`shrink-0 tabular-nums text-right ${valueClassName}`}>{value}</span>
    </div>
  );
}

function formatWalletTradeTime(blockTime: number): string {
  if (!blockTime) return '-';
  const d = blockTime > 1e12 ? new Date(blockTime) : new Date(blockTime * 1000);
  return d.toLocaleString().split('/').join('\\');
}

/** `wallet_scores_ledger` fields from /api/wallet-summary. */
function formatWslLastUpdated(raw: string | undefined | null): string {
  const t = Date.parse(String(raw || '').trim());
  if (!Number.isFinite(t)) return '–';
  return new Date(t).toLocaleString();
}

function WalletScoresLedgerSummaryGrid({
  s,
  dense,
  narrowSummary,
  hideNetCash,
  hideTotalMarkets,
  showLastUpdated,
}: {
  s: WalletSummary;
  dense?: boolean;
  narrowSummary?: boolean;
  /** e.g. wallet info dialog — omit ledger cash_flow aggregate row. */
  hideNetCash?: boolean;
  /** e.g. wallet info dialog Summary column — omit total markets row. */
  hideTotalMarkets?: boolean;
  /** Wallet info dialog — show wallet_scores_ledger.last_updated. */
  showLastUpdated?: boolean;
}) {
  const rm = s.resolvedMarkets ?? 0;
  const tt = s.totalTrades ?? 0;
  const wn = s.wins ?? 0;
  const ls = s.losses ?? 0;
  const fl = s.flat ?? 0;
  const pnl = s.pnl ?? 0;
  const tradedVol = (s.usdcIn ?? 0) + (s.usdcOut ?? 0);
  const wrRaw = typeof s.winRate === 'number' && Number.isFinite(s.winRate) ? s.winRate : 0;
  const wrFrac = ledgerWinRateFracFromStored(wrRaw);
  const wrPct = wrFrac * 100;
  const prRaw = typeof s.profitRate === 'number' && Number.isFinite(s.profitRate) ? s.profitRate : 0;
  const prFrac = prRaw > 1 ? prRaw / 100 : prRaw;
  const prPct = prFrac * 100;
  const roiLedgerFmt = fmtRoiPercent(s.roi ?? undefined);
  const text = dense ? 'text-[8px]' : narrowSummary ? 'text-[11px]' : 'text-xs';
  const row = `flex justify-between items-center gap-1.5 ${text} text-gray-300`;
  const wrPctStr = wrPct.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const prPctStr = prPct.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const volStr = tradedVol.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const wlf = (
    <>
      {fmtIntEn(wn)}
      {'\\'}
      {fmtIntEn(ls)}
      {'\\'}
      {fmtIntEn(fl)}
    </>
  );
  return (
    <div
      className={`grid grid-cols-1 gap-y-0.5 ${dense ? 'max-w-[min(100vw-24px,320px)]' : narrowSummary ? 'max-w-[22.5rem]' : ''}`}
    >
      <LedgerSummaryField
        rowClass={row}
        label="Total Trades"
        help="Count of on-chain fill rows (Σ wallet_market_positions.trades) for this wallet across all markets."
        value={fmtIntEn(tt)}
      />
      <LedgerSummaryField
        rowClass={row}
        label="Volume"
        help="Notional traded in USDC: sum of usdc_in + usdc_out across all wallet_market_positions rows for this wallet."
        value={<>${volStr}</>}
        valueClassName="text-yellow-400 font-medium"
      />
      {!hideTotalMarkets ? (
        <LedgerSummaryField
          rowClass={row}
          label="Total Markets"
          help="Number of distinct markets where this wallet has at least one position row in wallet_market_positions."
          value={fmtIntEn(s.totalMarkets ?? 0)}
        />
      ) : null}
      <LedgerSummaryField
        rowClass={row}
        label="Resolved Markets"
        help="Markets with a recorded on-chain outcome (wallet_market_positions.outcome set)."
        value={fmtIntEn(rm)}
      />
      <LedgerSummaryField
        rowClass={row}
        label={<>W{'\\'}L{'\\'}F</>}
        help="Win, loss, and flat counts from resolved positions (ledger w, l, f flags)."
        value={wlf}
      />
      <LedgerSummaryField
        rowClass={row}
        label="Win Rate %"
        help="Approximate win rate from ledger: wins divided by total_markets (stored win_rate on API may be the same ratio)."
        value={<span className={wrPct < 50 ? 'text-red-400' : 'text-green-400'}>{wrPctStr}%</span>}
        valueClassName="font-bold"
      />
      <LedgerSummaryField
        rowClass={row}
        label="PnL"
        help="Aggregate PnL from wallet_scores_ledger: sum of realized trading PnL plus resolution PnL across markets."
        value={fmtUsdSignedLedger(pnl)}
        valueClassName={`font-bold ${rPnlToneClass(pnl)}`}
      />
      {!hideNetCash ? (
        <LedgerSummaryField
          rowClass={row}
          label="Net Cash"
          help="Sum of cash_flow (USD leg net) across wallet_market_positions for this wallet."
          value={fmtUsdSignedLedger(s.cashFlow ?? 0)}
          valueClassName={`font-bold ${rPnlToneClass(s.cashFlow ?? 0)}`}
        />
      ) : null}
      <LedgerSummaryField
        rowClass={row}
        label="Profit Rate %"
        help="Share of markets counted as profitable: pm divided by total_markets (shown as percent)."
        value={<span className="text-gray-200">{prPctStr}%</span>}
        valueClassName="font-medium"
      />
      <LedgerSummaryField
        rowClass={row}
        label="ROI"
        help="Portfolio ROI on resolved markets only (USDC-weighted). Shown after outcomes exist; may be empty until then."
        value={<span className={roiLedgerFmt.tone}>{roiLedgerFmt.text}</span>}
        valueClassName="font-bold"
      />
      {showLastUpdated ? (
        <LedgerSummaryField
          rowClass={row}
          label="Last updated"
          help="When this wallet_scores_ledger row was last recomputed from wallet_market_positions."
          value={<span className="text-gray-400 tabular-nums">{formatWslLastUpdated(s.lastUpdated)}</span>}
        />
      ) : null}
    </div>
  );
}

function getResolvedDisplay(market: any, row?: WalletPosition): { label: string; color: string } {
  const isUpDown = /up\s+or\s+down|updown|up-or-down/i.test(`${market?.question || ''} ${market?.eventSlug || ''}`);
  const yesLabel = isUpDown ? 'UP' : 'YES';
  const noLabel = isUpDown ? 'DOWN' : 'NO';
  // Prefer backend truth from market_results join on wallet-positions response.
  if (typeof row?.resultYes === 'number' && row.resultYes >= 0) {
    if (row.resultYes === 1) return { label: `Resolved ${yesLabel}`, color: 'text-green-400 font-bold' };
    return { label: `Resolved ${noLabel}`, color: 'text-red-400 font-bold' };
  }
  if (!market?.closed) return { label: '-', color: 'text-gray-500' };
  const raw = market?.outcomePrices;
  let yesPrice: number | null = null;
  let noPrice: number | null = null;
  if (Array.isArray(raw) && raw.length >= 2) {
    yesPrice = Number(raw[0]);
    noPrice = Number(raw[1]);
  } else if (typeof raw === 'string' && raw.trim()) {
    const cleaned = raw.replace(/^\[/, '').replace(/\]$/, '');
    const parts = cleaned.split(',').map((s) => Number(String(s).trim()));
    if (parts.length >= 2) {
      yesPrice = parts[0];
      noPrice = parts[1];
    }
  }
  if (yesPrice != null && noPrice != null && Number.isFinite(yesPrice) && Number.isFinite(noPrice)) {
    if (yesPrice > noPrice) return { label: `Resolved ${yesLabel}`, color: 'text-green-400 font-bold' };
    if (noPrice > yesPrice) return { label: `Resolved ${noLabel}`, color: 'text-red-400 font-bold' };
  }
  return { label: 'Resolved', color: 'text-gray-400' };
}

function polymarketNicknameTrim(n?: string | null): string {
  return (n ?? '').trim();
}

function polymarketNicknameFromEmbed(embed?: WalletScoresLedgerEmbed | null): string {
  return polymarketNicknameTrim(embed?.polymarketNickname);
}

/** User tag → Polymarket nickname → shortened address. */
function toxicWalletDisplayLabel(
  wallet: string,
  opts: { tag?: string | null; ledgerEmbed?: WalletScoresLedgerEmbed | null; nickname?: string },
): string {
  const tag = polymarketNicknameTrim(opts.tag);
  if (tag) return tag;
  const nick = polymarketNicknameTrim(opts.nickname) || polymarketNicknameFromEmbed(opts.ledgerEmbed);
  if (nick) return shortenWallet(nick);
  return shortenWallet(wallet);
}

function shortenWallet(w: string): string {
  if (w.length <= 12) return w;
  return w.slice(0, 6) + '…' + w.slice(-4);
}

function sameClobToken(a: string, b: string): boolean {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  try {
    return BigInt(sa) === BigInt(sb);
  } catch {
    return false;
  }
}

function isUpDownFromFill(mk: any, f: OnchainFillRow): boolean {
  const blob = `${f.marketType || ''} ${mk?.marketType || ''} ${mk?.question || ''} ${mk?.eventSlug || ''}`.toLowerCase();
  return /upordown|up-down|up\s*or\s*down|updown/.test(blob);
}

/** API `side` varies (Yes/No/YES/empty). Infer YES/NO (or UP/DOWN) from `tokenId` vs market clob ids when missing. */
function isLedgerFillRow(f: OnchainFillRow): boolean {
  return f.fillSource === 'wallet_fill_ledger';
}

function wsTradeToFillRow(t: WSTrade, wallet: string, marketId: string): OnchainFillRow {
  return {
    txHash: t.txHash || '',
    logIndex: t.logIndex ?? 0,
    blockNumber: 0,
    blockTime: t.blockTime,
    fillSource: 'wallet_fill_ledger',
    wallet,
    action: t.side,
    size: t.size,
    price: t.price,
    fee: t.fee,
    tokenId: t.tokenId,
    side: t.outcome,
    marketId,
    isTaker: t.isTaker,
  };
}

function fillOutcomeDisplay(f: OnchainFillRow, mk: any): { text: string; tone: 'yes' | 'no' | 'muted' } {
  const upDown = isUpDownFromFill(mk, f);
  const yesLab = upDown ? 'UP' : 'YES';
  const noLab = upDown ? 'DOWN' : 'NO';
  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');
  const raw = String(f.side ?? '').trim();
  if (raw) {
    const u = norm(raw);
    if (u === 'YES' || u === 'Y' || u === 'UP') return { text: yesLab, tone: 'yes' };
    if (u === 'NO' || u === 'N' || u === 'DOWN') return { text: noLab, tone: 'no' };
    return { text: raw, tone: 'muted' };
  }
  const tid = String(f.tokenId || '').trim();
  const yT = String(mk?.clobTokenIds?.[0] ?? '').trim();
  const nT = String(mk?.clobTokenIds?.[1] ?? '').trim();
  if (tid && yT && sameClobToken(tid, yT)) return { text: yesLab, tone: 'yes' };
  if (tid && nT && sameClobToken(tid, nT)) return { text: noLab, tone: 'no' };
  return { text: '-', tone: 'muted' };
}

/** Aggregate `wallet_scores_ledger.pnl` sign from embed. Address color: no row blue; then green/red by this sign when non-null; then gold / smart fallbacks when sign is neutral. */
function ledgerAggregatePnlSign(embed: WalletScoresLedgerEmbed | null | undefined): 'pos' | 'neg' | null {
  if (embed == null) return null;
  const p = embed.pnl;
  if (typeof p !== 'number' || !Number.isFinite(p)) return null;
  if (p > 0) return 'pos';
  if (p < 0) return 'neg';
  return null;
}

function lifetimePnlHueFromSummary(s: WalletSummary): 'pos' | 'neg' | null {
  const p = s.pnl;
  if (typeof p !== 'number' || !Number.isFinite(p)) return null;
  if (p > 0) return 'pos';
  if (p < 0) return 'neg';
  return null;
}

/** Lifetime wallet_scores_ledger hue: cohort embed when present; else fetched summary when `ledgerEmbed === undefined`. */
function lifetimeLedgerPnlHue(
  ledgerEmbed: WalletScoresLedgerEmbed | null | undefined,
  summary: WalletSummary | null | undefined,
): 'pos' | 'neg' | null {
  if (ledgerEmbed !== undefined && ledgerEmbed !== null) return ledgerAggregatePnlSign(ledgerEmbed);
  if (summary !== undefined && summary !== null) return lifetimePnlHueFromSummary(summary);
  return null;
}

function walletScoresLedgerRowAbsent(
  ledgerEmbed: WalletScoresLedgerEmbed | null | undefined,
  summary: WalletSummary | null | undefined,
): boolean {
  if (ledgerEmbed === null) return true;
  if (ledgerEmbed === undefined && summary === null) return true;
  return false;
}

/** Gold (amber): ledger WR > 50%, ≥10 resolved markets, aggregate ledger PnL > 0 (`wallet_scores_ledger`). */
function ledgerGoldFromEmbed(embed: WalletScoresLedgerEmbed | null | undefined): boolean {
  if (embed == null) return false;
  if ((embed.resolvedMarkets ?? 0) < 10) return false;
  if (typeof embed.winRate !== 'number' || !Number.isFinite(embed.winRate)) return false;
  if (ledgerWinRateFracFromStored(embed.winRate) <= 0.5) return false;
  const pnl = embed.pnl;
  return typeof pnl === 'number' && Number.isFinite(pnl) && pnl > 0;
}

/** Gold “smart” only if proven smart and this-market cash flow is not negative. */
function isSmartGold(row: Pick<WalletPosition, 'isSmart' | 'cashFlow'>): boolean {
  if (!row.isSmart) return false;
  const c = row.cashFlow;
  const n = typeof c === 'number' && Number.isFinite(c) ? c : 0;
  return n >= -1e-6;
}

// Wallet hover tooltip — fetches summary on hover, caches results
const summaryCache: Record<string, WalletSummary | null> = {};

/** One toxic-flow wallet tooltip at a time: opening a new one broadcasts so other instances unmount their portal. */
const TOXIC_WALLET_TIP_OPEN = 'polybot:toxic-wallet-tip-open';

type WalletTipPos = { left: number; top: number; placeAbove: boolean };

/** Imperative hooks from `<tr>` so tooltip opens on row hover, not only the address cell. */
type WalletLinkHoverHandle = {
  rowEnter: (e: React.MouseEvent) => void;
  rowMove: (e: React.MouseEvent) => void;
  rowLeave: () => void;
};

const WalletLink = forwardRef<
  WalletLinkHoverHandle,
  {
    wallet: string;
    netShares?: number;
    onOpenWallet?: (wallet: string, netShares?: number) => void;
    isSmart?: boolean;
    /** Toxic-flow batched ledger: set (even `null`) to skip `/api/wallet-summary` hover fetch. */
    ledgerEmbed?: WalletScoresLedgerEmbed | null;
    ledgerGold?: boolean;
  }
>(function WalletLink(
  {
    wallet,
    netShares,
    onOpenWallet,
    isSmart,
    ledgerEmbed,
    ledgerGold,
  },
  ref,
) {
  const [summary, setSummary] = useState<WalletSummary | null | undefined>(undefined);
  const [show, setShow] = useState(false);
  const [tipPos, setTipPos] = useState<WalletTipPos | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const walletNormRef = useRef(wallet.toLowerCase());
  walletNormRef.current = wallet.toLowerCase();
  const enterTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);

  const clearLeaveTimer = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  const hardCloseTooltip = useCallback(() => {
    clearLeaveTimer();
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    setShow(false);
    setSummary(undefined);
    setTipPos(null);
  }, [clearLeaveTimer]);

  useEffect(() => {
    hardCloseTooltip();
  }, [wallet, hardCloseTooltip]);

  useEffect(() => {
    const onPeerOpen = (ev: Event) => {
      const detail = (ev as CustomEvent<{ wallet: string }>).detail;
      const openW = typeof detail?.wallet === 'string' ? detail.wallet.toLowerCase() : '';
      if (openW !== '' && openW !== walletNormRef.current) {
        hardCloseTooltip();
      }
    };
    window.addEventListener(TOXIC_WALLET_TIP_OPEN, onPeerOpen);
    return () => window.removeEventListener(TOXIC_WALLET_TIP_OPEN, onPeerOpen);
  }, [hardCloseTooltip]);

  useEffect(() => {
    return () => {
      if (enterTimerRef.current) {
        clearTimeout(enterTimerRef.current);
        enterTimerRef.current = null;
      }
      clearLeaveTimer();
    };
  }, [clearLeaveTimer]);

  const scheduleHide = useCallback(() => {
    clearLeaveTimer();
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null;
      setShow(false);
      setSummary(undefined);
      setTipPos(null);
    }, 220);
  }, [clearLeaveTimer]);

  const updateTipPosition = useCallback(() => {
    if (!show) return;
    const { x: cx, y: cy } = mousePosRef.current;
    const estW = 220;
    const estH = 260;
    const margin = 8;
    const gap = 14;
    let left = cx + gap;
    if (left + estW > window.innerWidth - margin) {
      left = cx - estW - gap;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - estW - margin));
    const spaceBelow = window.innerHeight - cy - margin;
    const placeAbove = spaceBelow < estH && cy > estH + margin + 40;
    const top = placeAbove ? cy - margin : cy + gap;
    setTipPos({
      left,
      top,
      placeAbove,
    });
  }, [show]);

  useLayoutEffect(() => {
    if (!show) {
      setTipPos(null);
      return;
    }
    updateTipPosition();
  }, [show, summary, wallet, updateTipPosition]);

  useEffect(() => {
    if (!show) return;
    updateTipPosition();
    const onMove = () => updateTipPosition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [show, updateTipPosition]);

  const runEnter = useCallback(
    (e?: React.MouseEvent) => {
      if (e) mousePosRef.current = { x: e.clientX, y: e.clientY };
      walletNormRef.current = wallet.toLowerCase();
      window.dispatchEvent(new CustomEvent(TOXIC_WALLET_TIP_OPEN, { detail: { wallet: walletNormRef.current } }));
      clearLeaveTimer();
      if (ledgerEmbed !== undefined) {
        setShow(true);
        setSummary(ledgerEmbed === null ? null : walletSummaryFromLedgerEmbed(wallet, ledgerEmbed));
        return;
      }
      enterTimerRef.current = window.setTimeout(async () => {
        enterTimerRef.current = null;
        const wkForFetch = walletNormRef.current;
        setShow(true);
        if (wkForFetch in summaryCache) {
          setSummary(summaryCache[wkForFetch]);
          return;
        }
        const s = await fetchWalletSummary(wallet);
        if (walletNormRef.current !== wkForFetch) return;
        summaryCache[wkForFetch] = s;
        setSummary(s);
      }, 300);
    },
    [wallet, ledgerEmbed, clearLeaveTimer],
  );

  const runLeave = useCallback(() => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    scheduleHide();
  }, [scheduleHide]);

  const runMove = useCallback(
    (e: React.MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
      if (show) updateTipPosition();
    },
    [show, updateTipPosition],
  );

  useImperativeHandle(
    ref,
    () => ({
      rowEnter: (e: React.MouseEvent) => runEnter(e),
      rowMove: runMove,
      rowLeave: runLeave,
    }),
    [runEnter, runMove, runLeave],
  );

  const walletTag = useToxicWalletTag(wallet);
  const polymarketNick = polymarketNicknameFromEmbed(ledgerEmbed);
  const displayLabel = toxicWalletDisplayLabel(wallet, { tag: walletTag, ledgerEmbed });

  const lifetimeHue = lifetimeLedgerPnlHue(ledgerEmbed, summary);
  const ledgerAbsent = walletScoresLedgerRowAbsent(ledgerEmbed, summary);

  const resolvedLowEmbed = toxicRowResolvedStatsLow(ledgerEmbed);
  const resolvedLowSummary =
    ledgerEmbed === undefined &&
    summary !== undefined &&
    summary !== null &&
    (summary.resolvedMarkets ?? 0) < 10;
  const resolvedStatsLow = resolvedLowEmbed || resolvedLowSummary;

  const smartGoldAddr = !ledgerAbsent && !resolvedStatsLow && (ledgerGold || isSmart);
  const addrClass = resolvedStatsLow || ledgerAbsent
    ? 'text-blue-400'
    : smartGoldAddr
      ? 'text-amber-400'
      : lifetimeHue === 'pos'
        ? 'text-green-400'
        : lifetimeHue === 'neg'
          ? 'text-red-400'
          : 'text-zinc-400';
  const btnTitle = (() => {
    const parts: string[] = [wallet];
    if (polymarketNick) parts.push(`Polymarket: ${polymarketNick}`);
    if (walletTag) parts.push(`tag: ${walletTag}`);
    if (resolvedStatsLow && !ledgerAbsent) parts.push('Fewer than 10 resolved markets (wallet_scores_ledger)');
    if (ledgerAbsent) parts.push('No wallet_scores_ledger row');
    if (!ledgerAbsent && !resolvedStatsLow) {
      if (lifetimeHue === 'pos') parts.push('Lifetime ledger PnL > 0 (wallet_scores_ledger)');
      else if (lifetimeHue === 'neg') parts.push('Lifetime ledger PnL < 0');
      else parts.push('Lifetime ledger PnL flat (~0)');
    }
    if (ledgerGold && isSmart) parts.push('Ledger WR >50%, ≥10 resolved, ledger PnL >0; proven smart wallet');
    else {
      if (ledgerGold) parts.push('Ledger WR >50%, ≥10 resolved markets, ledger PnL >0');
      if (isSmart) parts.push('Proven smart wallet');
    }
    return parts.length ? parts.join(' · ') : undefined;
  })();

  const tooltipInner = (
    <>
          <div className={`mb-1 text-[8px] ${addrClass}`}>{wallet.slice(0, 10)}...{wallet.slice(-6)}</div>
          {summary === undefined && <div className="text-gray-500">Loading...</div>}
          {summary === null && <div className="text-gray-500">No wallet_scores_ledger row</div>}
          {summary ? (
            <WalletScoresLedgerSummaryGrid s={summary} narrowSummary hideNetCash hideTotalMarkets />
          ) : null}
    </>
  );

  const portalTooltip =
    show &&
    tipPos &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="bg-gray-900 border border-gray-600 rounded shadow-xl p-2 min-w-[190px] max-w-[min(15rem,calc(100vw-16px))] max-h-[min(320px,70vh)] overflow-y-auto text-[9px] pointer-events-none select-none"
        style={{
          position: 'fixed',
          left: tipPos.left,
          top: tipPos.top,
          transform: tipPos.placeAbove ? 'translateY(-100%)' : undefined,
          zIndex: 70000,
        }}
      >
        {tooltipInner}
      </div>,
      document.body,
    );

  return (
    <span
      ref={anchorRef}
      className="relative flex h-full min-h-0 items-center"
      onMouseEnter={(e) => runEnter(e)}
      onMouseMove={runMove}
      onMouseLeave={runLeave}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenWallet?.(wallet, netShares);
        }}
        className={`${addrClass} hover:underline flex h-full max-w-full flex-nowrap items-center gap-1 whitespace-nowrap leading-none`}
        title={btnTitle}
      >
        <WalletAddressGlyph address={wallet} size={12} />
        <span className="truncate leading-none">{displayLabel}</span>
      </button>
      {portalTooltip}
    </span>
  );
});

interface WalletTableBodyRowProps {
  rank: number;
  w: WalletPosition;
  shadeRowByStakedNet: boolean;
  favouriteActive: boolean;
  bellActive: boolean;
  xActive: boolean;
  /** Row flash when |Staked Net| USD ≥ this (Tilt notifications “Whale amount”). */
  tiltWhaleAmountUsd: number;
  toggleFavouriteWallet: (addr: string, nickname?: string) => void;
  toggleBellWallet: (addr: string) => void;
  toggleXWallet: (addr: string) => void;
  onOpenWallet?: (wallet: string, netShares?: number) => void;
  stakedPct: number;
  cumStakedPct: number;
}

function WalletTableBodyRowImpl({
  rank,
  w,
  shadeRowByStakedNet,
  favouriteActive,
  bellActive,
  xActive,
  tiltWhaleAmountUsd,
  toggleFavouriteWallet,
  toggleBellWallet,
  toggleXWallet,
  onOpenWallet,
  stakedPct,
  cumStakedPct,
}: WalletTableBodyRowProps) {
  const hoverRef = useRef<WalletLinkHoverHandle>(null);
  const onRowEnter = useCallback((e: React.MouseEvent) => hoverRef.current?.rowEnter(e), []);
  const onRowMove = useCallback((e: React.MouseEvent) => hoverRef.current?.rowMove(e), []);
  const onRowLeave = useCallback(() => hoverRef.current?.rowLeave(), []);
  const onFavClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFavouriteWallet(w.wallet, polymarketNicknameFromEmbed(w.walletLedgerSummary) || undefined);
    },
    [toggleFavouriteWallet, w.wallet, w.walletLedgerSummary],
  );
  const onBellClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      toggleBellWallet(w.wallet);
    },
    [toggleBellWallet, w.wallet],
  );
  const onXClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      toggleXWallet(w.wallet);
    },
    [toggleXWallet, w.wallet],
  );

  const iy = typeof w.invYes === 'number' && Number.isFinite(w.invYes) ? w.invYes : w.netYes ?? 0;
  const inn = typeof w.invNo === 'number' && Number.isFinite(w.invNo) ? w.invNo : w.netNo ?? 0;
  const signedLegNet = iy - inn;
  const grossLeg = Math.abs(iy) + Math.abs(inn);
  const bias =
    typeof w.inventoryBias === 'number' && Number.isFinite(w.inventoryBias)
      ? w.inventoryBias
      : grossLeg > 0
        ? Math.abs(signedLegNet) / grossLeg
        : 0;
  const stakeNetSigned = walletStakeNetSignedUsd(w);
  const stakeNetAbsUsd = walletStakeNetAbsUsd(w);
  const rowNearResolved = walletHasSharePriceAtOrAbove95Cents(w);
  const tiltWhaleRowFlash =
    !rowNearResolved && Number.isFinite(stakeNetAbsUsd) && stakeNetAbsUsd >= tiltWhaleAmountUsd;
  const rowClass =
    walletRowClassForStakedNet(shadeRowByStakedNet, stakeNetSigned) +
    rowPulseClassFor(bellActive, tiltWhaleRowFlash) +
    (rowNearResolved ? ' toxic-flow-row-near-resolved' : '');
  const prevStakeNetRef = useRef<number | null>(null);
  const [stakedNetFlash, setStakedNetFlash] = useState<StakedNetFlashDir | null>(null);
  useEffect(() => {
    const prev = prevStakeNetRef.current;
    prevStakeNetRef.current = stakeNetSigned;
    if (prev === null || !Number.isFinite(stakeNetSigned)) return;
    const dir = stakedNetDeltaFlashDir(prev, stakeNetSigned);
    if (!dir) return;
    setStakedNetFlash(dir);
    const t = window.setTimeout(() => setStakedNetFlash(null), STAKED_NET_FLASH_MS);
    return () => window.clearTimeout(t);
  }, [stakeNetSigned]);
  const ledgerEmbed = w.walletLedgerSummary;

  return (
    <tr
      className={`${rowClass} ${TOXIC_TABLE_ROW_CLS}`}
      onMouseEnter={onRowEnter}
      onMouseMove={onRowMove}
      onMouseLeave={onRowLeave}
    >
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} pr-0 text-gray-600 ${TOXIC_TABLE_RANK_COL_CLS}`}>{rank}</td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} ${TOXIC_TABLE_FAV_COL_CLS}`}>
        <span className={`${TOXIC_TABLE_ROW_INNER_CLS} gap-0.5`}>
          <button
            type="button"
            className="rounded p-0 leading-none hover:bg-gray-600/40 text-gray-500 hover:text-gray-300"
            title={favouriteActive ? 'Remove favourite' : 'Add favourite'}
            aria-pressed={favouriteActive}
            onClick={onFavClick}
          >
            <Star size={12} className={favouriteActive ? STAR_CLS_ON : STAR_CLS_OFF} />
          </button>
          <button
            type="button"
            className="rounded p-0 leading-none hover:bg-gray-600/40 text-gray-500 hover:text-amber-200/90"
            title={bellActive ? 'Stop highlighting this wallet on Toxic tables' : 'Flash row when wallet is on this market'}
            aria-pressed={bellActive}
            onClick={onBellClick}
          >
            <Bell size={11} strokeWidth={2} className={bellActive ? BELL_CLS_ON : BELL_CLS_OFF} />
          </button>
          <button
            type="button"
            className="rounded p-0 leading-none hover:bg-gray-600/40 text-gray-500 hover:text-red-400/90"
            title={xActive ? 'Clear X mark' : 'Mark wallet with X'}
            aria-pressed={xActive}
            onClick={onXClick}
          >
            <X size={11} strokeWidth={2} className={xActive ? X_CLS_ON : X_CLS_OFF} />
          </button>
        </span>
      </td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} whitespace-nowrap px-1`}>
        <div className={TOXIC_TABLE_ROW_INNER_CLS}>
          <WalletLink
            ref={hoverRef}
            wallet={w.wallet}
            netShares={signedLegNet}
            onOpenWallet={onOpenWallet}
            isSmart={isSmartGold(w)}
            ledgerEmbed={ledgerEmbed}
            ledgerGold={ledgerGoldFromEmbed(ledgerEmbed)}
          />
        </div>
      </td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 font-bold ${invYToneClass(iy)} bg-green-900/10`}>{rowFmtInt(iy)}</td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 font-bold text-red-400 bg-red-900/10`}>{rowFmtInt(inn)}</td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 whitespace-nowrap tabular-nums`} title="inv_yes − inv_no (|net| Y / N)">
        {inventoryNetSharesTableCell(signedLegNet)}
      </td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 tabular-nums ${priceSharePxClass(w.priceYes)}`}>{fmtPriceShare(w.priceYes)}</td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 tabular-nums ${priceSharePxClass(w.priceNo)}`}>{fmtPriceShare(w.priceNo)}</td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 text-gray-400`}>
        {typeof w.tradeCount === 'number' && Number.isFinite(w.tradeCount) ? rowFmtInt(w.tradeCount) : '–'}
      </td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} px-1 ${TOXIC_TABLE_STAKED_COL_CLS}`} title="Staked Y − Staked N (column display); Y / N suffix">
        {stakedNetUsdTableCellWithFlash(stakeNetSigned, stakedNetFlash)}
      </td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} px-1 text-cyan-300 ${TOXIC_TABLE_STAKED_PCT_COL_CLS}`}>
        {stakedPct > 0 ? `${NF_PCT_1.format(stakedPct)}%` : '-'}
      </td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} px-1 text-cyan-200/70 ${TOXIC_TABLE_STAKED_PCT_COL_CLS}`}>
        {cumStakedPct > 0 ? `${NF_PCT_1.format(cumStakedPct)}%` : '-'}
      </td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 ${biasToneClass(signedLegNet)}`}>
        {`${NF_INT_EN.format(Math.round(bias * 100))}%`}
      </td>
    </tr>
  );
}

/**
 * Hot path optimization: skip row reconciliation when nothing the row reads has changed.
 *
 * `wallets` is a fresh array per WS tick, so each `w` is a fresh object. Default `memo` would
 * always invalidate. Compare scalar fields explicitly (these are the inputs to the body cells).
 */
const WalletTableBodyRow = memo(WalletTableBodyRowImpl, (a, b) => {
  if (
    a.rank !== b.rank ||
    a.shadeRowByStakedNet !== b.shadeRowByStakedNet ||
    a.favouriteActive !== b.favouriteActive ||
    a.bellActive !== b.bellActive ||
    a.xActive !== b.xActive ||
    a.tiltWhaleAmountUsd !== b.tiltWhaleAmountUsd ||
    a.stakedPct !== b.stakedPct ||
    a.cumStakedPct !== b.cumStakedPct ||
    a.toggleFavouriteWallet !== b.toggleFavouriteWallet ||
    a.toggleBellWallet !== b.toggleBellWallet ||
    a.toggleXWallet !== b.toggleXWallet ||
    a.onOpenWallet !== b.onOpenWallet
  ) {
    return false;
  }
  const wa = a.w;
  const wb = b.w;
  if (wa === wb) return true;
  if (
    wa.wallet !== wb.wallet ||
    wa.invYes !== wb.invYes ||
    wa.invNo !== wb.invNo ||
    wa.netYes !== wb.netYes ||
    wa.netNo !== wb.netNo ||
    wa.priceYes !== wb.priceYes ||
    wa.priceNo !== wb.priceNo ||
    wa.usdYes !== wb.usdYes ||
    wa.usdNo !== wb.usdNo ||
    wa.usdcYes !== wb.usdcYes ||
    wa.usdcNo !== wb.usdcNo ||
    wa.tradeCount !== wb.tradeCount ||
    wa.inventoryBias !== wb.inventoryBias ||
    wa.isSmart !== wb.isSmart
  ) {
    return false;
  }
  const ea = wa.walletLedgerSummary;
  const eb = wb.walletLedgerSummary;
  if (ea === eb) return true;
  if (ea == null || eb == null) return ea === eb;
  return (
    ea.totalMarkets === eb.totalMarkets &&
    ea.resolvedMarkets === eb.resolvedMarkets &&
    ea.totalTrades === eb.totalTrades &&
    ea.wins === eb.wins &&
    ea.losses === eb.losses &&
    ea.winRate === eb.winRate &&
    ea.pnl === eb.pnl &&
    ea.volume === eb.volume
  );
});

function WalletTableInner({
  wallets,
  label,
  totalStakedNetUsd,
  onOpenWallet,
  shadeRowByStakedNet = true,
}: {
  wallets: WalletPosition[] | null;
  label: string;
  /** Market Σ|staked net| USD (headline); falls back to sum of |Staked Net| in this table. */
  totalStakedNetUsd?: number | null;
  onOpenWallet?: (wallet: string, netShares?: number) => void;
  /** Row background from Staked Net sign (green YES / red NO); default on for all Toxic tables. */
  shadeRowByStakedNet?: boolean;
}) {
  const tiltWhaleAmountUsd = useSyncExternalStore(
    subscribeTiltWhaleAmountUsd,
    readTiltWhaleAmountUsd,
    () => DEFAULT_TILT_WHALE_AMOUNT_USD,
  );
  const rows = wallets || [];
  const totalStakedDenom = useMemo(() => {
    if (typeof totalStakedNetUsd === 'number' && Number.isFinite(totalStakedNetUsd) && totalStakedNetUsd > 0) {
      return totalStakedNetUsd;
    }
    let sum = 0;
    for (const w of rows) {
      const v = walletStakeNetAbsUsd(w);
      if (Number.isFinite(v)) sum += v;
    }
    return sum > 0 ? sum : 0;
  }, [rows, totalStakedNetUsd]);
  const rowStakedMetrics = useMemo(() => {
    let cum = 0;
    return rows.map((w) => {
      const abs = walletStakeNetAbsUsd(w);
      const pctRaw = totalStakedDenom > 0 && Number.isFinite(abs) ? (abs / totalStakedDenom) * 100 : 0;
      const stakedPct = Math.round(pctRaw * 10) / 10;
      cum += stakedPct;
      const cumStakedPct = Math.round(cum * 10) / 10;
      return { stakedPct, cumStakedPct };
    });
  }, [rows, totalStakedDenom]);
  const [favouriteWallets, setFavouriteWallets] = useState(readToxicFavouriteWallets);
  const [bellWallets, setBellWallets] = useState(readToxicBellWallets);
  const [xWallets, setXWallets] = useState(readToxicXWallets);
  useEffect(() => {
    const onFav = () => setFavouriteWallets(readToxicFavouriteWallets());
    const onBell = () => setBellWallets(readToxicBellWallets());
    const onX = () => setXWallets(readToxicXWallets());
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY || e.key === null) onFav();
      if (e.key === TOXIC_BELL_WALLETS_LS_KEY || e.key === null) onBell();
      if (e.key === TOXIC_X_WALLETS_LS_KEY || e.key === null) onX();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, onFav);
    window.addEventListener(TOXIC_BELLS_CHANGED_EVENT, onBell);
    window.addEventListener(TOXIC_X_CHANGED_EVENT, onX);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, onFav);
      window.removeEventListener(TOXIC_BELLS_CHANGED_EVENT, onBell);
      window.removeEventListener(TOXIC_X_CHANGED_EVENT, onX);
    };
  }, []);
  const toggleFavouriteWallet = useCallback((addr: string, nickname?: string) => {
    const k = addr.trim().toLowerCase();
    if (!k) return;
    setFavouriteWallets((prev) => {
      const next = new Set(prev);
      const adding = !next.has(k);
      if (adding) next.add(k);
      else next.delete(k);
      persistToxicFavouriteWallets(next);
      if (adding) {
        const nick = (nickname ?? '').trim();
        if (nick) setToxicFavouriteNickname(k, nick);
      }
      return next;
    });
  }, []);
  useEffect(() => {
    recordToxicFavouriteNicknamesFromRows(rows, favouriteWallets);
  }, [rows, favouriteWallets]);
  const toggleBellWallet = useCallback((addr: string) => {
    const k = addr.trim().toLowerCase();
    if (!k) return;
    primeTiltAudioContextFromUserGesture();
    setBellWallets((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      persistToxicBellWallets(next);
      return next;
    });
  }, []);
  const toggleXWallet = useCallback((addr: string) => {
    const k = addr.trim().toLowerCase();
    if (!k) return;
    setXWallets((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      persistToxicXWallets(next);
      return next;
    });
  }, []);
  const { sumYUsd: cohortSumYUsd, sumNUsd: cohortSumNUsd } = useMemo(
    () => toxicCohortStakedNetSurplusHalves(rows),
    [rows],
  );
  if (rows.length === 0) {
    return (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center text-gray-500 text-[10px] py-3">
        No {label} data yet
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden w-full min-w-0">
      <div className="shrink-0 px-0.5 pt-0.5 pb-1 border-b border-gray-800/90 bg-gray-950 z-[2]">
        <StakedLegUsdBar
          sumYUsd={cohortSumYUsd}
          sumNUsd={cohortSumNUsd}
          compact
          dense
          compactLabel="Stake"
          barMode="cohortSurplusHalves"
          midMarker
          compactShowLeanDirectionUsd
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto w-full min-w-0 overscroll-contain toxic-flow-scroll-stable">
      <table className="w-full min-w-full whitespace-nowrap text-[10px]">
        <thead className="sticky top-0 z-[1] bg-gray-950">
          <tr className="text-gray-500 border-b border-gray-700">
            <th className={`align-middle py-1 pr-0 ${TOXIC_TABLE_RANK_COL_CLS}`}>#</th>
            <th className={`align-middle py-1 text-left ${TOXIC_TABLE_FAV_COL_CLS}`} aria-label="Favourite, bell, and X mark" />
            <th className="align-middle py-1 text-left px-1">Wallet</th>
            <th className="align-middle py-1 text-right px-1 bg-green-900/15" title="inv_yes">
              Inv Y
            </th>
            <th className="align-middle py-1 text-right px-1 bg-red-900/15 text-red-300" title="inv_no">
              Inv N
            </th>
            <th className="align-middle py-1 text-right px-1" title="inv_yes − inv_no (shares); magnitude + Y / N, no leading minus">
              Net
            </th>
            <th className="align-middle py-1 text-right px-1 text-gray-400" title="price_yes">
              Px Y
            </th>
            <th className="align-middle py-1 text-right px-1 text-gray-400" title="price_no">
              Px N
            </th>
            <th className="align-middle py-1 text-right px-1">Trades</th>
            <th className={`align-middle py-1 px-1 text-gray-300 ${TOXIC_TABLE_STAKED_COL_CLS}`} title="(−inv_y×px_y) − (−inv_n×px_n) = Staked Y − Staked N as shown; suffix Y / N; green = favors YES / red = favors NO">
              Staked
            </th>
            <th
              className={`align-middle py-1 px-1 ${TOXIC_TABLE_STAKED_PCT_COL_CLS}`}
              title="|Staked| USD ÷ total market staked (Σ|signed net|)"
            >
              %
            </th>
            <th
              className={`align-middle py-1 px-1 ${TOXIC_TABLE_STAKED_PCT_COL_CLS}`}
              title="Running sum of % by table order (Staked / total staked)"
            >
              Cum%
            </th>
            <th className="align-middle py-1 text-right px-1">Bias</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w, i) => {
            const wk = (w.wallet || '').toLowerCase();
            const metrics = rowStakedMetrics[i] ?? { stakedPct: 0, cumStakedPct: 0 };
            return (
              <WalletTableBodyRow
                key={w.wallet}
                rank={i + 1}
                w={w}
                shadeRowByStakedNet={!!shadeRowByStakedNet}
                favouriteActive={favouriteWallets.has(wk)}
                bellActive={bellWallets.has(wk)}
                xActive={xWallets.has(wk)}
                toggleFavouriteWallet={toggleFavouriteWallet}
                toggleBellWallet={toggleBellWallet}
                toggleXWallet={toggleXWallet}
                tiltWhaleAmountUsd={tiltWhaleAmountUsd}
                onOpenWallet={onOpenWallet}
                stakedPct={metrics.stakedPct}
                cumStakedPct={metrics.cumStakedPct}
              />
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

const WalletTable = memo(WalletTableInner, (a, b) => {
  if (
    a.label !== b.label ||
    a.onOpenWallet !== b.onOpenWallet ||
    a.shadeRowByStakedNet !== b.shadeRowByStakedNet ||
    a.totalStakedNetUsd !== b.totalStakedNetUsd
  ) {
    return false;
  }
  const wa = a.wallets;
  const wb = b.wallets;
  if (wa === wb) return true;
  if (wa == null || wb == null) return wa === wb;
  if (wa.length !== wb.length) return false;
  for (let i = 0; i < wa.length; i++) {
    if (wa[i] !== wb[i]) return false;
  }
  return true;
});

export type WalletInfoPanelVariant = 'modal' | 'inline';

const WalletInfoPanelInner = memo(function WalletInfoPanelInner({
  open,
  wallet,
  initialMarketId,
  onClose,
  variant = 'modal',
  onInlineMarketsListOpenChange,
}: {
  open: boolean;
  wallet: string;
  /** When set (e.g. condition id), trades table opens on this market after load. */
  initialMarketId?: string;
  onClose: () => void;
  variant?: WalletInfoPanelVariant;
  /** Inline sidebar: notify parent when markets list expand toggles (width). */
  onInlineMarketsListOpenChange?: (open: boolean) => void;
}) {
  const [marketById, setMarketById] = useState<Record<string, import('../types').Market>>({});
  const [summary, setSummary] = useState<WalletSummary | null | undefined>(undefined);
  const [markets, setMarkets] = useState<WalletPosition[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [chartOutcomeTokens, setChartOutcomeTokens] = useState<MarketOutcomeTokensResponse | null>(null);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [fillsRefreshToken, setFillsRefreshToken] = useState(0);
  const [dailySnapshotsRefresh, setDailySnapshotsRefresh] = useState(0);
  const [profileNickname, setProfileNickname] = useState('');
  const [inlineMarketsListOpen, setInlineMarketsListOpen] = useState(false);
  const isInlineWalletInfo = variant === 'inline';
  const showMarketsList = !isInlineWalletInfo || inlineMarketsListOpen;
  const {
    trades: wsMarketTrades,
    total: fillsTotal,
    loading: loadingFills,
    refresh: refreshMarketTradesWS,
  } = useWalletMarketTradesWS(wallet, selectedMarketId, open && !!wallet && !!selectedMarketId);
  const fills = useMemo(
    () => wsMarketTrades.map((t) => wsTradeToFillRow(t, wallet, selectedMarketId)),
    [wsMarketTrades, wallet, selectedMarketId],
  );

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

  useEffect(() => {
    if (!open || !wallet) return;
    setSummary(undefined);
    setMarkets([]);
    setSelectedMarketId('');
    setInlineMarketsListOpen(false);
    setFillsRefreshToken(0);
    setDailySnapshotsRefresh(0);
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
      refreshMarketTradesWS();
      setFillsRefreshToken((n) => n + 1);
      setDailySnapshotsRefresh((n) => n + 1);
    } finally {
      setLoadingMarkets(false);
    }
  }, [open, wallet, selectedMarketId, loadMarketsAndSelect, refreshMarketTradesWS]);

  useEffect(() => {
    if (!open || !wallet || !selectedMarketId) return;
    refreshMarketTradesWS();
  }, [open, wallet, selectedMarketId, fillsRefreshToken, refreshMarketTradesWS]);

  useEffect(() => {
    const mid = selectedMarketId.trim();
    if (!open || !mid) {
      setChartOutcomeTokens(null);
      return;
    }
    let cancelled = false;
    setChartOutcomeTokens(null);
    void fetchMarketOutcomeTokens(mid).then((tok) => {
      if (!cancelled) setChartOutcomeTokens(tok);
    });
    return () => {
      cancelled = true;
    };
  }, [open, selectedMarketId]);

  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const polymarketTape = useSidebarPolymarketTape();
  const walletInfoChartTrades = liveTradesSource === 'onchain' ? [] : polymarketTape;

  const selectedMarketMeta = useMemo(
    () => resolveWalletInfoChartMarket(selectedMarketId, marketById, markets),
    [selectedMarketId, marketById, markets],
  );

  const selectedMarketForChart = useMemo(
    () =>
      walletInfoChartMarketWithOutcomeTokens(
        selectedMarketMeta,
        chartOutcomeTokens?.tokenIdYes || '',
        chartOutcomeTokens?.tokenIdNo || '',
      ),
    [selectedMarketMeta, chartOutcomeTokens],
  );

  const walletInfoFillMarkers = useMemo((): ChartTradeMarker[] => {
    const yesTok = selectedMarketForChart?.clobTokenIds?.[0]?.trim() || '';
    const noTok = selectedMarketForChart?.clobTokenIds?.[1]?.trim() || '';
    const out: ChartTradeMarker[] = [];
    for (const f of fills) {
      const action = String(f.action ?? '').trim().toUpperCase();
      if (action !== 'BUY' && action !== 'SELL') continue;
      const bt = Number(f.blockTime ?? 0);
      if (!bt) continue;
      const timeMs = bt > 1e12 ? bt : bt * 1000;
      const pr = f.price;
      if (pr == null || !Number.isFinite(pr)) continue;
      let priceCents = pr * 100;
      let side: 'BUY' | 'SELL' = action;
      const tid = String(f.tokenId || '').trim();
      const isNoLeg = noTok && tid && sameClobToken(tid, noTok) && !sameClobToken(tid, yesTok);
      if (isNoLeg) {
        priceCents = 100 - priceCents;
        side = action === 'BUY' ? 'SELL' : 'BUY';
      }
      out.push({ timeMs, priceCents, side });
    }
    return out;
  }, [fills, selectedMarketForChart]);

  const onMarketRowClick = useCallback((id: string) => {
    setSelectedMarketId(id);
  }, []);

  const summaryLeftRef = useRef<HTMLDivElement>(null);
  const [summaryLeftH, setSummaryLeftH] = useState(0);
  const [lgChartsSync, setLgChartsSync] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  const [walletIsFavourite, setWalletIsFavourite] = useState(false);
  const [walletBellActive, setWalletBellActive] = useState(false);
  const [walletXActive, setWalletXActive] = useState(false);

  useEffect(() => {
    if (!open || !wallet.trim()) {
      setWalletIsFavourite(false);
      setWalletBellActive(false);
      setWalletXActive(false);
      return;
    }
    const k = wallet.trim().toLowerCase();
    setWalletIsFavourite(readToxicFavouriteWallets().has(k));
    setWalletBellActive(readToxicBellWallets().has(k));
    setWalletXActive(readToxicXWallets().has(k));
  }, [open, wallet]);

  useEffect(() => {
    if (!open || !wallet.trim()) return;
    const k = wallet.trim().toLowerCase();
    const syncFav = () => setWalletIsFavourite(readToxicFavouriteWallets().has(k));
    const syncBell = () => setWalletBellActive(readToxicBellWallets().has(k));
    const syncX = () => setWalletXActive(readToxicXWallets().has(k));
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY ||
        e.key === TOXIC_BELL_WALLETS_LS_KEY ||
        e.key === TOXIC_X_WALLETS_LS_KEY ||
        e.key === null
      ) {
        syncFav();
        syncBell();
        syncX();
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, syncFav);
    window.addEventListener(TOXIC_BELLS_CHANGED_EVENT, syncBell);
    window.addEventListener(TOXIC_X_CHANGED_EVENT, syncX);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, syncFav);
      window.removeEventListener(TOXIC_BELLS_CHANGED_EVENT, syncBell);
      window.removeEventListener(TOXIC_X_CHANGED_EVENT, syncX);
    };
  }, [open, wallet]);

  const toggleWalletFavourite = useCallback(() => {
    const k = wallet.trim().toLowerCase();
    if (!k) return;
    const next = readToxicFavouriteWallets();
    const adding = !next.has(k);
    if (adding) next.add(k);
    else next.delete(k);
    persistToxicFavouriteWallets(next);
    setWalletIsFavourite(next.has(k));
  }, [wallet]);

  const toggleWalletBell = useCallback(() => {
    const k = wallet.trim().toLowerCase();
    if (!k) return;
    const next = readToxicBellWallets();
    if (next.has(k)) next.delete(k);
    else next.add(k);
    persistToxicBellWallets(next);
    setWalletBellActive(next.has(k));
  }, [wallet]);

  const toggleWalletX = useCallback(() => {
    const k = wallet.trim().toLowerCase();
    if (!k) return;
    const next = readToxicXWallets();
    if (next.has(k)) next.delete(k);
    else next.add(k);
    persistToxicXWallets(next);
    setWalletXActive(next.has(k));
  }, [wallet]);

  const walletTag = useToxicWalletTag(wallet);
  const [tagEditOpen, setTagEditOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');

  useEffect(() => {
    if (!open) {
      setTagEditOpen(false);
      setTagDraft('');
      return;
    }
    setTagDraft(walletTag ?? '');
  }, [open, wallet, walletTag]);

  const cancelTagEdit = useCallback(() => {
    setTagDraft(walletTag ?? '');
    setTagEditOpen(false);
  }, [walletTag]);

  const commitTag = useCallback(() => {
    const n = normalizeToxicWalletTagInput(tagDraft);
    if (n) setToxicWalletTag(wallet, n);
    else removeToxicWalletTag(wallet);
    setTagEditOpen(false);
  }, [wallet, tagDraft]);

  const startTagEdit = useCallback(() => {
    setTagDraft(walletTag ?? '');
    setTagEditOpen(true);
  }, [walletTag]);

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

  const polymarketNick = useMemo(() => {
    const fromSummary = polymarketNicknameTrim(summary?.polymarketNickname);
    if (fromSummary) return fromSummary;
    const fromProfile = polymarketNicknameTrim(profileNickname);
    if (fromProfile) return fromProfile;
    for (const row of markets) {
      const n = polymarketNicknameFromEmbed(row.walletLedgerSummary);
      if (n) return n;
    }
    return '';
  }, [summary, profileNickname, markets]);

  useEffect(() => {
    if (!open || !walletIsFavourite) return;
    const k = wallet.trim().toLowerCase();
    if (!k) return;
    recordToxicFavouriteNicknamesFromRows(markets, new Set([k]));
    if (polymarketNick) setToxicFavouriteNickname(k, polymarketNick);
  }, [open, wallet, walletIsFavourite, polymarketNick, markets]);

  if (!open) return null;
  const polymarketProfileUrl = polymarketSiteUrl(`profile/${wallet.trim().toLowerCase()}`);
  const polygonscanUrl = `https://polygonscan.com/address/${wallet.trim().toLowerCase()}`;
  const panelBody = (
    <>
        <div className="flex items-center justify-between mb-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-bold text-yellow-400">Wallet Info</span>
            <button
              type="button"
              className={`shrink-0 p-0.5 rounded hover:bg-gray-700/70 ${walletIsFavourite ? 'text-yellow-400' : 'text-gray-500'}`}
              title={walletIsFavourite ? 'Remove from favourites' : 'Add to favourites'}
              aria-pressed={walletIsFavourite}
              disabled={!wallet.trim()}
              onClick={(e) => {
                e.stopPropagation();
                toggleWalletFavourite();
              }}
            >
              <Star
                size={14}
                className={walletIsFavourite ? 'fill-yellow-400 stroke-yellow-500/90' : 'fill-none stroke-gray-400'}
                strokeWidth={walletIsFavourite ? 1.5 : 2}
              />
            </button>
            <button
              type="button"
              className={`shrink-0 p-0.5 rounded hover:bg-gray-700/70 ${walletBellActive ? 'text-amber-400' : 'text-gray-500'}`}
              title={
                walletBellActive
                  ? 'Stop highlighting this wallet on Toxic tables'
                  : 'Flash row when wallet is on this market'
              }
              aria-pressed={walletBellActive}
              disabled={!wallet.trim()}
              onClick={(e) => {
                e.stopPropagation();
                toggleWalletBell();
              }}
            >
              <Bell size={13} strokeWidth={2} className={walletBellActive ? BELL_CLS_ON : BELL_CLS_OFF} />
            </button>
            <button
              type="button"
              className={`shrink-0 p-0.5 rounded hover:bg-gray-700/70 ${walletXActive ? 'text-red-500' : 'text-gray-500'}`}
              title={walletXActive ? 'Clear X mark' : 'Mark wallet with X'}
              aria-pressed={walletXActive}
              disabled={!wallet.trim()}
              onClick={(e) => {
                e.stopPropagation();
                toggleWalletX();
              }}
            >
              <X size={13} strokeWidth={2} className={walletXActive ? X_CLS_ON : X_CLS_OFF} />
            </button>
            <button
              type="button"
              className="shrink-0 rounded px-1 py-0.5 text-[10px] font-bold text-gray-400 hover:bg-gray-700/70 hover:text-amber-200 disabled:opacity-40"
              title="Set wallet tag"
              disabled={!wallet.trim() || tagEditOpen}
              onClick={(e) => {
                e.stopPropagation();
                startTagEdit();
              }}
            >
              Tag
            </button>
            <span className="inline-flex min-w-0 max-w-full flex-nowrap items-center gap-1">
              <WalletAddressGlyph address={wallet} size={18} />
              {tagEditOpen ? (
                <InlineConfirmCancelInput
                  value={tagDraft}
                  onChange={setTagDraft}
                  onConfirm={commitTag}
                  onCancel={cancelTagEdit}
                  placeholder="tag"
                  inputClassName="inline-block w-28 max-w-[12rem] bg-gray-900 border border-gray-600 rounded px-1 text-white text-xs font-sans"
                />
              ) : (
                <>
                  {walletTag ? (
                    <button
                      type="button"
                      className="min-w-0 truncate text-xs font-bold text-amber-200 hover:underline"
                      title={`Tag: ${walletTag} — click to edit`}
                      onClick={(e) => {
                        e.stopPropagation();
                        startTagEdit();
                      }}
                    >
                      {walletTag}
                    </button>
                  ) : null}
                  {polymarketNick ? (
                    <span
                      className={`min-w-0 truncate ${walletTag ? 'text-[10px] text-blue-300' : 'text-xs font-medium text-blue-300'}`}
                      title={`Polymarket: ${polymarketNick}`}
                    >
                      {shortenWallet(polymarketNick)}
                    </span>
                  ) : walletTag ? null : (
                    <span className="min-w-0 truncate text-xs font-medium text-blue-300 font-mono" title={wallet}>
                      {wallet}
                    </span>
                  )}
                  {walletTag || polymarketNick ? (
                    <span className="min-w-0 truncate text-[10px] text-gray-500 font-mono" title={wallet}>
                      {shortenWallet(wallet)}
                    </span>
                  ) : null}
                </>
              )}
            </span>
            <button
              type="button"
              className="text-gray-400 hover:text-white"
              title="Copy wallet address"
              aria-label="Copy wallet address"
              onClick={() => {
                void navigator.clipboard.writeText(wallet);
              }}
            >
              <Copy size={13} />
            </button>
            <a
              href={polymarketProfileUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 inline-flex items-center justify-center rounded p-0.5 hover:bg-[#2f5cff]/30 border border-[#2d57ff]/50 bg-[#2f5cff]/20"
              title="Open Polymarket profile"
              aria-label="Open Polymarket profile"
            >
              <img
                src="/polymarket-favicon.ico"
                alt=""
                className="h-3.5 w-3.5 rounded-[2px] pointer-events-none"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </a>
            <a
              href={polygonscanUrl}
              target="_blank"
              rel="noreferrer"
              className="text-gray-400 hover:text-cyan-300"
              title="Open on Polygonscan"
              aria-label="Open on Polygonscan"
            >
              <ExternalLink size={13} />
            </a>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
        <div className="text-[10px] shrink-0 flex flex-col">
          <div className="bg-gray-900 rounded p-2 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-1 shrink-0">
              <div className="text-gray-500 font-semibold">
                Summary <span className="font-normal text-gray-600">[updated every hour]</span>
              </div>
              <button
                type="button"
                className="shrink-0 p-0.5 rounded text-gray-500 hover:text-white hover:bg-gray-800 disabled:opacity-40"
                title="Refresh markets & trades"
                aria-label="Refresh markets and trades"
                disabled={!wallet || loadingMarkets || loadingFills}
                onClick={() => {
                  void onRefreshMarketsAndTrades();
                }}
              >
                <RefreshCw size={12} className={loadingMarkets || loadingFills ? 'animate-spin' : ''} />
              </button>
            </div>
            <div
              className="mt-1 flex flex-col lg:flex-row gap-3 lg:items-start items-stretch min-w-0 min-h-0"
              style={
                lgChartsSync && summaryLeftH > 0
                  ? { height: summaryLeftH, maxHeight: summaryLeftH }
                  : undefined
              }
            >
              <div
                ref={summaryLeftRef}
                className="shrink-0 w-full lg:w-[min(16.5rem,calc(100%/4))] lg:max-w-[16.5rem] flex flex-col lg:self-start"
              >
                {summary === undefined && <div className="text-gray-500">Loading...</div>}
                {summary === null && <div className="text-gray-500">No wallet_scores_ledger row</div>}
                {summary && (
                  <WalletScoresLedgerSummaryGrid
                    s={summary}
                    narrowSummary
                    hideNetCash
                    hideTotalMarkets
                    showLastUpdated
                  />
                )}
              </div>
              {wallet.trim() ? (
                <div
                  className="min-w-0 flex-1 flex flex-col min-h-0 overflow-hidden lg:border-l lg:border-gray-800 lg:pl-3"
                  style={
                    lgChartsSync && summaryLeftH > 0
                      ? { height: summaryLeftH, maxHeight: summaryLeftH, minHeight: 0 }
                      : undefined
                  }
                >
                  <WalletScoresDailyCharts wallet={wallet.trim()} refreshToken={dailySnapshotsRefresh} chartsLayout="row" compactSummary />
                </div>
              ) : null}
            </div>
          </div>
        </div>

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
          <div
            className={`bg-gray-900 rounded p-2 min-h-0 h-full min-w-0 flex flex-col overflow-hidden${isInlineWalletInfo ? ' shrink-0 w-[min(36rem,42%)] max-w-[36rem]' : ''}`}
          >
            <div className="flex items-center justify-between gap-2 mb-1 shrink-0">
              <div className="text-[10px] text-gray-400 font-bold">Latest Markets Traded</div>
              <button
                type="button"
                className="text-[10px] text-blue-400 hover:underline shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                disabled={loadingMarkets || markets.length === 0}
                onClick={() => exportWalletMarketsCsv(wallet, markets, useAppStore.getState().marketLookup)}
              >
                Export CSV
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
              <div className="min-h-full">
              <WalletLatestMarketsTradedTable
                markets={markets}
                marketById={marketById}
                loading={loadingMarkets}
                selectedMarketId={selectedMarketId}
                onRowClick={onMarketRowClick}
              />
              </div>
            </div>
          </div>
          ) : null}

          {isInlineWalletInfo ? (
            <button
              type="button"
              className={`wallet-info-markets-expand-handle shrink-0 w-6 flex flex-col justify-center items-center border-x border-gray-700/55 bg-gray-800/95 text-gray-500 hover:text-gray-400 ${inlineMarketsListOpen ? '' : 'sidebar-expand-handle-idle-flash'}`}
              title={inlineMarketsListOpen ? 'Hide markets list' : 'Show markets list'}
              aria-expanded={inlineMarketsListOpen}
              aria-label={inlineMarketsListOpen ? 'Hide markets list' : 'Show markets list'}
              onClick={() => setInlineMarketsListOpen((v) => !v)}
            >
              {inlineMarketsListOpen ? (
                <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
              ) : (
                <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
              )}
            </button>
          ) : null}

          <div className={`bg-gray-900 rounded p-2 min-h-0 h-full min-w-0 flex flex-col overflow-hidden${isInlineWalletInfo ? ' flex-1' : ''}`}>
            <div className="flex items-center justify-between gap-2 mb-1 shrink-0 min-w-0">
              <div className="text-[10px] text-gray-400 font-bold min-w-0 truncate">
                Trades For Selected Market {selectedMarketId ? <span className="text-gray-500">({selectedMarketId})</span> : null}
              </div>
              <button
                type="button"
                className="text-[10px] text-blue-400 hover:underline shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                disabled={loadingFills || fills.length === 0 || !selectedMarketId}
                onClick={() => exportWalletFillsCsv(wallet, fills, useAppStore.getState().marketLookup, selectedMarketId)}
              >
                Export CSV
              </button>
            </div>
            {selectedMarketForChart?.clobTokenIds?.[0] ? (
              <div className="shrink-0 mb-1 border-b border-gray-800/80 pb-1">
                <SidebarRightLiveTradeChart
                  market={selectedMarketForChart}
                  trades={walletInfoChartTrades}
                  tradeMarkers={walletInfoFillMarkers}
                />
              </div>
            ) : null}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
            {loadingFills ? (
              <div className="text-gray-500 text-[10px]">Loading trades...</div>
            ) : fills.length === 0 ? (
              <div className="text-gray-500 text-[10px]">No trades for this wallet/market.</div>
            ) : (
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-1">Time</th>
                    <th className="text-left">Action</th>
                    <th className="text-left">Side</th>
                    <th className="text-center w-6 px-0" title="Taker (wallet_fill_ledger.is_taker)">
                      T
                    </th>
                    <th className="text-right">Shares</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">USDC</th>
                    <th className="text-right">Fee</th>
                    <th className="text-right">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {fills.map((f) => {
                    const mid = String(f.marketId || '').trim().toLowerCase();
                    const mk =
                      marketById[selectedMarketId] ||
                      (mid && marketById[mid]) ||
                      {};
                    const bt = Number((f as { blockTime?: number }).blockTime ?? 0);
                    const ts = formatWalletTradeTime(bt);
                    if (isLedgerFillRow(f)) {
                      const sz = Number(f.size);
                      const pr = f.price;
                      const priceFinite = pr != null && Number.isFinite(pr);
                      const sizeFinite = Number.isFinite(sz);
                      const priceLabel = priceFinite
                        ? `${(pr * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}¢`
                        : '—';
                      const usdc = priceFinite && sizeFinite ? pr * sz : NaN;
                      const usdcLabel = Number.isFinite(usdc) ? `$${fmtUsd2En(usdc)}` : '—';
                      const feeN = Number(f.fee);
                      const feeLabel = Number.isFinite(feeN) ? `$${fmtUsd2En(feeN)}` : '—';
                      const rawSide = String(f.side ?? '').trim();
                      const sideLabel = rawSide || '—';
                      const su = rawSide.toUpperCase();
                      const sideCls =
                        su === 'YES' || su === 'Y' ? 'text-green-400' : su === 'NO' || su === 'N' ? 'text-red-400' : 'text-gray-300';
                      const action = String(f.action ?? '').trim();
                      const actionU = action.toUpperCase();
                      const actionCls =
                        actionU === 'BUY'
                          ? 'text-green-400'
                          : actionU === 'SELL'
                            ? 'text-red-400'
                            : actionU === 'SPLIT' || actionU === 'MERGE'
                              ? 'text-purple-400'
                              : actionU === 'REDEEM'
                                ? 'text-blue-400'
                                : 'text-gray-300';
                      return (
                        <tr key={toxicFlowFillKey(f.txHash, f.logIndex, String(f.tokenId || ''))} className="border-b border-gray-800">
                          <td className="py-0.5">{ts}</td>
                          <td className={actionCls}>{action || '—'}</td>
                          <td className={sideCls}>{sideLabel}</td>
                          <td className="text-center text-amber-300 font-bold tabular-nums px-0">
                            {f.isTaker === true ? 'T' : ''}
                          </td>
                          <td className="text-right tabular-nums">
                            {sizeFinite ? sz.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                          </td>
                          <td className="text-right text-gray-300 tabular-nums">{priceLabel}</td>
                          <td className="text-right text-yellow-400">{usdcLabel}</td>
                          <td className="text-right text-yellow-400/80">{feeLabel}</td>
                          <td className="text-right">
                            <a href={`https://polygonscan.com/tx/${f.txHash}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                              {f.txHash.slice(0, 6)}…{f.txHash.slice(-4)}
                            </a>
                          </td>
                        </tr>
                      );
                    }
                    const isSplitMerge = f.orderHash === 'SPLIT' || f.orderHash === 'MERGE';
                    if (isSplitMerge) {
                      const label = String(f.orderHash);
                      const amount = Number(f.makerAmount ?? 0);
                      const feeN = Number(f.fee ?? 0);
                      const feeLabel = Number.isFinite(feeN) ? `$${fmtUsd2En(feeN)}` : '—';
                      return (
                        <tr key={toxicFlowFillKey(f.txHash, f.logIndex)} className="border-b border-gray-800">
                          <td className="py-0.5">{ts}</td>
                          <td className="text-purple-400" colSpan={2}>{label}</td>
                          <td className="text-center text-amber-300 font-bold px-0">{f.isTaker === true ? 'T' : ''}</td>
                          <td className="text-right tabular-nums">
                            {Number.isFinite(amount)
                              ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                              : '—'}
                          </td>
                          <td className="text-right text-gray-500">—</td>
                          <td className="text-right text-gray-500 tabular-nums">
                            {Number.isFinite(amount) ? `$${fmtUsd2En(amount)}` : '—'}
                          </td>
                          <td className="text-right text-yellow-400/80">{feeLabel}</td>
                          <td className="text-right">
                            <a href={`https://polygonscan.com/tx/${f.txHash}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                              {f.txHash.slice(0, 6)}…{f.txHash.slice(-4)}
                            </a>
                          </td>
                        </tr>
                      );
                    }
                    const walletLower = wallet.toLowerCase();
                    const isTaker = (f.taker || '').toLowerCase() === walletLower;
                    const walletPaysUsdc = (isTaker && f.takerAssetId === '0') || (!isTaker && f.makerAssetId === '0');
                    const wa = String(f.walletAccountSide || '').toUpperCase();
                    const action = wa === 'BUY' || wa === 'SELL' ? wa : (walletPaysUsdc ? 'BUY' : 'SELL');
                    const shares = walletPaysUsdc
                      ? (isTaker ? f.makerAmount : f.takerAmount)
                      : (isTaker ? f.takerAmount : f.makerAmount);
                    const usdc = walletPaysUsdc
                      ? (isTaker ? f.takerAmount : f.makerAmount)
                      : (isTaker ? f.makerAmount : f.takerAmount);
                    const nShares = Number(shares);
                    const nUsdc = Number(usdc);
                    const pricePerShare = nShares > 1e-9 && Number.isFinite(nShares) && Number.isFinite(nUsdc) ? nUsdc / nShares : NaN;
                    const priceLabel = Number.isFinite(pricePerShare)
                      ? `${(pricePerShare * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}¢`
                      : '—';
                    const { text: sideText, tone: sideTone } = fillOutcomeDisplay(f, mk);
                    const sideCls = sideTone === 'yes' ? 'text-green-400' : sideTone === 'no' ? 'text-red-400' : 'text-gray-300';
                    const feeN = Number(f.fee ?? 0);
                    const feeLabel = Number.isFinite(feeN) ? `$${fmtUsd2En(feeN)}` : '—';
                    return (
                      <tr key={toxicFlowFillKey(f.txHash, f.logIndex)} className="border-b border-gray-800">
                        <td className="py-0.5">{ts}</td>
                        <td className={action === 'BUY' ? 'text-green-400' : 'text-red-400'}>{action}</td>
                        <td className={sideCls}>{sideText}</td>
                        <td className="text-center text-amber-300 font-bold tabular-nums px-0">
                          {f.isTaker === true ? 'T' : ''}
                        </td>
                        <td className="text-right tabular-nums">
                          {Number.isFinite(nShares)
                            ? nShares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : '—'}
                        </td>
                        <td className="text-right text-gray-300 tabular-nums">{priceLabel}</td>
                        <td className="text-right text-yellow-400 tabular-nums">
                          {Number.isFinite(nUsdc) ? `$${fmtUsd2En(nUsdc)}` : '—'}
                        </td>
                        <td className="text-right text-yellow-400/80 tabular-nums">{feeLabel}</td>
                        <td className="text-right">
                          <a href={`https://polygonscan.com/tx/${f.txHash}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                            {f.txHash.slice(0, 6)}…{f.txHash.slice(-4)}
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            </div>
            <div className="mt-2 text-[10px] text-gray-400 shrink-0 pt-1 border-t border-gray-800">
              <span>
                {fmtIntEn(fills.length)} shown · {fmtIntEn(fillsTotal)} total (live WS)
              </span>
            </div>
          </div>
        </div>
        </div>
    </>
  );

  if (variant === 'inline') {
    return (
      <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
        {panelBody}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[60010] flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="bg-gray-800 rounded-lg p-3 w-full mx-4 shadow-xl border border-gray-700 max-w-[min(98vw,93.6rem)] max-h-[88vh] min-h-[50vh] flex flex-col overflow-hidden"
      >
        {panelBody}
      </div>
    </div>
  );
});

export function WalletInfoPanel(props: {
  open: boolean;
  wallet: string;
  initialMarketId?: string;
  onClose: () => void;
  variant?: WalletInfoPanelVariant;
}) {
  return <WalletInfoPanelInner {...props} />;
}

const InlineWalletInfoPanelHost = memo(function InlineWalletInfoPanelHost({
  wallet,
  initialMarketId,
  onClose,
  onInlineMarketsListOpenChange,
}: {
  wallet: string;
  initialMarketId: string;
  onClose: () => void;
  onInlineMarketsListOpenChange?: (open: boolean) => void;
}) {
  return (
    <WalletInfoPanelInner
      variant="inline"
      open
      wallet={wallet}
      initialMarketId={initialMarketId}
      onClose={onClose}
      onInlineMarketsListOpenChange={onInlineMarketsListOpenChange}
    />
  );
}, (a, b) =>
  a.wallet === b.wallet &&
  a.initialMarketId === b.initialMarketId &&
  a.onClose === b.onClose &&
  a.onInlineMarketsListOpenChange === b.onInlineMarketsListOpenChange);

export function WalletInfoDialog({
  open,
  wallet,
  initialMarketId,
  onClose,
}: {
  open: boolean;
  wallet: string;
  initialMarketId?: string;
  onClose: () => void;
}) {
  if (!open) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <WalletInfoPanel open={open} wallet={wallet} initialMarketId={initialMarketId} onClose={onClose} variant="modal" />,
    document.body,
  );
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
    let n =
      typeof dialogMarketStakedLegs.stakedSumAbsSignedNetUsd === 'number' &&
      Number.isFinite(dialogMarketStakedLegs.stakedSumAbsSignedNetUsd)
        ? dialogMarketStakedLegs.stakedSumAbsSignedNetUsd
        : Math.abs(dialogMarketStakedLegs.stakedUsdYesLeg - dialogMarketStakedLegs.stakedUsdNoLeg);
    return Number.isFinite(n) ? n : null;
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
  marketId,
  open,
  tabWalletViews,
  layoutMode,
  tab,
  tabBottom,
  tabThird,
  setTab,
  setTabBottom,
  setTabThird,
  openWalletDialog,
  layoutSwitch,
}: {
  yesTokenId: string;
  marketId: string;
  open: boolean;
  tabWalletViews: ToxicFlowTabWalletViews;
  layoutMode: ToxicFlowLayoutMode;
  tab: Tab;
  tabBottom: Tab;
  tabThird: Tab;
  setTab: (tab: Tab) => void;
  setTabBottom: (tab: Tab) => void;
  setTabThird: (tab: Tab) => void;
  openWalletDialog: (wallet: string, netShares?: number) => void;
  layoutSwitch: ReactNode;
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
  useToxicBellRowRingSound(bellFlashingRowCount, open && !marketNotifyMuted);
  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden mt-2 bg-gray-900/60 rounded p-2 w-full">
      {layoutMode === 'single' && (
        <ToxicFlowTablePane
          tab={tab}
          onTab={setTab}
          tabWalletViews={tabWalletViews}
          totalStakedNetUsd={totalStakedNetUsd}
          onOpenWallet={openWalletDialog}
          trailing={layoutSwitch}
        />
      )}
      {layoutMode === 'split' && (
        <ToxicFlowResizableStack layoutKey="split">
          <ToxicFlowTablePane
            tab={tab}
            onTab={setTab}
            tabWalletViews={tabWalletViews}
            totalStakedNetUsd={totalStakedNetUsd}
            onOpenWallet={openWalletDialog}
            trailing={layoutSwitch}
          />
          <ToxicFlowTablePane
            tab={tabBottom}
            onTab={setTabBottom}
            tabWalletViews={tabWalletViews}
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
            totalStakedNetUsd={totalStakedNetUsd}
            onOpenWallet={openWalletDialog}
            trailing={layoutSwitch}
          />
          <ToxicFlowTablePane
            tab={tabBottom}
            onTab={setTabBottom}
            tabWalletViews={tabWalletViews}
            totalStakedNetUsd={totalStakedNetUsd}
            onOpenWallet={openWalletDialog}
          />
          <ToxicFlowTablePane
            tab={tabThird}
            onTab={setTabThird}
            tabWalletViews={tabWalletViews}
            totalStakedNetUsd={totalStakedNetUsd}
            onOpenWallet={openWalletDialog}
          />
        </ToxicFlowResizableStack>
      )}
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
    a.layoutSwitch !== b.layoutSwitch
  ) {
    return false;
  }
  if (a.tabWalletViews === b.tabWalletViews) return true;
  const va = a.tabWalletViews;
  const vb = b.tabWalletViews;
  const keys = ['topYes', 'topNo', 'topHolders', 'smart', 'favourites', 'whales', 'winners'] as const;
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

const ToxicFlowDialogInner = memo(function ToxicFlowDialogInner({
  open,
  marketId,
  marketName,
  yesTokenId,
  onClose,
  embedded = false,
  streamData = undefined,
  streamTabWalletViews = undefined,
  onRefreshStream: _onRefreshStream,
  streamRefreshing: _streamRefreshing = false,
  onInlineWalletExtraWidthChange,
}: ToxicFlowDialogProps) {
  const yesTok = (yesTokenId || '').trim();
  const [internalData, setInternalData] = useState<ToxicFlowData | null>(null);
  const internalDataRef = useRef<ToxicFlowData | null>(null);
  const [internalLoading, setInternalLoading] = useState(false);
  const [internalError, setInternalError] = useState('');
  const data = embedded ? (streamData ?? null) : internalData;
  const midTrim = (marketId || '').trim();
  const loading = embedded
    ? Boolean(open && midTrim && streamData === null)
    : internalLoading;
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
  useEffect(() => {
    const sync = () => setToxicFollowSet(readToxicFavouriteWallets());
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY || e.key === null) sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, sync);
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
    () => (data ? buildToxicFlowTabWalletViews(data, toxicFollowSet, tiltWhaleAmountUsd) : null),
    [data, toxicFollowSet, tiltWhaleAmountUsd],
  );
  const tabWalletViews =
    embedded && streamTabWalletViews !== undefined ? streamTabWalletViews : tabWalletViewsBuilt;

  const openWalletDialog = useCallback((wallet: string, _netShares?: number) => {
    const w = wallet.trim();
    if (!w) return;
    setSelectedWallet(w);
    setWalletDialogOpen(true);
    if (!isWide1920Ref.current) return;
    if (inlineWalletSlotRef.current && inlineWalletWidthRef.current !== '0px') {
      walletOpenAnimRef.current = false;
      setInlineWalletWidth(TOXIC_INLINE_WALLET_WIDTH_COMPACT);
      return;
    }
    walletOpenAnimRef.current = true;
    setInlineWalletSlot(true);
    setInlineWalletWidth('0px');
  }, []);

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

  const layoutSwitch = <ToxicFlowLayoutSwitch mode={layoutMode} onMode={onLayoutModeChange} />;

  const holdersHeader = (
    <div className="flex items-center gap-2 min-w-0 mb-3 shrink-0">
      <UsersRound size={16} className="text-yellow-400 shrink-0" />
      <span className="text-sm font-bold text-yellow-400 shrink-0">Holders</span>
      <span className="text-xs text-gray-400 truncate">{marketName}</span>
    </div>
  );

  const holdersBody = (
    <>
      {loading && <div className="text-gray-500 text-center py-8 shrink-0">Loading on-chain data...</div>}
      {error && <div className="text-red-400 text-center py-8 shrink-0">Error: {error}</div>}

      {!loading && !error && data && (
        <>
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
            <ToxicFlowStakedStatCell yesTokenId={yesTok} marketId={midTrim} open={open} />
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

          {data.totalWallets === 0 && (
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
          )}

          {tabWalletViews ? (
            <ToxicFlowDialogTableStack
              yesTokenId={yesTok}
              marketId={midTrim}
              open={open}
              tabWalletViews={tabWalletViews}
              layoutMode={layoutMode}
              tab={tab}
              tabBottom={tabBottom}
              tabThird={tabThird}
              setTab={setTab}
              setTabBottom={setTabBottom}
              setTabThird={setTabThird}
              openWalletDialog={openWalletDialog}
              layoutSwitch={layoutSwitch}
            />
          ) : null}
        </>
      )}
    </>
  );

  const inlineWalletPanel = inlineSplit && selectedWallet ? (
    <div className="toxic-inline-wallet-panel flex flex-col min-h-0 h-full overflow-hidden">
      <div
        className="flex flex-col min-h-0 h-full border-l border-gray-700/80 pl-2 overflow-hidden"
        style={{ width: inlineWalletWidth, maxWidth: inlineWalletWidth }}
      >
        <InlineWalletInfoPanelHost
          wallet={selectedWallet}
          initialMarketId={marketId}
          onClose={closeWalletPanel}
          onInlineMarketsListOpenChange={onInlineMarketsListOpenChange}
        />
      </div>
    </div>
  ) : null;

  const rootClass = embedded
    ? 'flex flex-col flex-1 min-h-0 min-w-0 h-full w-full overflow-hidden bg-gray-900'
    : 'fixed inset-0 bg-black/60 z-[49999] flex items-center justify-center';
  const cardClass = embedded
    ? 'bg-gray-800 flex flex-col flex-1 min-h-0 min-w-0 p-3 border-0 border-gray-700/50 w-full rounded-none shadow-none'
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
              <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">{holdersBody}</div>
            </div>
            {inlineWalletPanel}
          </div>
        ) : (
          <>
            {holdersHeader}
            <div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">{holdersBody}</div>
          </>
        )}
        {showInlineWalletModal ? (
          <WalletInfoDialog
            open={walletDialogOpen}
            wallet={selectedWallet}
            initialMarketId={marketId}
            onClose={closeWalletPanel}
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
    a.onClose !== b.onClose ||
    a.streamRefreshing !== b.streamRefreshing ||
    a.onRefreshStream !== b.onRefreshStream ||
    a.onInlineWalletExtraWidthChange !== b.onInlineWalletExtraWidthChange ||
    a.streamTabWalletViews !== b.streamTabWalletViews
  ) {
    return false;
  }
  const sa = a.streamData;
  const sb = b.streamData;
  if (sa === sb) return true;
  if (sa == null || sb == null) return sa === sb;
  return toxicFlowPayloadEqual(sa, sb);
});
