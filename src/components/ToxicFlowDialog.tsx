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
import { getOnchainTradesWSShared, OnchainTradesWSBridge, useWalletMarketTradesWS, type WSTrade } from '../hooks/useOnchainTradesWS';
import {
  buildMarketByIdRecord,
  sortWalletPositionsByDisplayedDateDesc,
  WalletLatestMarketsTradedTable,
  WalletSelectedMarketPositionStrip,
  fmtPriceShare,
} from './WalletLatestMarketsTradedTable';
import { ToxicFlowWalletTable as WalletTable } from './ToxicFlowWalletTable';
import { ToxicFlowTabsTip } from './ToxicFlowTabsTip';
import { ToxicFlowRowActionsTip } from './ToxicFlowRowActionsTip';
import { persistToxicFlowTabsTipDismissed, readToxicFlowTabsTipDismissed } from '../lib/toxicFlowTabsTip';
import {
  persistToxicFlowRowActionsTipDismissed,
  readToxicFlowRowActionsTipDismissed,
} from '../lib/toxicFlowRowActionsTip';
import { exportWalletFillsCsv, exportWalletMarketsCsv } from '../lib/walletInfoCsvExport';
import { fetchPolymarketNickname } from '../api/polymarket';
import { polymarketSiteUrl } from '../lib/polymarketSiteUrl';
import { WalletScoresDailyCharts } from './WalletScoresDailyCharts';
import type { MyTradeChartRow } from '../lib/chartTradeMarkers';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';
import {
  enrichMarketByIdFromWalletPositions,
  resolveWalletInfoChartMarket,
  walletInfoChartMarketWithOutcomeTokens,
} from '../lib/walletInfoChartMarket';
import { useSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import type { Market } from '../types';
import { HelperTooltip } from './HelperTooltip';
import { formatPolymarketVolumeK, formatThousandsAsK } from '../utils/format';
import { useTradeElapsedTick } from '../hooks/useTradeElapsedTick';
import { MemoWalletTradeTimeCell } from './WalletTradeTimeCell';
import { isSmartGoldTrader, walletAddressColorClass } from '../lib/walletAddressColor';
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
        <WalletTable
          wallets={wallets}
          label={label}
          totalStakedNetUsd={totalStakedNetUsd}
          onOpenWallet={onOpenWallet}
          rowActionsTipOpen={rowActionsTipOpen}
          onDismissRowActionsTip={onDismissRowActionsTip}
          rowActionsAnchorRef={rowActionsAnchorRef}
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

const BELL_CLS_ON = 'text-amber-400 fill-amber-400/25';
const BELL_CLS_OFF = 'stroke-gray-400 fill-none';
const X_CLS_ON = 'text-red-500 fill-red-500/20 stroke-red-500';
const X_CLS_OFF = 'stroke-gray-400 fill-none';

function polymarketNicknameTrim(n?: string | null): string {
  return (n ?? '').trim();
}

function polymarketNicknameFromEmbed(embed?: WalletScoresLedgerEmbed | null): string {
  return polymarketNicknameTrim(embed?.polymarketNickname);
}

function shortenWallet(w: string): string {
  if (w.length <= 12) return w;
  return w.slice(0, 6) + '…' + w.slice(-4);
}

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

function isUpDownFromFill(mk: Market | Record<string, unknown>, f: OnchainFillRow): boolean {
  const blob = `${f.marketType || ''} ${(mk as Market)?.question || ''} ${(mk as Market)?.eventSlug || ''}`.toLowerCase();
  return /upordown|up-down|up\s*or\s*down|updown/.test(blob);
}

function fillOutcomeDisplay(f: OnchainFillRow, mk: Market | Record<string, unknown>): { text: string; tone: 'yes' | 'no' | 'muted' } {
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
  const yT = String((mk as Market)?.clobTokenIds?.[0] ?? '').trim();
  const nT = String((mk as Market)?.clobTokenIds?.[1] ?? '').trim();
  if (tid && yT && sameClobToken(tid, yT)) return { text: yesLab, tone: 'yes' };
  if (tid && nT && sameClobToken(tid, nT)) return { text: noLab, tone: 'no' };
  return { text: '-', tone: 'muted' };
}

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
  hideNetCash?: boolean;
  hideTotalMarkets?: boolean;
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
      <LedgerSummaryField rowClass={row} label="Total Trades" help="Count of on-chain fill rows (Σ wallet_market_positions.trades) for this wallet across all markets." value={fmtIntEn(tt)} />
      <LedgerSummaryField rowClass={row} label="Volume" help="Notional traded in USDC: sum of usdc_in + usdc_out across all wallet_market_positions rows for this wallet." value={<>${volStr}</>} valueClassName="text-yellow-400 font-medium" />
      {!hideTotalMarkets ? (
        <LedgerSummaryField rowClass={row} label="Total Markets" help="Number of distinct markets where this wallet has at least one position row in wallet_market_positions." value={fmtIntEn(s.totalMarkets ?? 0)} />
      ) : null}
      <LedgerSummaryField rowClass={row} label="Resolved Markets" help="Markets with a recorded on-chain outcome (wallet_market_positions.outcome set)." value={fmtIntEn(rm)} />
      <LedgerSummaryField rowClass={row} label={<>W{'\\'}L{'\\'}F</>} help="Win, loss, and flat counts from resolved positions (ledger w, l, f flags)." value={wlf} />
      <LedgerSummaryField rowClass={row} label="Win Rate %" help="Approximate win rate from ledger: wins divided by total_markets (stored win_rate on API may be the same ratio)." value={<span className={wrPct < 50 ? 'text-red-400' : 'text-green-400'}>{wrPctStr}%</span>} valueClassName="font-bold" />
      <LedgerSummaryField rowClass={row} label="PnL" help="Aggregate PnL from wallet_scores_ledger: sum of realized trading PnL plus resolution PnL across markets." value={fmtUsdSignedLedger(pnl)} valueClassName={`font-bold ${rPnlToneClass(pnl)}`} />
      {!hideNetCash ? (
        <LedgerSummaryField rowClass={row} label="Net Cash" help="Sum of cash_flow (USD leg net) across wallet_market_positions for this wallet." value={fmtUsdSignedLedger(s.cashFlow ?? 0)} valueClassName={`font-bold ${rPnlToneClass(s.cashFlow ?? 0)}`} />
      ) : null}
      <LedgerSummaryField rowClass={row} label="Profit Rate %" help="Share of markets counted as profitable: pm divided by total_markets (shown as percent)." value={<span className="text-gray-200">{prPctStr}%</span>} valueClassName="font-medium" />
      <LedgerSummaryField rowClass={row} label="ROI" help="Portfolio ROI on resolved markets only (USDC-weighted). Shown after outcomes exist; may be empty until then." value={<span className={roiLedgerFmt.tone}>{roiLedgerFmt.text}</span>} valueClassName="font-bold" />
      {showLastUpdated ? (
        <LedgerSummaryField rowClass={row} label="Last updated" help="When this wallet_scores_ledger row was last recomputed from wallet_market_positions." value={<span className="text-gray-400 tabular-nums">{formatWslLastUpdated(s.lastUpdated)}</span>} />
      ) : null}
    </div>
  );
}


export type WalletInfoPanelVariant = 'modal' | 'inline';

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
}: {
  open: boolean;
  wallet: string;
  /** When set (e.g. condition id), trades table opens on this market after load. */
  initialMarketId?: string;
  /** Toxic flow: re-click same wallet → jump to this market (see focusMarketSeq). */
  focusMarketId?: string;
  focusMarketSeq?: number;
  onClose: () => void;
  variant?: WalletInfoPanelVariant;
  /** Inline sidebar: notify parent when markets list expand toggles (width). */
  onInlineMarketsListOpenChange?: (open: boolean) => void;
  overlayZClass?: string;
}) {
  const [marketById, setMarketById] = useState<Record<string, import('../types').Market>>({});
  const [summary, setSummary] = useState<WalletSummary | null | undefined>(undefined);
  const [markets, setMarkets] = useState<WalletPosition[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [walletChartOutcome, setWalletChartOutcome] = useState<'YES' | 'NO'>('YES');
  const [chartOutcomeTokens, setChartOutcomeTokens] = useState<MarketOutcomeTokensResponse | null>(null);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [fillsRefreshToken, setFillsRefreshToken] = useState(0);
  const [dailySnapshotsRefresh, setDailySnapshotsRefresh] = useState(0);
  const [profileNickname, setProfileNickname] = useState('');
  const [inlineMarketsListOpen, setInlineMarketsListOpen] = useState(false);
  const [needsOwnOnchainWs, setNeedsOwnOnchainWs] = useState(() => getOnchainTradesWSShared() == null);
  const tradeElapsedTick = useTradeElapsedTick(open);
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

  useEffect(() => {
    if (!open) return;
    const sync = () => setNeedsOwnOnchainWs(getOnchainTradesWSShared() == null);
    sync();
    const id = window.setInterval(sync, 500);
    return () => window.clearInterval(id);
  }, [open]);

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
    refreshMarketTradesWS();
    setFillsRefreshToken((n) => n + 1);
  }, [focusMarketSeq, focusMarketId, initialMarketId, open, wallet, markets, refreshMarketTradesWS]);

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

  useEffect(() => {
    setWalletChartOutcome('YES');
  }, [selectedMarketId, chartOutcomeTokens?.tokenIdYes, chartOutcomeTokens?.tokenIdNo]);

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

  const selectedMarketPosition = useMemo(() => {
    const raw = selectedMarketId.trim();
    if (!raw) return null;
    const lc = raw.toLowerCase();
    return (
      markets.find((row) => String(row.marketId || '').trim().toLowerCase() === lc) ??
      markets.find((row) => row.marketId === raw) ??
      null
    );
  }, [markets, selectedMarketId]);

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

  const walletAddrClass = useMemo(() => {
    const isSmart = markets.some((row) => isSmartGoldTrader(row));
    return walletAddressColorClass({ summary, isSmart });
  }, [summary, markets]);

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
        {needsOwnOnchainWs ? (
          <OnchainTradesWSBridge wallet={wallet} marketId={selectedMarketId} active={!!wallet.trim() && !!selectedMarketId.trim()} />
        ) : null}
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
                      className={`min-w-0 truncate ${walletTag ? 'text-[10px]' : 'text-xs font-medium'} ${walletAddrClass}`}
                      title={`Polymarket: ${polymarketNick}`}
                    >
                      {shortenWallet(polymarketNick)}
                    </span>
                  ) : walletTag ? null : (
                    <span className={`min-w-0 truncate text-xs font-medium font-mono ${walletAddrClass}`} title={wallet}>
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
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <WalletLatestMarketsTradedTable
                markets={markets}
                marketById={marketById}
                loading={loadingMarkets}
                selectedMarketId={selectedMarketId}
                onRowClick={onMarketRowClick}
                horizontalCellPadding
                stickyHeader
              />
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
                  ledgerFillsForMarkers={fills}
                  chartOutcome={walletChartOutcome}
                  onChartOutcomeChange={setWalletChartOutcome}
                  intervalSelector="dropdown"
                  volumeSpikeAlerts={false}
                />
              </div>
            ) : null}
            <WalletSelectedMarketPositionStrip position={selectedMarketPosition} marketById={marketById} />
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden min-w-0">
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full text-[10px] [&_th]:px-2.5 [&_td]:px-2.5 [&_th]:py-1 [&_td]:py-1">
                <thead>
                  <tr className="text-gray-500">
                    <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-left">Time</th>
                    <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-left">Action</th>
                    <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-left">Side</th>
                    <th
                      className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-center w-6 px-0"
                      title="Taker (wallet_fill_ledger.is_taker)"
                    >
                      T
                    </th>
                    <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-right">Shares</th>
                    <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-right">Price</th>
                    <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-right">USDC</th>
                    <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-right">Fee</th>
                    <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-center w-6 px-0" aria-label="Transaction" />
                  </tr>
                </thead>
                <tbody>
            {loadingFills && fills.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-500">
                  Loading trades...
                </td>
              </tr>
            ) : fills.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-500">
                  No trades for this wallet/market.
                </td>
              </tr>
            ) : (
                  fills.map((f) => {
                    const mid = String(f.marketId || '').trim().toLowerCase();
                    const mk =
                      marketById[selectedMarketId] ||
                      (mid && marketById[mid]) ||
                      {};
                    const bt = Number((f as { blockTime?: number }).blockTime ?? 0);
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
                          <td className="py-0.5">
                            <MemoWalletTradeTimeCell blockTime={bt} nowMs={tradeElapsedTick} />
                          </td>
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
                          <td className="text-center px-0">
                            {f.txHash ? (
                              <a
                                href={`https://polygonscan.com/tx/${f.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex text-gray-400 hover:text-cyan-300"
                                title={`Open tx ${f.txHash} on Polygonscan`}
                                aria-label="Open transaction on Polygonscan"
                              >
                                <ExternalLink size={12} />
                              </a>
                            ) : (
                              '—'
                            )}
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
                          <td className="py-0.5">
                            <MemoWalletTradeTimeCell blockTime={bt} nowMs={tradeElapsedTick} />
                          </td>
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
                          <td className="text-center px-0">
                            {f.txHash ? (
                              <a
                                href={`https://polygonscan.com/tx/${f.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex text-gray-400 hover:text-cyan-300"
                                title={`Open tx ${f.txHash} on Polygonscan`}
                                aria-label="Open transaction on Polygonscan"
                              >
                                <ExternalLink size={12} />
                              </a>
                            ) : (
                              '—'
                            )}
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
                        <td className="py-0.5">
                          <MemoWalletTradeTimeCell blockTime={bt} nowMs={tradeElapsedTick} />
                        </td>
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
                        <td className="text-center px-0">
                          {f.txHash ? (
                            <a
                              href={`https://polygonscan.com/tx/${f.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex text-gray-400 hover:text-cyan-300"
                              title={`Open tx ${f.txHash} on Polygonscan`}
                              aria-label="Open transaction on Polygonscan"
                            >
                              <ExternalLink size={12} />
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })
            )}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-[10px] text-gray-400 shrink-0 pt-1 border-t border-gray-800">
              <span>
                {fmtIntEn(fills.length)} shown · {fmtIntEn(fillsTotal)} total (live WS)
              </span>
            </div>
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
    <div
      className={`fixed inset-0 bg-black/60 ${overlayZClass} flex items-center justify-center`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
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
  focusMarketId?: string;
  focusMarketSeq?: number;
  onClose: () => void;
  variant?: WalletInfoPanelVariant;
  overlayZClass?: string;
}) {
  return <WalletInfoPanelInner {...props} />;
}

const InlineWalletInfoPanelHost = memo(function InlineWalletInfoPanelHost({
  wallet,
  initialMarketId,
  focusMarketId,
  focusMarketSeq,
  onClose,
  onInlineMarketsListOpenChange,
}: {
  wallet: string;
  initialMarketId: string;
  focusMarketId: string;
  focusMarketSeq: number;
  onClose: () => void;
  onInlineMarketsListOpenChange?: (open: boolean) => void;
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
    />
  );
}, (a, b) =>
  a.wallet === b.wallet &&
  a.initialMarketId === b.initialMarketId &&
  a.focusMarketId === b.focusMarketId &&
  a.focusMarketSeq === b.focusMarketSeq &&
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
}: {
  open: boolean;
  wallet: string;
  initialMarketId?: string;
  focusMarketId?: string;
  focusMarketSeq?: number;
  onClose: () => void;
  overlayZClass?: string;
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
    />,
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
  noTokenId,
  marketId,
  open,
  marketExpired = false,
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
    open && !marketNotifyMuted && !marketExpired,
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
            tabBarRef={tabsBarRef}
            rowActionsTipOpen={rowActionsTipOpen}
            onDismissRowActionsTip={onDismissRowActionsTip}
            rowActionsAnchorRef={rowActionsAnchorRef}
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
  noTokenId,
  marketExpired = false,
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

  const tabsBarRef = useRef<HTMLDivElement>(null);
  const [tabsTipOpen, setTabsTipOpen] = useState(false);
  const dismissTabsTip = useCallback(() => {
    persistToxicFlowTabsTipDismissed();
    setTabsTipOpen(false);
  }, []);

  useEffect(() => {
    if (!embedded || !open) {
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

  const primaryTabWalletCount = useMemo(() => {
    if (!tabWalletViews) return 0;
    return toxicFlowWalletsForTab(tabWalletViews, tab).wallets.length;
  }, [tabWalletViews, tab]);

  useEffect(() => {
    if (!embedded || !open) {
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
              noTokenId={noTokenId}
              marketId={midTrim}
              open={open}
              marketExpired={marketExpired}
              tabWalletViews={tabWalletViews}
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

  const inlineWalletPanel = inlineSplit && selectedWallet ? (
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
        />
      </div>
    </div>
  ) : null;

  const rootClass = embedded
    ? 'flex flex-col flex-1 min-h-0 min-w-0 h-full w-full overflow-hidden bg-gray-900'
    : 'fixed inset-0 bg-black/60 z-[60010] flex items-center justify-center';
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
            focusMarketId={midTrim}
            focusMarketSeq={focusMarketSeq}
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
