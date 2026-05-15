import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
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
  Users,
  Crown,
  UsersRound,
  ExternalLink,
  Copy,
  RefreshCw,
  Star,
  Sparkles,
  Trophy,
  CircleHelp,
} from 'lucide-react';
import {
  fetchToxicFlow,
  toxicFlowPayloadEqual,
  fetchWalletSummary,
  fetchWalletPositions,
  fetchOnchainFills,
  fetchMarketStakedLegs,
  mergeMarketStakedLegsResponse,
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
  TOXIC_FAVOURITE_WALLETS_LS_KEY,
  TOXIC_FAVOURITES_CHANGED_EVENT,
} from '../lib/toxicFavouriteWallets';
import { WS_BASE } from '../lib/env';
import { useAppStore } from '../stores/appStore';
import { useMarketLookupSnapshot } from '../hooks/useMarketLookupSnapshot';
import {
  buildMarketByIdRecord,
  sortWalletPositionsByDisplayedDateDesc,
  WalletLatestMarketsTradedTable,
  fmtPriceShare,
} from './WalletLatestMarketsTradedTable';
import { WalletScoresDailyCharts } from './WalletScoresDailyCharts';
import { HelperTooltip } from './HelperTooltip';
import { formatPolymarketVolumeK, formatThousandsAsK } from '../utils/format';
import { StakedLegUsdBar } from './StakedLegUsdBar';
import { ToxicFlowStakePreview, TOXIC_TOTAL_STAKE_BAR_HELP } from './ToxicFlowStakePreview';
import {
  STAKED_NET_EPS,
  walletInvY,
  walletInvN,
  walletNet,
  walletStakeYUsd,
  walletStakeNUsd,
  walletStakeTotalUsd,
  walletStakeNetSignedUsd,
  walletStakeNetAbsUsd,
  toxicCohortStakedNetSurplusHalves,
  stakedNetSortKeyDesc,
  stakedNetSortKeyAsc,
  stakeSortKeyDesc,
  toxicFlowWalletUniverse,
  normalizeWinRate,
  ledgerWinRateFracFromStored,
  ledgerSummaryWinRateFracOrNull,
  toxicRowMatchesSmartLedgerDefinition,
  toxicRowWalletLedgerSummary,
  toxicRowMissingWalletScoresLedgerEmbed,
  toxicRowLedgerLifetimePnlNegative,
  toxicRowSortWinRateFrac,
  toxicFlowStakeStripWalletLists,
  toxicRowResolvedStatsLow,
} from '../lib/toxicFlowStakeCohort';

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
}

type Tab =
  | 'topHolders'
  | 'smart'
  | 'favourites'
  | 'winners'
  | 'fresh'
  | 'topYes'
  | 'topNo'
  | 'topVolume';

const TOXIC_FLOW_TAB_DESCRIPTIONS: Record<Tab, string> = {
  topHolders: 'Wallets with biggest positions on this market.',
  smart: 'Wallets that win most of the time.',
  favourites: 'Wallets you marked as favorites betting here.',
  winners: 'Wallets with profits in tracked time. Green = more YES staked than NO.',
  fresh: 'Wallets with no ledger row or fewer than 10 resolved markets — not enough history to grade.',
  topYes: 'Wallets betting strongest on YES.',
  topNo: 'Wallets betting strongest on NO.',
  topVolume: 'Wallets with most money traded here.',
};

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

function walletRowClassForStakedNet(shadeRows: boolean, stakeNetSigned: number): string {
  const border = 'border-b border-gray-800';
  if (!shadeRows) return `${border} hover:bg-gray-700/30`;
  if (!Number.isFinite(stakeNetSigned) || Math.abs(stakeNetSigned) <= STAKED_NET_EPS) {
    return `${border} hover:bg-gray-700/30`;
  }
  if (stakeNetSigned < -STAKED_NET_EPS) {
    return `${border} bg-green-900/25 hover:bg-green-900/40`;
  }
  return `${border} bg-red-900/25 hover:bg-red-900/40`;
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

/** `wallet_scores_ledger` fields from /api/wallet-summary. */
function WalletScoresLedgerSummaryGrid({
  s,
  dense,
  narrowSummary,
  hideNetCash,
  hideTotalMarkets,
}: {
  s: WalletSummary;
  dense?: boolean;
  narrowSummary?: boolean;
  /** e.g. wallet info dialog — omit ledger cash_flow aggregate row. */
  hideNetCash?: boolean;
  /** e.g. wallet info dialog Summary column — omit total markets row. */
  hideTotalMarkets?: boolean;
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
      className={`grid grid-cols-1 gap-y-0.5 ${dense ? 'max-w-[min(100vw-24px,320px)]' : narrowSummary ? 'max-w-[15rem]' : ''}`}
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

/** Green segment = win rate, red = loss rate (0–1). Use as cell bottom edge or stacked under wallet. */
function WinRateBottomBar({ winRate, className }: { winRate: number; className?: string }) {
  const w = normalizeWinRate(winRate) ?? 0;
  const pctWin = w * 100;
  const pctLoss = (1 - w) * 100;
  return (
    <div
      className={`flex h-0.5 w-full min-w-[40px] overflow-hidden rounded-[1px] ${className ?? ''}`}
      title={`Win ${pctWin.toFixed(0)}% · loss ${pctLoss.toFixed(0)}%`}
    >
      <div className="h-full shrink-0 bg-emerald-500" style={{ width: `${pctWin}%` }} />
      <div className="h-full shrink-0 bg-red-600" style={{ width: `${pctLoss}%` }} />
    </div>
  );
}

/** Gray fill toward 10 resolved markets (`wallet_scores_ledger.resolved_markets`). */
function ResolvedMarketsToward10Bar({ resolvedMarkets, className }: { resolvedMarkets: number; className?: string }) {
  const rm = Math.max(0, resolvedMarkets);
  const pct = Math.min(100, (rm / 10) * 100);
  return (
    <div
      className={`flex h-0.5 w-full min-w-[40px] overflow-hidden rounded-[1px] bg-gray-700/90 ${className ?? ''}`}
      title={`Fresh · ${rm} / 10 resolved markets (ledger)`}
    >
      <div className="h-full shrink-0 bg-gray-400/95" style={{ width: `${pct}%` }} />
    </div>
  );
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
    const parts: string[] = [];
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
          <div className={`font-mono mb-1 text-[8px] ${addrClass}`}>{wallet.slice(0, 10)}...{wallet.slice(-6)}</div>
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
      className="relative inline-block"
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
        className={`${addrClass} hover:underline font-mono inline-flex items-baseline flex-wrap gap-x-0`}
        title={btnTitle}
      >
        <span>{shortenWallet(wallet)}</span>
      </button>
      {portalTooltip}
    </span>
  );
});

function WalletTableBodyRow({
  rank,
  w,
  shadeRowByStakedNet,
  favouriteActive,
  toggleFavouriteWallet,
  onOpenWallet,
  sharesPct,
  cumSharesPct,
}: {
  rank: number;
  w: WalletPosition;
  shadeRowByStakedNet: boolean;
  favouriteActive: boolean;
  toggleFavouriteWallet: (addr: string) => void;
  onOpenWallet?: (wallet: string, netShares?: number) => void;
  sharesPct: number;
  cumSharesPct: number;
}) {
  const hoverRef = useRef<WalletLinkHoverHandle>(null);
  const sum = toxicRowWalletLedgerSummary(w);
  const ledgerFrac = ledgerSummaryWinRateFracOrNull(sum === undefined ? null : sum);
  const emb = w.walletLedgerSummary;
  const resolvedStatsLow = toxicRowResolvedStatsLow(emb);
  const resolvedRmForBar = emb === undefined ? 0 : emb === null ? 0 : emb.resolvedMarkets ?? 0;
  const showWinBar = !resolvedStatsLow && ledgerFrac != null;
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
  const biasColor = bias > 0.5 ? 'text-yellow-400' : bias > 0.3 ? 'text-orange-400' : 'text-gray-400';
  const nYColor = iy > 0.001 ? 'text-green-400' : iy < -0.001 ? 'text-red-400' : 'text-gray-500';
  const stakeYUsd = walletStakeYUsd(w);
  const stakeNUsd = walletStakeNUsd(w);
  const stakeNetSigned = walletStakeNetSignedUsd(w);

  const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');
  const fmtUsdSigned = (v: number) => {
    if (!Number.isFinite(v)) return '–';
    const rounded = Math.round(Math.abs(v));
    const s = v >= 0 ? '+' : '−';
    return `${s}$${rounded.toLocaleString('en-US')}`;
  };

  return (
    <tr
      className={walletRowClassForStakedNet(shadeRowByStakedNet, stakeNetSigned)}
      onMouseEnter={(e) => hoverRef.current?.rowEnter(e)}
      onMouseMove={(e) => hoverRef.current?.rowMove(e)}
      onMouseLeave={() => hoverRef.current?.rowLeave()}
    >
      <td className="py-0.5 px-1 text-gray-600">{rank}</td>
      <td className="align-top px-0 py-0.5">
        <button
          type="button"
          className="p-0.5 rounded hover:bg-gray-600/40 text-gray-500 hover:text-gray-300"
          title={favouriteActive ? 'Remove favourite' : 'Add favourite'}
          aria-pressed={favouriteActive}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFavouriteWallet(w.wallet);
          }}
        >
          <Star
            size={12}
            className={favouriteActive ? 'text-yellow-400 fill-yellow-400' : 'fill-none stroke-gray-400'}
          />
        </button>
      </td>
      <td className="relative align-top px-1 py-0.5 pb-2">
        <WalletLink
          ref={hoverRef}
          wallet={w.wallet}
          netShares={signedLegNet}
          onOpenWallet={onOpenWallet}
          isSmart={isSmartGold(w)}
          ledgerEmbed={w.walletLedgerSummary}
          ledgerGold={ledgerGoldFromEmbed(w.walletLedgerSummary)}
        />
        {resolvedStatsLow ? (
          <ResolvedMarketsToward10Bar resolvedMarkets={resolvedRmForBar} className="absolute bottom-0 left-0 right-0" />
        ) : showWinBar ? (
          <WinRateBottomBar winRate={ledgerFrac!} className="absolute bottom-0 left-0 right-0" />
        ) : (
          <div
            className="pointer-events-none absolute bottom-0 left-0 right-0 h-0.5 min-w-[40px] overflow-hidden rounded-[1px] bg-gray-700/90"
            aria-hidden
            title="No ledger win rate (wallet_scores_ledger)"
          />
        )}
      </td>
      <td className={`text-right px-1 font-bold ${nYColor} bg-green-900/10`}>{fmtInt(iy)}</td>
      <td className="text-right px-1 font-bold text-red-400 bg-red-900/10">{fmtInt(inn)}</td>
      <td className="text-right px-1 whitespace-nowrap tabular-nums" title="inv_yes − inv_no (|net| Y / N)">
        {inventoryNetSharesTableCell(signedLegNet)}
      </td>
      <td className="text-right px-1 text-gray-300">{fmtPriceShare(w.priceYes)}</td>
      <td className="text-right px-1 text-gray-300">{fmtPriceShare(w.priceNo)}</td>
      <td className="text-right px-1 text-gray-400">
        {typeof w.tradeCount === 'number' && Number.isFinite(w.tradeCount)
          ? Math.round(w.tradeCount).toLocaleString('en-US')
          : '–'}
      </td>
      <td className="text-right px-1 font-medium tabular-nums text-red-400">
        {Number.isFinite(stakeYUsd) ? fmtUsdSigned(-stakeYUsd) : '–'}
      </td>
      <td className="text-right px-1 font-medium tabular-nums text-red-400">
        {Number.isFinite(stakeNUsd) ? fmtUsdSigned(-stakeNUsd) : '–'}
      </td>
      <td className="text-right px-1 whitespace-nowrap" title="Staked Y − Staked N (column display); Y / N suffix">
        {stakedNetUsdTableCell(stakeNetSigned)}
      </td>
      <td className="text-right px-1 text-cyan-300">
        {sharesPct > 0
          ? `${sharesPct.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
          : '-'}
      </td>
      <td className="text-right px-1 text-cyan-200/70">
        {cumSharesPct > 0
          ? `${cumSharesPct.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
          : '-'}
      </td>
      <td className={`text-right px-1 ${biasColor}`}>
        {`${(bias * 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}%`}
      </td>
    </tr>
  );
}

function WalletTable({
  wallets,
  label,
  totalShares,
  onOpenWallet,
  shadeRowByStakedNet = true,
}: {
  wallets: WalletPosition[] | null;
  label: string;
  totalShares?: number;
  onOpenWallet?: (wallet: string, netShares?: number) => void;
  /** Row background from Staked Net sign (green YES / red NO); default on for all Toxic tables. */
  shadeRowByStakedNet?: boolean;
}) {
  const rows = wallets || [];
  const [favouriteWallets, setFavouriteWallets] = useState(readToxicFavouriteWallets);
  useEffect(() => {
    const onChanged = () => setFavouriteWallets(readToxicFavouriteWallets());
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY || e.key === null) onChanged();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, onChanged);
    };
  }, []);
  const toggleFavouriteWallet = useCallback((addr: string) => {
    const k = addr.trim().toLowerCase();
    if (!k) return;
    setFavouriteWallets((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      persistToxicFavouriteWallets(next);
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
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto w-full min-w-0 overscroll-contain">
      <table className="w-full whitespace-nowrap text-[10px]">
        <thead className="sticky top-0 z-[1] bg-gray-950">
          <tr className="text-gray-500 border-b border-gray-700">
            <th className="text-left py-1 px-1">#</th>
            <th className="text-left px-1 w-5" aria-label="Favourite" />
            <th className="text-left px-1">Wallet</th>
            <th className="text-right px-1 bg-green-900/15" title="inv_yes">
              Inv Y
            </th>
            <th className="text-right px-1 bg-red-900/15 text-red-300" title="inv_no">
              Inv N
            </th>
            <th className="text-right px-1" title="inv_yes − inv_no (shares); magnitude + Y / N, no leading minus">
              Net
            </th>
            <th className="text-right px-1 text-gray-400" title="price_yes">
              Px Y
            </th>
            <th className="text-right px-1 text-gray-400" title="price_no">
              Px N
            </th>
            <th className="text-right px-1">Trades</th>
            <th className="text-right px-1 bg-green-900/10" title="−(inv_yes × price_yes) shown red (cost notionally)">
              Staked Y
            </th>
            <th className="text-right px-1 bg-red-900/10 text-red-300" title="−(inv_no × price_no) shown red (cost notionally)">
              Staked N
            </th>
            <th className="text-right px-1 text-gray-300" title="(−inv_y×px_y) − (−inv_n×px_n) = Staked Y − Staked N as shown; suffix Y / N; green = favors YES / red = favors NO">
              Staked Net
            </th>
            <th className="text-right px-1">%</th>
            <th className="text-right px-1">Cum%</th>
            <th className="text-right px-1">Bias</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            let cumSharesPct = 0;
            return rows.map((w, i) => {
              const wk = (w.wallet || '').toLowerCase();
              const iy = typeof w.invYes === 'number' && Number.isFinite(w.invYes) ? w.invYes : w.netYes ?? 0;
              const inn = typeof w.invNo === 'number' && Number.isFinite(w.invNo) ? w.invNo : w.netNo ?? 0;
              const signedLegNet = iy - inn;
              const sharesPct =
                totalShares && totalShares > 0 ? (Math.abs(signedLegNet) / totalShares) * 100 : 0;
              cumSharesPct += sharesPct;
              return (
                <WalletTableBodyRow
                  key={w.wallet}
                  rank={i + 1}
                  w={w}
                  shadeRowByStakedNet={!!shadeRowByStakedNet}
                  favouriteActive={favouriteWallets.has(wk)}
                  toggleFavouriteWallet={toggleFavouriteWallet}
                  onOpenWallet={onOpenWallet}
                  sharesPct={sharesPct}
                  cumSharesPct={cumSharesPct}
                />
              );
            });
          })()}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export function WalletInfoDialog({
  open,
  wallet,
  initialMarketId,
  onClose,
}: {
  open: boolean;
  wallet: string;
  /** When set (e.g. condition id), trades table opens on this market after load. */
  initialMarketId?: string;
  onClose: () => void;
}) {
  const marketLookup = useMarketLookupSnapshot();
  const [summary, setSummary] = useState<WalletSummary | null | undefined>(undefined);
  const [markets, setMarkets] = useState<WalletPosition[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [fills, setFills] = useState<OnchainFillRow[]>([]);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [loadingFills, setLoadingFills] = useState(false);
  const [fillsTotal, setFillsTotal] = useState(0);
  const [fillsPage, setFillsPage] = useState(0);
  const [fillsRefreshToken, setFillsRefreshToken] = useState(0);
  const [dailySnapshotsRefresh, setDailySnapshotsRefresh] = useState(0);
  const fillsPageSize = 200;
  const marketById = useMemo(() => buildMarketByIdRecord(marketLookup), [marketLookup]);

  const loadMarketsAndSelect = useCallback(
    async (preserveSelected: string | null, resetFillsPage: boolean) => {
      if (!wallet) return '';
      const prefRaw = (initialMarketId || '').trim();
      const pref = prefRaw.toLowerCase();
      const [s, p] = await Promise.all([
        fetchWalletSummary(wallet),
        fetchWalletPositions({ wallet, limit: 1000, ledger: true, order: 'end_date_desc' }),
      ]);
      setSummary(s);
      const byId = buildMarketByIdRecord(useAppStore.getState().marketLookup);
      const sorted = sortWalletPositionsByDisplayedDateDesc(p.positions || [], byId);
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
      if (resetFillsPage) setFillsPage(0);
      return pick;
    },
    [wallet, initialMarketId],
  );

  useEffect(() => {
    if (!open || !wallet) return;
    setSummary(undefined);
    setMarkets([]);
    setSelectedMarketId('');
    setFills([]);
    setFillsTotal(0);
    setFillsPage(0);
    setFillsRefreshToken(0);
    setDailySnapshotsRefresh(0);
    setLoadingMarkets(true);
    (async () => {
      try {
        await loadMarketsAndSelect(null, false);
      } finally {
        setLoadingMarkets(false);
      }
    })();
  }, [open, wallet, initialMarketId, loadMarketsAndSelect]);

  const onRefreshMarketsAndTrades = useCallback(async () => {
    if (!open || !wallet) return;
    setLoadingMarkets(true);
    try {
      await loadMarketsAndSelect(selectedMarketId, true);
      setFillsRefreshToken((n) => n + 1);
      setDailySnapshotsRefresh((n) => n + 1);
    } finally {
      setLoadingMarkets(false);
    }
  }, [open, wallet, selectedMarketId, loadMarketsAndSelect]);

  useEffect(() => {
    if (!open || !wallet || !selectedMarketId) return;
    setLoadingFills(true);
    setFills([]);
    (async () => {
      try {
        const res = await fetchOnchainFills({ wallet, market_id: selectedMarketId, limit: fillsPageSize, offset: fillsPage * fillsPageSize });
        setFills(res.fills || []);
        setFillsTotal(res.total || 0);
      } finally {
        setLoadingFills(false);
      }
    })();
  }, [open, wallet, selectedMarketId, fillsPage, fillsRefreshToken]);

  const summaryLeftRef = useRef<HTMLDivElement>(null);
  const [summaryLeftH, setSummaryLeftH] = useState(0);
  const [lgChartsSync, setLgChartsSync] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  const [walletIsFavourite, setWalletIsFavourite] = useState(false);

  useEffect(() => {
    if (!open || !wallet.trim()) {
      setWalletIsFavourite(false);
      return;
    }
    const k = wallet.trim().toLowerCase();
    setWalletIsFavourite(readToxicFavouriteWallets().has(k));
  }, [open, wallet]);

  useEffect(() => {
    if (!open || !wallet.trim()) return;
    const k = wallet.trim().toLowerCase();
    const sync = () => setWalletIsFavourite(readToxicFavouriteWallets().has(k));
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY || e.key === null) sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, sync);
    };
  }, [open, wallet]);

  const toggleWalletFavourite = useCallback(() => {
    const k = wallet.trim().toLowerCase();
    if (!k) return;
    const next = readToxicFavouriteWallets();
    if (next.has(k)) next.delete(k);
    else next.add(k);
    persistToxicFavouriteWallets(next);
    setWalletIsFavourite(next.has(k));
  }, [wallet]);

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

  if (!open) return null;
  const polymarketProfileUrl = `https://polymarket.com/profile/${wallet.trim().toLowerCase()}`;
  const dialog = (
    <div className="fixed inset-0 bg-black/60 z-[60010] flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="bg-gray-800 rounded-lg p-3 w-full mx-4 shadow-xl border border-gray-700 max-w-[min(98vw,93.6rem)] max-h-[88vh] min-h-[50vh] flex flex-col overflow-hidden"
      >
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
            <a
              href={polymarketProfileUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-400 font-mono truncate hover:underline"
              title="Open Polymarket profile"
            >
              {wallet}
            </a>
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
            <a href={polymarketProfileUrl} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-white" title="Open Polymarket profile">
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
            <div className="mt-1 flex flex-col lg:flex-row gap-3 items-stretch min-w-0 min-h-0">
              <div
                ref={summaryLeftRef}
                className="shrink-0 w-full lg:w-[min(11rem,calc(100%/6))] lg:max-w-[11rem] flex flex-col"
              >
                {summary === undefined && <div className="text-gray-500">Loading...</div>}
                {summary === null && <div className="text-gray-500">No wallet_scores_ledger row</div>}
                {summary && (
                  <WalletScoresLedgerSummaryGrid s={summary} narrowSummary hideNetCash hideTotalMarkets />
                )}
              </div>
              {wallet.trim() ? (
                <div
                  className="min-w-0 flex-1 flex flex-col min-h-0 overflow-hidden lg:border-l lg:border-gray-800 lg:pl-3"
                  style={
                    lgChartsSync && summaryLeftH > 0
                      ? { height: summaryLeftH, maxHeight: summaryLeftH }
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
          className="grid gap-2 flex-1 min-h-0 overflow-hidden"
          style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(16rem, 36rem)' }}
        >
          <div className="bg-gray-900 rounded p-2 min-h-0 min-w-0 flex flex-col overflow-hidden">
            <div className="text-[10px] text-gray-400 font-bold mb-1 shrink-0">Latest Markets Traded</div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
              <WalletLatestMarketsTradedTable
                markets={markets}
                marketById={marketById}
                loading={loadingMarkets}
                selectedMarketId={selectedMarketId}
                onRowClick={(id) => {
                  setSelectedMarketId(id);
                  setFillsPage(0);
                }}
              />
            </div>
          </div>

          <div className="bg-gray-900 rounded p-2 min-h-0 min-w-0 flex flex-col overflow-hidden">
            <div className="text-[10px] text-gray-400 font-bold mb-1 shrink-0">
              Trades For Selected Market {selectedMarketId ? <span className="text-gray-500 font-mono">({selectedMarketId})</span> : null}
            </div>
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
                    const ts = bt > 0
                      ? (bt > 1e12 ? new Date(bt) : new Date(bt * 1000)).toLocaleString()
                      : '-';
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
                              : 'text-gray-300';
                      return (
                        <tr key={`${f.txHash}-${f.logIndex}-${String(f.tokenId || '')}`} className="border-b border-gray-800">
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
                        <tr key={`${f.txHash}-${f.logIndex}`} className="border-b border-gray-800">
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
                      <tr key={`${f.txHash}-${f.logIndex}`} className="border-b border-gray-800">
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
            <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400 shrink-0 pt-1 border-t border-gray-800">
              <span>
                Page {fmtIntEn(fillsPage + 1)} / {fmtIntEn(Math.max(1, Math.ceil(fillsTotal / fillsPageSize)))} (
                {fmtIntEn(fillsTotal)} trades)
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="px-2 py-0.5 rounded bg-gray-700 disabled:opacity-40"
                  disabled={fillsPage <= 0 || loadingFills}
                  onClick={() => setFillsPage((p) => Math.max(0, p - 1))}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="px-2 py-0.5 rounded bg-gray-700 disabled:opacity-40"
                  disabled={loadingFills || ((fillsPage + 1) * fillsPageSize >= fillsTotal)}
                  onClick={() => setFillsPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>

      </div>
    </div>
  );
  if (typeof document === 'undefined') return null;
  return createPortal(dialog, document.body);
}

export function ToxicFlowDialog({
  open,
  marketId,
  marketName,
  yesTokenId,
  onClose,
  embedded = false,
  streamData = undefined,
}: ToxicFlowDialogProps) {
  const marketLookup = useMarketLookupSnapshot();
  const [marketStakedLegsRest, setMarketStakedLegsRest] = useState<MarketStakedLegsResponse | null>(null);

  const liveStakedLegUsd = useMemo(() => {
    const tokenId = (yesTokenId || '').trim();
    if (!tokenId) return null;
    const wy = marketLookup[tokenId]?.stakedUsdYesLeg;
    const wn = marketLookup[tokenId]?.stakedUsdNoLeg;
    const sumAbs = marketLookup[tokenId]?.stakedSumAbsSignedNetUsd;
    if (typeof wy === 'number' && Number.isFinite(wy) && typeof wn === 'number' && Number.isFinite(wn)) {
      const row: MarketStakedLegsResponse = { stakedUsdYesLeg: wy, stakedUsdNoLeg: wn };
      if (typeof sumAbs === 'number' && Number.isFinite(sumAbs)) {
        row.stakedSumAbsSignedNetUsd = sumAbs;
      }
      return row;
    }
    return null;
  }, [yesTokenId, marketLookup]);

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
  const dialogStakedNetAbsUsd = useMemo(() => {
    if (!dialogMarketStakedLegs) return null;
    let n =
      typeof dialogMarketStakedLegs.stakedSumAbsSignedNetUsd === 'number' &&
      Number.isFinite(dialogMarketStakedLegs.stakedSumAbsSignedNetUsd)
        ? dialogMarketStakedLegs.stakedSumAbsSignedNetUsd
        : Math.abs(dialogMarketStakedLegs.stakedUsdYesLeg - dialogMarketStakedLegs.stakedUsdNoLeg);
    return Number.isFinite(n) ? n : null;
  }, [dialogMarketStakedLegs]);

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
  const [tab, setTab] = useState<Tab>('topHolders');
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState('');
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

  const load = useCallback(async () => {
    if (!marketId) return;
    setInternalLoading(true);
    setInternalError('');
    try {
      const d = await fetchToxicFlow(marketId);
      internalDataRef.current = d;
      setInternalData(d);
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
          const msg = JSON.parse(String(ev.data)) as { type?: string; data?: ToxicFlowData };
          if (msg.type === 'toxicFlow' && msg.data && typeof msg.data === 'object') {
            const next = msg.data;
            const prev = internalDataRef.current;
            if (prev && toxicFlowPayloadEqual(prev, next)) return;
            internalDataRef.current = next;
            setInternalData(next);
          }
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

  const topYesWallets = useMemo(() => {
    const arr = toxicFlowWalletUniverse(data).filter((w) => {
      const stake = walletStakeNetSignedUsd(w);
      return Number.isFinite(stake) && stake < -STAKED_NET_EPS;
    });
    return [...arr].sort((a, b) => {
      const d = stakedNetSortKeyDesc(b) - stakedNetSortKeyDesc(a);
      if (d !== 0) return d;
      const dn = walletNet(b) - walletNet(a);
      if (dn !== 0) return dn;
      return (a.wallet || '').localeCompare(b.wallet || '');
    });
  }, [data]);
  const topNoWallets = useMemo(() => {
    const arr = toxicFlowWalletUniverse(data).filter((w) => {
      const stake = walletStakeNetSignedUsd(w);
      return Number.isFinite(stake) && stake > STAKED_NET_EPS;
    });
    return [...arr].sort((a, b) => {
      const d = stakedNetSortKeyAsc(b) - stakedNetSortKeyAsc(a);
      if (d !== 0) return d;
      const dn = walletNet(a) - walletNet(b);
      if (dn !== 0) return dn;
      return (a.wallet || '').localeCompare(b.wallet || '');
    });
  }, [data]);

  const topHoldersWallets = useMemo(() => {
    const arr = data?.topHolders ?? [];
    return [...arr].sort((a, b) => {
      const d = stakeSortKeyDesc(b, 'net') - stakeSortKeyDesc(a, 'net');
      if (d !== 0) return d;
      const da = Math.abs(walletNet(a));
      const db = Math.abs(walletNet(b));
      if (db !== da) return db - da;
      return (a.wallet || '').localeCompare(b.wallet || '');
    });
  }, [data?.topHolders]);

  const smartTabWallets = useMemo(() => {
    const arr = toxicFlowWalletUniverse(data).filter((w) => toxicRowMatchesSmartLedgerDefinition(w));
    return [...arr].sort((a, b) => {
      const d = stakeSortKeyDesc(b, 'net') - stakeSortKeyDesc(a, 'net');
      if (d !== 0) return d;
      const da = Math.abs(walletNet(a));
      const db = Math.abs(walletNet(b));
      if (db !== da) return db - da;
      return (a.wallet || '').localeCompare(b.wallet || '');
    });
  }, [data]);

  const favouritesTabWallets = useMemo(() => {
    const arr = toxicFlowWalletUniverse(data).filter((w) =>
      toxicFollowSet.has((w.wallet || '').trim().toLowerCase()),
    );
    return [...arr].sort((a, b) => {
      const d = stakeSortKeyDesc(b, 'net') - stakeSortKeyDesc(a, 'net');
      if (d !== 0) return d;
      const da = Math.abs(walletNet(a));
      const db = Math.abs(walletNet(b));
      if (db !== da) return db - da;
      return (a.wallet || '').localeCompare(b.wallet || '');
    });
  }, [data, toxicFollowSet]);

  const winnersTabWallets = useMemo(() => {
    const arr = toxicFlowWalletUniverse(data).filter(
      (w) => !toxicRowMissingWalletScoresLedgerEmbed(w) && !toxicRowLedgerLifetimePnlNegative(w),
    );
    return [...arr].sort((a, b) => {
      const d = stakeSortKeyDesc(b, 'net') - stakeSortKeyDesc(a, 'net');
      if (d !== 0) return d;
      const fa = toxicRowSortWinRateFrac(a);
      const fb = toxicRowSortWinRateFrac(b);
      if (fa != null && fb != null && fb !== fa) return fb - fa;
      if (fa != null && fb == null) return -1;
      if (fa == null && fb != null) return 1;
      const da = Math.abs(walletNet(a));
      const db = Math.abs(walletNet(b));
      if (db !== da) return db - da;
      return (a.wallet || '').localeCompare(b.wallet || '');
    });
  }, [data]);

  const stripWalletLists = useMemo(
    () => (data ? toxicFlowStakeStripWalletLists(data, toxicFollowSet) : null),
    [data, toxicFollowSet],
  );

  if (!open) return null;

  const openWalletDialog = (wallet: string, _netShares?: number) => {
    setSelectedWallet(wallet);
    setWalletDialogOpen(true);
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'topHolders', label: 'Top Holders', icon: <Crown size={11} /> },
    { key: 'smart', label: 'Smart', icon: <Sparkles size={11} /> },
    { key: 'favourites', label: 'Favourites', icon: <Star size={11} /> },
    { key: 'winners', label: 'Greens', icon: <Trophy size={11} /> },
    { key: 'fresh', label: 'Fresh', icon: <CircleHelp size={11} /> },
    { key: 'topYes', label: 'Top YES', icon: <TrendingUp size={11} /> },
    { key: 'topNo', label: 'Top NO', icon: <TrendingDown size={11} /> },
    { key: 'topVolume', label: 'Top Volume', icon: <Users size={11} /> },
  ];

  const rootClass = embedded
    ? 'flex flex-col flex-1 min-h-0 min-w-0 h-full w-full overflow-hidden bg-gray-900'
    : 'fixed inset-0 bg-black/60 z-[49999] flex items-center justify-center';
  const cardClass = embedded
    ? 'bg-gray-800 flex flex-col flex-1 min-h-0 min-w-0 p-3 border-0 border-gray-700/50 w-full rounded-none shadow-none'
    : 'bg-gray-800 rounded-lg p-4 max-w-4xl w-full mx-4 shadow-xl border border-gray-700 flex flex-col min-h-0';
  const cardStyle: React.CSSProperties = embedded
    ? { maxHeight: '100%', minHeight: 0 }
    : { maxHeight: '85vh', height: '85vh', minHeight: 0 };

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
        {/* Header */}
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <UsersRound size={16} className="text-yellow-400 shrink-0" />
            <span className="text-sm font-bold text-yellow-400 shrink-0">Holders</span>
            <span className="text-xs text-gray-400 truncate">{marketName}</span>
          </div>
          <div className="flex items-center shrink-0">
            <button type="button" onClick={onClose} className="text-gray-500 hover:text-white p-0.5" aria-label={embedded ? 'Close panel' : 'Close'}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body: flex so cohort tables consume remaining height; table body scrolls */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {loading && <div className="text-gray-500 text-center py-8 shrink-0">Loading on-chain data...</div>}
          {error && <div className="text-red-400 text-center py-8 shrink-0">Error: {error}</div>}

          {!loading && !error && data && (
            <>
              <div className="shrink-0 flex flex-col gap-3 overflow-x-hidden overflow-y-auto min-h-0 max-h-[min(520px,46vh)] pr-0.5">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <div className="bg-gray-900 rounded p-2 text-center">
                  <div className="text-[10px] text-gray-500">Wallets</div>
                  <div className="text-sm font-bold text-white tabular-nums" title={String(data.totalWallets)}>
                    {formatThousandsAsK(data.totalWallets)}
                  </div>
                </div>
                <div className="bg-gray-900 rounded p-2 text-center">
                  <div className="text-[10px] text-gray-500">On-chain Fills</div>
                  <div className="text-sm font-bold text-white tabular-nums" title={String(data.totalTrades)}>
                    {formatThousandsAsK(data.totalTrades)}
                  </div>
                </div>
                <div className="bg-gray-900 rounded p-2 text-center">
                  <div className="text-[10px] text-gray-500">USDC Volume</div>
                  <div
                    className="text-sm font-bold text-yellow-400 tabular-nums truncate"
                    title={`$${data.totalUsdcIn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  >
                    ${formatPolymarketVolumeK(data.totalUsdcIn)}
                  </div>
                </div>
                <div
                  className="bg-gray-900 rounded p-2 text-center"
                  title="Σ_w |inv_y×px_y − inv_n×px_n| over all wallets (same basis as per-wallet Staked Net). Old ‖Σ|YES USD| − Σ|NO USD|‖ shown only if sum field missing."
                >
                  <div className="text-[10px] text-gray-500">Staked</div>
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
                <div className="bg-gray-900 rounded p-2 text-center">
                  <div className="text-[10px] text-gray-500">Concentration</div>
                  <div className={`text-sm font-bold ${data.concentration > 0.5 ? 'text-red-400' : data.concentration > 0.3 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {(data.concentration * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="bg-gray-900 rounded p-2 text-center">
                  <div className="text-[10px] text-gray-500">Total Shares</div>
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
              </div>

              <div className="flex flex-col flex-1 min-h-0 overflow-hidden mt-2 bg-gray-900/60 rounded p-2 gap-2">
                <div className="shrink-0 flex flex-col gap-y-2 pb-2 border-b border-gray-700/60">
                  <ToxicFlowStakePreview
                    layout="stacked"
                    label="Total"
                    marketGrossLegsUsd={dialogMarketStakedLegs}
                    wallets={[]}
                    helpText={TOXIC_TOTAL_STAKE_BAR_HELP}
                  />
                  <div className="flex flex-wrap gap-x-2 gap-y-1.5">
                  <div className="min-w-[100px] max-w-[200px] flex-[1_1_120px] min-h-0">
                    <ToxicFlowStakePreview label="Holders" wallets={topHoldersWallets} />
                  </div>
                  <div className="min-w-[100px] max-w-[200px] flex-[1_1_120px] min-h-0">
                    <ToxicFlowStakePreview label="Smart" wallets={smartTabWallets} />
                  </div>
                  <div className="min-w-[100px] max-w-[200px] flex-[1_1_120px] min-h-0">
                    <ToxicFlowStakePreview label="Top20" wallets={stripWalletLists?.top20 ?? []} />
                  </div>
                  <div className="min-w-[100px] max-w-[200px] flex-[1_1_120px] min-h-0">
                    <ToxicFlowStakePreview label="Fav" wallets={favouritesTabWallets} />
                  </div>
                  <div className="min-w-[100px] max-w-[200px] flex-[1_1_120px] min-h-0">
                    <ToxicFlowStakePreview label="Greens" wallets={winnersTabWallets} />
                  </div>
                  <div className="min-w-[100px] max-w-[200px] flex-[1_1_120px] min-h-0">
                    <ToxicFlowStakePreview label="Fresh" wallets={stripWalletLists?.fresh ?? []} />
                  </div>
                  </div>
                </div>
                <div className="flex gap-1 border-b border-gray-700 pb-2 shrink-0 flex-wrap">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                        tab === t.key
                          ? 'bg-yellow-400/20 text-yellow-400'
                          : 'text-gray-400 hover:text-white hover:bg-gray-700'
                      }`}
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-500 leading-snug shrink-0 px-0.5 border-b border-gray-700/80 pb-2">
                  {TOXIC_FLOW_TAB_DESCRIPTIONS[tab]}
                </p>

                <div className="flex flex-col flex-1 min-h-0 overflow-hidden min-w-0">
                  {tab === 'topHolders' && (
                    <WalletTable wallets={topHoldersWallets} label="holders" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                  )}
                  {tab === 'smart' && (
                    <WalletTable wallets={smartTabWallets} label="smart" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                  )}
                  {tab === 'favourites' && (
                    <WalletTable wallets={favouritesTabWallets} label="favourites" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                  )}
                  {tab === 'winners' && (
                    <WalletTable wallets={winnersTabWallets} label="greens" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                  )}
                  {tab === 'fresh' && (
                    <WalletTable wallets={stripWalletLists?.fresh ?? []} label="fresh" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                  )}
                  {tab === 'topYes' && (
                    <WalletTable wallets={topYesWallets} label="Net Y (Staked)" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                  )}
                  {tab === 'topNo' && (
                    <WalletTable wallets={topNoWallets} label="Net N (Staked)" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                  )}
                  {tab === 'topVolume' && (
                    <WalletTable wallets={data.topVolume} label="volume" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <WalletInfoDialog
          open={walletDialogOpen}
          wallet={selectedWallet}
          initialMarketId={marketId}
          onClose={() => setWalletDialogOpen(false)}
        />
      </div>
    </div>
  );
}
