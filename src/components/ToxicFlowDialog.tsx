import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, TrendingUp, TrendingDown, Users, BarChart3, AlertTriangle, Crown, ShieldAlert, UsersRound, ExternalLink, Copy, RefreshCw, Star } from 'lucide-react';
import {
  fetchToxicFlow,
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
import { StakedLegUsdBar } from './StakedLegUsdBar';
import { formatPolymarketVolumeK, formatThousandsAsK } from '../utils/format';

interface ToxicFlowDialogProps {
  open: boolean;
  marketId: string;
  marketName: string;
  yesTokenId?: string;
  onClose: () => void;
  /** In-sidebar panel: no modal backdrop; fills parent flex column. */
  embedded?: boolean;
}

type Tab = 'topHolders' | 'topYes' | 'topNo' | 'topVolume' | 'topTraders';

const TOXIC_TAB_COHORT_LABEL: Record<Tab, string> = {
  topHolders: 'Top Holders',
  topYes: 'Top YES',
  topNo: 'Top NO',
  topVolume: 'Top Volume',
  topTraders: 'Top Traders',
};

function walletInvY(w: WalletPosition): number {
  return typeof w.invYes === 'number' && Number.isFinite(w.invYes) ? w.invYes : w.netYes ?? 0;
}
function walletInvN(w: WalletPosition): number {
  return typeof w.invNo === 'number' && Number.isFinite(w.invNo) ? w.invNo : w.netNo ?? 0;
}
/** Net = Inv Y − Inv N (matches holders table). */
function walletNet(w: WalletPosition): number {
  return walletInvY(w) - walletInvN(w);
}

function walletStakeYUsd(w: WalletPosition): number {
  const iy = walletInvY(w);
  const py = typeof w.priceYes === 'number' && Number.isFinite(w.priceYes) ? w.priceYes : NaN;
  return Number.isFinite(py) ? iy * py : NaN;
}
function walletStakeNUsd(w: WalletPosition): number {
  const inn = walletInvN(w);
  const pn = typeof w.priceNo === 'number' && Number.isFinite(w.priceNo) ? w.priceNo : NaN;
  return Number.isFinite(pn) ? inn * pn : NaN;
}
function walletStakeTotalUsd(w: WalletPosition): number {
  const sy = walletStakeYUsd(w);
  const sn = walletStakeNUsd(w);
  if (!(Number.isFinite(sy) || Number.isFinite(sn))) return NaN;
  return (Number.isFinite(sy) ? sy : 0) + (Number.isFinite(sn) ? sn : 0);
}
/** Ledger/display basis: (−inv_y×px_y) − (−inv_n×px_n) = inv_n×px_n − inv_y×px_y — matches Staked Y / Staked N columns (both shown as −(inv×px)). Σ|·| matches backend polycandles. */
function walletStakeNetSignedUsd(w: WalletPosition): number {
  const sy = walletStakeYUsd(w);
  const sn = walletStakeNUsd(w);
  if (!(Number.isFinite(sy) || Number.isFinite(sn))) return NaN;
  const y = Number.isFinite(sy) ? sy : 0;
  const n = Number.isFinite(sn) ? sn : 0;
  return n - y;
}
/** |walletStakeNetSignedUsd| — for sorting by magnitude. */
function walletStakeNetAbsUsd(w: WalletPosition): number {
  const s = walletStakeNetSignedUsd(w);
  return Number.isFinite(s) ? Math.abs(s) : NaN;
}

/** Epsilon for treating signed staked-net as flat (table + cohort bar). */
const STAKED_NET_EPS = 1e-6;

function stakedNetSortKeyDesc(w: WalletPosition): number {
  const v = walletStakeNetSignedUsd(w);
  return Number.isFinite(v) ? -v : Number.NEGATIVE_INFINITY;
}

function stakedNetSortKeyAsc(w: WalletPosition): number {
  const v = walletStakeNetSignedUsd(w);
  return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
}

function stakeSortKeyDesc(w: WalletPosition, leg: 'y' | 'n' | 'tot' | 'net'): number {
  if (leg === 'net') {
    const v = walletStakeNetAbsUsd(w);
    return Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
  }
  const v = leg === 'y' ? walletStakeYUsd(w) : leg === 'n' ? walletStakeNUsd(w) : walletStakeTotalUsd(w);
  return Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
}

/** Σ surplus on display net: favors Y (−inv×py net < 0) vs favors N (> 0) — aligns with table Staked Net Y/N coloring. */
function ToxicFlowStakedProgressBar({ wallets, dense }: { wallets: WalletPosition[]; dense?: boolean }) {
  let sumYesNet = 0;
  let sumNoNet = 0;
  for (const w of wallets) {
    const net = walletStakeNetSignedUsd(w);
    if (!Number.isFinite(net)) continue;
    if (net < -STAKED_NET_EPS) sumYesNet += -net;
    else if (net > STAKED_NET_EPS) sumNoNet += net;
  }
  return <StakedLegUsdBar sumYUsd={sumYesNet} sumNUsd={sumNoNet} dense={dense} barMode="cohortSurplusHalves" />;
}

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
  const mag = fmtUsd2En(Math.abs(signed));
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

function dedupeWalletsByAddress(list: WalletPosition[]): WalletPosition[] {
  const m = new Map<string, WalletPosition>();
  for (const w of list) {
    const k = (w.wallet || '').trim().toLowerCase();
    if (!k) continue;
    if (!m.has(k)) m.set(k, w);
  }
  return [...m.values()];
}

/** Deduped union of Toxic cohort rows — same wallet often appears on only one API list; Top YES/NO need full set for Staked Net sorts. */
function toxicFlowWalletUniverse(data: ToxicFlowData | null | undefined): WalletPosition[] {
  if (!data) return [];
  return dedupeWalletsByAddress([
    ...(data.topHolders ?? []),
    ...(data.topYes ?? []),
    ...(data.topNo ?? []),
    ...(data.topVolume ?? []),
    ...(data.topTraders ?? []),
  ]);
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

function normalizeWinRate(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  // Accept either 0..1 or 0..100 from backend variants.
  const scaled = v > 1 ? v / 100 : v;
  return Math.max(0, Math.min(1, scaled));
}

/** Stored `wallet_scores_ledger.win_rate` → 0–1 fraction; matches WalletScoresLedgerSummaryGrid / Wallet Info Win Rate %. */
function ledgerWinRateFracFromStored(wrRaw: number): number {
  const wrFrac = wrRaw > 1 ? wrRaw / 100 : wrRaw;
  return Math.max(0, Math.min(1, wrFrac));
}

/** Toxic-flow WR bar uses ledger only (`/api/wallet-summary` → wallet_scores_ledger), not toxic row `wallet_scores` join. */
function ledgerSummaryWinRateFracOrNull(s: WalletSummary | null | undefined): number | null {
  if (!s || typeof s.winRate !== 'number' || !Number.isFinite(s.winRate)) return null;
  return ledgerWinRateFracFromStored(s.winRate);
}

/** Aggregate `wallet_scores_ledger.pnl` sign when row market `pnl` alone does not encode green/red here. Row `positivePnl` / `negativePnl` wins if either is set. */
function ledgerAggregatePnlSign(embed: WalletScoresLedgerEmbed | null | undefined): 'pos' | 'neg' | null {
  if (embed == null) return null;
  const p = embed.pnl;
  if (typeof p !== 'number' || !Number.isFinite(p)) return null;
  if (p > 0) return 'pos';
  if (p < 0) return 'neg';
  return null;
}

/** No `wallet_scores_ledger` snapshot on row (`walletLedgerSummary` null or omitted). */
function wslLedgerRowMissing(embed: WalletScoresLedgerEmbed | null | undefined): boolean {
  return embed == null;
}

/** Gold (amber): ledger WR > 60%, ≥10 resolved markets, aggregate ledger PnL > 0 (`wallet_scores_ledger`). */
function ledgerGoldFromEmbed(embed: WalletScoresLedgerEmbed | null | undefined): boolean {
  if (embed == null) return false;
  if ((embed.resolvedMarkets ?? 0) < 10) return false;
  if (typeof embed.winRate !== 'number' || !Number.isFinite(embed.winRate)) return false;
  if (ledgerWinRateFracFromStored(embed.winRate) <= 0.6) return false;
  const pnl = embed.pnl;
  return typeof pnl === 'number' && Number.isFinite(pnl) && pnl > 0;
}

function toxicRowWalletLedgerSummary(row: WalletPosition): WalletSummary | null | undefined {
  if (row.walletLedgerSummary === undefined) return undefined;
  if (row.walletLedgerSummary === null) return null;
  return walletSummaryFromLedgerEmbed(row.wallet, row.walletLedgerSummary);
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

// Wallet hover tooltip — fetches summary on hover, caches results
const summaryCache: Record<string, WalletSummary | null> = {};

/** One toxic-flow wallet tooltip at a time: opening a new one broadcasts so other instances unmount their portal. */
const TOXIC_WALLET_TIP_OPEN = 'polybot:toxic-wallet-tip-open';

type WalletTipPos = { left: number; top: number; placeAbove: boolean };

function WalletLink({
  wallet,
  netShares,
  onOpenWallet,
  isSmart,
  ledgerEmbed,
  ledgerGold,
  positivePnl,
  negativePnl,
}: {
  wallet: string;
  netShares?: number;
  onOpenWallet?: (wallet: string, netShares?: number) => void;
  isSmart?: boolean;
  /** Toxic-flow batched ledger: set (even `null`) to skip `/api/wallet-summary` hover fetch. */
  ledgerEmbed?: WalletScoresLedgerEmbed | null;
  ledgerGold?: boolean;
  positivePnl?: boolean;
  negativePnl?: boolean;
}) {
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

  const scheduleHide = () => {
    clearLeaveTimer();
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null;
      setShow(false);
      setSummary(undefined);
      setTipPos(null);
    }, 220);
  };

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

  const onEnterAnchor = () => {
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
  };

  const onLeaveAnchor = () => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    scheduleHide();
  };

  const ledgerPnlHue = ledgerAggregatePnlSign(ledgerEmbed);
  const addrClass = positivePnl
    ? 'text-green-400'
    : negativePnl
      ? 'text-red-400'
      : ledgerGold
        ? 'text-amber-400'
        : isSmart
          ? 'text-yellow-400'
          : !positivePnl && !negativePnl && ledgerPnlHue === 'pos'
            ? 'text-green-400'
            : !positivePnl && !negativePnl && ledgerPnlHue === 'neg'
              ? 'text-red-400'
              : wslLedgerRowMissing(ledgerEmbed)
                ? 'text-blue-400'
                : 'text-zinc-400';
  const btnTitle = (() => {
    const parts: string[] = [];
    if (positivePnl) parts.push('Positive PnL (this market)');
    if (negativePnl) parts.push('Negative PnL (this market)');
    if (!positivePnl && !negativePnl && !ledgerGold && !isSmart && ledgerPnlHue === 'pos') {
      parts.push('Positive ledger aggregate PnL');
    }
    if (!positivePnl && !negativePnl && !ledgerGold && !isSmart && ledgerPnlHue === 'neg') {
      parts.push('Negative ledger aggregate PnL');
    }
    if (ledgerGold && isSmart) parts.push('Ledger WR >60%, ≥10 resolved, ledger PnL >0; proven smart wallet');
    else {
      if (ledgerGold) parts.push('Ledger WR >60%, ≥10 resolved markets, ledger PnL >0');
      if (isSmart) parts.push('Proven smart wallet');
    }
    if (wslLedgerRowMissing(ledgerEmbed)) parts.push('No wallet_scores_ledger row');
    else if (
      !positivePnl &&
      !negativePnl &&
      ledgerPnlHue == null &&
      !ledgerGold &&
      !isSmart
    ) {
      parts.push('Ledger present (neutral hue)');
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
      onMouseEnter={(e) => {
        mousePosRef.current = { x: e.clientX, y: e.clientY };
        onEnterAnchor();
      }}
      onMouseMove={(e) => {
        mousePosRef.current = { x: e.clientX, y: e.clientY };
        if (show) updateTipPosition();
      }}
      onMouseLeave={onLeaveAnchor}
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
  if (rows.length === 0) {
    return <div className="text-gray-500 text-center py-3 text-[10px]">No {label} data yet</div>;
  }

  const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');
  const fmtSignedInt = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString('en-US')}`;
  const fmtUsdSigned = (v: number) => {
    if (!Number.isFinite(v)) return '–';
    const a = Math.abs(v);
    const s = v >= 0 ? '+' : '−';
    return `${s}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-[10px]">
        <thead>
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
            <th className="text-right px-1" title="inv_yes − inv_no">
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
              const sum = toxicRowWalletLedgerSummary(w);
              const ledgerFrac = ledgerSummaryWinRateFracOrNull(sum === undefined ? null : sum);
              const showWinBar = ledgerFrac != null;
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
              const sharesPct = totalShares && totalShares > 0 ? (Math.abs(signedLegNet) / totalShares) * 100 : 0;
              cumSharesPct += sharesPct;
            const nYColor = iy > 0.001 ? 'text-green-400' : iy < -0.001 ? 'text-red-400' : 'text-gray-500';
            const netYNColor =
              signedLegNet < -0.001 ? 'text-red-400' : signedLegNet > 0.001 ? 'text-green-400' : 'text-gray-500';
              const stakeYUsd = walletStakeYUsd(w);
              const stakeNUsd = walletStakeNUsd(w);
              const stakeNetSigned = walletStakeNetSignedUsd(w);
            return (
              <tr key={w.wallet} className={walletRowClassForStakedNet(!!shadeRowByStakedNet, stakeNetSigned)}>
                <td className="py-0.5 px-1 text-gray-600">{i + 1}</td>
                  <td className="align-top px-0 py-0.5">
                    <button
                      type="button"
                      className="p-0.5 rounded hover:bg-gray-600/40 text-gray-500 hover:text-gray-300"
                      title={favouriteWallets.has(wk) ? 'Remove favourite' : 'Add favourite'}
                      aria-pressed={favouriteWallets.has(wk)}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleFavouriteWallet(w.wallet);
                      }}
                    >
                      <Star
                        size={12}
                        className={
                          favouriteWallets.has(wk) ? 'text-yellow-400 fill-yellow-400' : 'fill-none stroke-gray-400'
                        }
                      />
                    </button>
                  </td>
                  <td className={`relative align-top px-1 py-0.5 ${showWinBar ? 'pb-2' : ''}`}>
                    <WalletLink
                      wallet={w.wallet}
                      netShares={signedLegNet}
                      onOpenWallet={onOpenWallet}
                      isSmart={isSmartGold(w)}
                      ledgerEmbed={w.walletLedgerSummary}
                      ledgerGold={ledgerGoldFromEmbed(w.walletLedgerSummary)}
                      positivePnl={typeof w.pnl === 'number' && Number.isFinite(w.pnl) && w.pnl > 0}
                      negativePnl={typeof w.pnl === 'number' && Number.isFinite(w.pnl) && w.pnl < 0}
                    />
                    {showWinBar && <WinRateBottomBar winRate={ledgerFrac!} className="absolute bottom-0 left-0 right-0" />}
                  </td>
                  <td className={`text-right px-1 font-bold ${nYColor} bg-green-900/10`}>{fmtInt(iy)}</td>
                  <td className="text-right px-1 font-bold text-red-400 bg-red-900/10">{fmtInt(inn)}</td>
                  <td className={`text-right px-1 font-bold ${netYNColor}`}>{fmtInt(signedLegNet)}</td>
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
            });
          })()}
        </tbody>
      </table>
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

export function ToxicFlowDialog({ open, marketId, marketName, yesTokenId, onClose, embedded = false }: ToxicFlowDialogProps) {
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

  const [data, setData] = useState<ToxicFlowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('topHolders');
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState('');

  const redFlagLedgerMap = useMemo(() => {
    const m: Record<string, WalletSummary | null> = {};
    for (const f of data?.redFlags ?? []) {
      const k = String(f.wallet || '').trim().toLowerCase();
      if (!k || f.walletLedgerSummary === undefined) continue;
      m[k] = f.walletLedgerSummary === null ? null : walletSummaryFromLedgerEmbed(f.wallet!, f.walletLedgerSummary);
    }
    return m;
  }, [data?.redFlags]);

  const load = useCallback(async () => {
    if (!marketId) return;
    setLoading(true);
    setError('');
    try {
      const d = await fetchToxicFlow(marketId);
      setData(d);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    if (open) {
      setTab('topHolders');
      load();
      // Auto-refresh every 5s while open
      const iv = setInterval(async () => {
        try {
          const d = await fetchToxicFlow(marketId);
          setData(d);
        } catch { /* silent refresh failure */ }
      }, 5000);
      return () => clearInterval(iv);
    } else {
      setData(null);
    }
  }, [open, load, marketId]);

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

  /** Staked bar always aggregates Top Holders cohort regardless of active tab. */
  const walletsForStakedBar = useMemo((): WalletPosition[] => {
    if (!data) return [];
    return topHoldersWallets;
  }, [data, topHoldersWallets]);

  const walletMarketPnlByKey = useMemo(() => {
    const m = new Map<string, number>();
    if (!data) return m;
    for (const w of toxicFlowWalletUniverse(data)) {
      const k = (w.wallet || '').trim().toLowerCase();
      if (!k || typeof w.pnl !== 'number' || !Number.isFinite(w.pnl)) continue;
      m.set(k, w.pnl);
    }
    return m;
  }, [data]);

  if (!open) return null;

  const openWalletDialog = (wallet: string, _netShares?: number) => {
    setSelectedWallet(wallet);
    setWalletDialogOpen(true);
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'topHolders', label: 'Top Holders', icon: <Crown size={11} /> },
    { key: 'topYes', label: 'Top YES', icon: <TrendingUp size={11} /> },
    { key: 'topNo', label: 'Top NO', icon: <TrendingDown size={11} /> },
    { key: 'topVolume', label: 'Top Volume', icon: <Users size={11} /> },
    { key: 'topTraders', label: 'Top Traders', icon: <AlertTriangle size={11} /> },
  ];

  const rootClass = embedded
    ? 'flex flex-col flex-1 min-h-0 min-w-0 h-full w-full overflow-hidden bg-gray-900'
    : 'fixed inset-0 bg-black/60 z-[49999] flex items-center justify-center';
  const cardClass = embedded
    ? 'bg-gray-800 flex flex-col flex-1 min-h-0 min-w-0 p-3 border-0 border-gray-700/50 w-full rounded-none shadow-none'
    : 'bg-gray-800 rounded-lg p-4 max-w-4xl w-full mx-4 shadow-xl border border-gray-700';
  const cardStyle: React.CSSProperties = embedded ? { maxHeight: '100%', minHeight: 0 } : { maxHeight: '85vh' };
  const scrollClass = embedded ? 'overflow-y-auto flex-1 min-h-0' : 'overflow-y-auto';
  const scrollStyle: React.CSSProperties | undefined = embedded ? undefined : { maxHeight: 'calc(85vh - 120px)' };

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

        {/* Content */}
        <div className={scrollClass} style={scrollStyle}>
          {loading && <div className="text-gray-500 text-center py-8">Loading on-chain data...</div>}
          {error && <div className="text-red-400 text-center py-8">Error: {error}</div>}

          {!loading && !error && data && (
            <div className="space-y-3">
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

              {/* Informed Trader Bias */}
              <div className="bg-gray-900 rounded p-3">
                <div className="text-[10px] text-gray-500 mb-2 font-bold">Informed Trader Bias</div>
                {(() => {
                  const thb = data.topHoldersBias || 0;
                  const wb = data.whaleBias || 0;
                  const isUpDownMarket = /up\s+or\s+down|updown|up-or-down/i.test(marketName || '');
                  const isUpDown1hOr4h = isUpDownMarket && /\b1[- ]?h\b|updown-4h|\b4[- ]?h\b/i.test(marketName || '');
                  const posLabel = isUpDownMarket ? 'UP' : 'YES';
                  const negLabel = isUpDownMarket ? 'DOWN' : 'NO';
                  const biasLabel = (v: number) => v > 0.01 ? posLabel : v < -0.01 ? negLabel : 'FLAT';
                  const biasColor = (v: number) => v > 0.01 ? 'text-green-400' : v < -0.01 ? 'text-red-400' : 'text-gray-500';
                  const barFor = (v: number) => Math.max(2, Math.min(98, 50 + v * 50));
                  const proven = (data as any).provenSMS || 0;
                  const crowd = (data as any).crowdBias || 0;
                  const provenPct = proven * 100;
                  const crowdPct = crowd * 100;
                  const yesTotal = (data.yesUsdcIn || 0) + (data.noUsdcIn || 0);
                  const yesPct = yesTotal > 0 ? (data.yesUsdcIn / yesTotal) * 100 : 50;
                  return (
                    <div className="space-y-2.5">
                      {/* Proven Smart Money */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-gray-500">Smart Money (proven wallets)</span>
                          <span className={`text-[11px] font-bold ${biasColor(proven)}`}>
                            {biasLabel(proven)} <span className="text-[9px] font-normal">({provenPct > 0 ? '+' : ''}{provenPct.toFixed(1)}%)</span>
                          </span>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                          <div className="bg-yellow-400/75 h-full transition-all" style={{ width: `${barFor(proven)}%` }} />
                          <div className="bg-purple-400/75 h-full transition-all flex-1" />
                        </div>
                      </div>

                      {/* Crowd Bias */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-gray-500">Crowd (all wallets)</span>
                          <span className={`text-[11px] font-bold ${biasColor(crowd)}`}>
                            {biasLabel(crowd)} <span className="text-[9px] font-normal">({crowdPct > 0 ? '+' : ''}{crowdPct.toFixed(1)}%)</span>
                          </span>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                          <div className="bg-blue-500/70 h-full transition-all" style={{ width: `${barFor(crowd)}%` }} />
                          <div className="bg-orange-500/70 h-full transition-all flex-1" />
                        </div>
                      </div>

                      {/* Staked Y vs N — rows in the active below table tab */}
                      <div title="Splits each Top Holder signed Staked Net (inv×px) into YES vs NO surplus halves; the number above the bar is sum of absolute per-wallet nets in this cohort—not capped by headline Staked.">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-gray-500">Staked Net USD (Top Holders)</span>
                          <span className="text-[8px] text-gray-600">{TOXIC_TAB_COHORT_LABEL.topHolders}</span>
                        </div>
                        <ToxicFlowStakedProgressBar wallets={walletsForStakedBar} dense />
                      </div>

                      {/* Top 10 Holders Bias */}
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-gray-500">Top 10 Holders Direction</span>
                        <span className={`text-[11px] font-bold ${biasColor(thb)}`}>
                          {biasLabel(thb)} <span className="text-[9px] font-normal">({thb > 0 ? '+' : ''}{thb.toFixed(1)} shares)</span>
                        </span>
                      </div>

                      {/* Whale Bias */}
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-gray-500">Whale Bias ({data.whaleCount || 0} above-median wallets)</span>
                        <span className={`text-[11px] font-bold ${biasColor(wb)}`}>
                          {biasLabel(wb)} <span className="text-[9px] font-normal">({wb > 0 ? '+' : ''}{wb.toFixed(1)} shares)</span>
                        </span>
                      </div>

                      {/* Winner Bias (USDC & Shares) — from backend via WS, same source as sidebar */}
                      {(() => {
                        const live = yesTokenId ? marketLookup[yesTokenId] : undefined;
                        const wbUsdc = typeof live?.winnerBias === 'number' && Number.isFinite(live.winnerBias) ? live.winnerBias : null;
                        const yesWR = typeof live?.winnerBiasYesWR === 'number' ? live.winnerBiasYesWR : null;
                        const noWR = typeof live?.winnerBiasNoWR === 'number' ? live.winnerBiasNoWR : null;
                        const wbShares = typeof live?.winBiasShares === 'number' && Number.isFinite(live.winBiasShares) ? live.winBiasShares : null;
                        const yesWRs = typeof live?.winBiasSharesYes === 'number' ? live.winBiasSharesYes : null;
                        const noWRs = typeof live?.winBiasSharesNo === 'number' ? live.winBiasSharesNo : null;
                        const wbCvUsdc = typeof live?.winnerBiasConviction === 'number' && Number.isFinite(live.winnerBiasConviction) ? live.winnerBiasConviction : null;
                        const yesWRcv = typeof live?.winnerBiasConvictionYesWR === 'number' ? live.winnerBiasConvictionYesWR : null;
                        const noWRcv = typeof live?.winnerBiasConvictionNoWR === 'number' ? live.winnerBiasConvictionNoWR : null;
                        const wbCvSh = typeof live?.winBiasConvictionShares === 'number' && Number.isFinite(live.winBiasConvictionShares) ? live.winBiasConvictionShares : null;
                        const yesWRcvs = typeof live?.winBiasConvictionSharesYes === 'number' ? live.winBiasConvictionSharesYes : null;
                        const noWRcvs = typeof live?.winBiasConvictionSharesNo === 'number' ? live.winBiasConvictionSharesNo : null;

                        const renderBar = (label: string, bias: number | null, yesWr: number | null, noWr: number | null) => {
                          if (bias == null) return null;
                          const barPct = Math.max(2, Math.min(98, 50 + bias * 50));
                          const side = bias > 0.01 ? posLabel : bias < -0.01 ? negLabel : 'EVEN';
                          const color = bias > 0.01 ? 'text-cyan-300' : bias < -0.01 ? 'text-pink-300' : 'text-gray-500';
                          return (
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[9px] text-gray-500">{label}</span>
                                <span className={`text-[11px] font-bold ${color}`}>{side}</span>
                              </div>
                              <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                                <div className="bg-cyan-400/75 h-full transition-all" style={{ width: `${barPct}%` }} />
                                <div className="bg-pink-400/75 h-full transition-all flex-1" />
                              </div>
                              <div className="flex justify-between mt-0.5 text-[9px] text-gray-500">
                                {yesWr != null && <span>{posLabel} WR: <span className={yesWr >= 0.5 ? 'text-cyan-300' : 'text-pink-300'}>{(yesWr * 100).toFixed(0)}%</span></span>}
                                {noWr != null && <span>{negLabel} WR: <span className={noWr >= 0.5 ? 'text-cyan-300' : 'text-pink-300'}>{(noWr * 100).toFixed(0)}%</span></span>}
                              </div>
                            </div>
                          );
                        };

                        return (
                          <div>
                            <p className="text-[8px] text-gray-500 leading-snug mb-1.5">
                              Compares <span className="text-gray-400">historical win rate</span> (top 30% of USDC or shares on each side).
                              Table <span className="text-gray-400">staked</span> columns are this market only — they often diverge from all-time win rate.
                            </p>
                            {renderBar('Winner Bias (top 30% USDC)', wbUsdc, yesWR, noWR)}
                            {renderBar('Winner Bias (top 30% Shares)', wbShares, yesWRs, noWRs)}
                            {renderBar('Winner Bias Conviction (USDC)', wbCvUsdc, yesWRcv, noWRcv)}
                            {renderBar('Winner Bias Conviction (Shares)', wbCvSh, yesWRcvs, noWRcvs)}
                          </div>
                        );
                      })()}

                      {/* YES vs NO wallet breakdown */}
                      <div className="border-t border-gray-700/70 pt-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-gray-500">Wallet Split</span>
                          <span className="text-[9px] text-gray-400">
                            <span className="text-green-400 font-bold">{data.yesWallets || 0}</span> YES
                            {' / '}
                            <span className="text-red-400 font-bold">{data.noWallets || 0}</span> NO
                  </span>
                </div>
                        <div className="h-2.5 bg-gray-700 rounded-full overflow-hidden flex">
                          <div className="bg-green-500/60 h-full transition-all" style={{ width: `${yesPct}%` }} />
                          <div className="bg-red-500/60 h-full transition-all flex-1" />
                        </div>
                        <div className="flex justify-between mt-0.5 text-[9px] text-gray-500">
                          <span>YES ${(data.yesUsdcIn || 0).toFixed(2)}</span>
                          <span>NO ${(data.noUsdcIn || 0).toFixed(2)}</span>
                        </div>
                      </div>

                      {/* YES/NO token volume */}
                      <div className="border-t border-gray-700/70 pt-2">
                        <div className="h-2.5 bg-gray-700 rounded-full overflow-hidden flex">
                  {(() => {
                    const total = data.totalYesVol + data.totalNoVol;
                            const yp = total > 0 ? (data.totalYesVol / total) * 100 : 50;
                    return (
                      <>
                                <div className="bg-green-500/60 h-full transition-all" style={{ width: `${yp}%` }} />
                                <div className="bg-red-500/60 h-full transition-all flex-1" />
                      </>
                    );
                  })()}
                </div>
                        <div className="flex justify-between mt-0.5 text-[9px] text-gray-500">
                  <span>YES vol: {data.totalYesVol.toFixed(1)}</span>
                  <span>NO vol: {data.totalNoVol.toFixed(1)}</span>
                </div>
              </div>
                    </div>
                  );
                })()}
              </div>

              {/* Manipulation Red Flags */}
              {(() => {
                const rf = data.redFlags ?? [];
                const highFlags = rf.filter(f => f.level === 'high');
                const medFlags = rf.filter(f => f.level === 'medium');
                const netByWallet: Record<string, number> = {};
                const smartSet = new Set<string>();
                const addWallets = (arr?: WalletPosition[] | null) => {
                  for (const w of arr || []) {
                    if (!w?.wallet) continue;
                    const k = w.wallet.toLowerCase();
                    netByWallet[k] = w.net || 0;
                    if (isSmartGold(w)) smartSet.add(k);
                  }
                };
                addWallets(topHoldersWallets);
                addWallets(topYesWallets);
                addWallets(topNoWallets);
                addWallets(data.topVolume);
                addWallets(data.topTraders);
                const hasConcentration = data.concentration > 0.5;
                const hasTopHolderBias = Math.abs(data.topHoldersBias || 0) > 50;
                const totalFlags = highFlags.length + medFlags.length + (hasConcentration ? 1 : 0) + (hasTopHolderBias ? 1 : 0);

                return (
                  <div className={`rounded p-3 ${highFlags.length > 0 ? 'bg-red-950/40 border border-red-800/40' : 'bg-gray-900'}`}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <ShieldAlert size={12} className={highFlags.length > 0 ? 'text-red-400' : 'text-gray-500'} />
                      <span className={`text-[10px] font-bold ${highFlags.length > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                        Manipulation Signals
                        {totalFlags > 0 && <span className="ml-1 text-[9px] rounded bg-red-500/30 px-1 py-0.5">{totalFlags} active</span>}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {highFlags.map((f, i) => {
                        const wlk = f.wallet?.toLowerCase();
                        const lf = wlk ? ledgerSummaryWinRateFracOrNull(redFlagLedgerMap[wlk] ?? null) : null;
                        const showWinBar = lf != null;
                        return (
                          <div key={`h${i}`} className="flex items-start gap-1.5 text-[10px]">
                            <AlertTriangle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                            <span className="text-gray-200">
                              {f.wallet ? (
                                <>
                                  {showWinBar ? (
                                    <span className="inline-flex flex-col gap-0.5 align-baseline mr-0.5">
                                      <WalletLink
                                        wallet={f.wallet}
                                        netShares={netByWallet[f.wallet.toLowerCase()]}
                                        onOpenWallet={openWalletDialog}
                                        isSmart={smartSet.has(f.wallet.toLowerCase())}
                                        ledgerEmbed={f.walletLedgerSummary}
                                        ledgerGold={ledgerGoldFromEmbed(f.walletLedgerSummary)}
                                        positivePnl={(walletMarketPnlByKey.get(f.wallet.toLowerCase()) ?? 0) > 0}
                                        negativePnl={(walletMarketPnlByKey.get(f.wallet.toLowerCase()) ?? 0) < 0}
                                      />
                                      <WinRateBottomBar winRate={lf!} />
                                    </span>
                                  ) : (
                                    <WalletLink
                                      wallet={f.wallet}
                                      netShares={netByWallet[f.wallet.toLowerCase()]}
                                      onOpenWallet={openWalletDialog}
                                      isSmart={smartSet.has(f.wallet.toLowerCase())}
                                      ledgerEmbed={f.walletLedgerSummary}
                                      ledgerGold={ledgerGoldFromEmbed(f.walletLedgerSummary)}
                                      positivePnl={(walletMarketPnlByKey.get(f.wallet.toLowerCase()) ?? 0) > 0}
                                      negativePnl={(walletMarketPnlByKey.get(f.wallet.toLowerCase()) ?? 0) < 0}
                                    />
                                  )}{' '}
                                  {f.detail.replace(/^0x[a-fA-F0-9]{4}\u2026[a-fA-F0-9]{4}\s*/, '')}
                                </>
                              ) : (
                                f.detail
                              )}
                            </span>
                          </div>
                        );
                      })}
                      {medFlags.map((f, i) => {
                        const wlk = f.wallet?.toLowerCase();
                        const lf = wlk ? ledgerSummaryWinRateFracOrNull(redFlagLedgerMap[wlk] ?? null) : null;
                        const showWinBar = lf != null;
                        return (
                          <div key={`m${i}`} className="flex items-start gap-1.5 text-[10px]">
                            <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                            <span className="text-gray-300">
                              {f.wallet ? (
                                <>
                                  {showWinBar ? (
                                    <span className="inline-flex flex-col gap-0.5 align-baseline mr-0.5">
                                      <WalletLink
                                        wallet={f.wallet}
                                        netShares={netByWallet[f.wallet.toLowerCase()]}
                                        onOpenWallet={openWalletDialog}
                                        isSmart={smartSet.has(f.wallet.toLowerCase())}
                                        ledgerEmbed={f.walletLedgerSummary}
                                        ledgerGold={ledgerGoldFromEmbed(f.walletLedgerSummary)}
                                        positivePnl={(walletMarketPnlByKey.get(f.wallet.toLowerCase()) ?? 0) > 0}
                                        negativePnl={(walletMarketPnlByKey.get(f.wallet.toLowerCase()) ?? 0) < 0}
                                      />
                                      <WinRateBottomBar winRate={lf!} />
                                    </span>
                                  ) : (
                                    <WalletLink
                                      wallet={f.wallet}
                                      netShares={netByWallet[f.wallet.toLowerCase()]}
                                      onOpenWallet={openWalletDialog}
                                      isSmart={smartSet.has(f.wallet.toLowerCase())}
                                      ledgerEmbed={f.walletLedgerSummary}
                                      ledgerGold={ledgerGoldFromEmbed(f.walletLedgerSummary)}
                                      positivePnl={(walletMarketPnlByKey.get(f.wallet.toLowerCase()) ?? 0) > 0}
                                      negativePnl={(walletMarketPnlByKey.get(f.wallet.toLowerCase()) ?? 0) < 0}
                                    />
                                  )}{' '}
                                  {f.detail.replace(/^0x[a-fA-F0-9]{4}\u2026[a-fA-F0-9]{4}\s*/, '')}
                                </>
                              ) : (
                                f.detail
                              )}
                            </span>
                          </div>
                        );
                      })}
                      {hasConcentration && (
                        <div className="flex items-start gap-1.5 text-[10px]">
                          <AlertTriangle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                          <span className="text-gray-200">Top 5 wallets control {(data.concentration * 100).toFixed(0)}% of volume — potential whale manipulation</span>
                    </div>
                  )}
                      {hasTopHolderBias && (
                        <div className="flex items-start gap-1.5 text-[10px]">
                          <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                          <span className="text-gray-300">Top 10 holders have {Math.abs(data.topHoldersBias).toFixed(0)} net {data.topHoldersBias > 0 ? 'YES' : 'NO'} shares — informed players positioned {data.topHoldersBias > 0 ? 'YES' : 'NO'}</span>
                    </div>
                  )}
                  {data.totalWallets === 0 && (
                        <div className="space-y-1.5 text-[10px] text-gray-500">
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
                      {data.totalWallets > 0 && totalFlags === 0 && (
                    <div className="flex items-center gap-1.5 text-[10px]">
                          <span className="text-green-400">No manipulation signals detected.</span>
                    </div>
                  )}
                </div>
              </div>
                );
              })()}

              {/* Tabs + bottom table (switch only this section) */}
              <div className="bg-gray-900/60 rounded p-2">
                <div className="flex gap-1 mb-2 border-b border-gray-700 pb-2">
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

                {tab === 'topHolders' && (
                  <WalletTable
                    wallets={topHoldersWallets}
                    label="holders"
                    totalShares={data.totalShares}
                    onOpenWallet={openWalletDialog}
                  />
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
                {tab === 'topTraders' && (
                  <WalletTable wallets={data.topTraders} label="traders" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                )}
              </div>
            </div>
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
