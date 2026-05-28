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
import { Star, Bell, X } from 'lucide-react';
import {
  fetchWalletSummary,
  walletSummaryFromLedgerEmbed,
  type ToxicFlowSwarm,
  type WalletPosition,
  type WalletSummary,
  type WalletScoresLedgerEmbed,
} from '../api';
import {
  readToxicFavouriteWallets,
  persistToxicFavouriteWallets,
  readToxicBellWallets,
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
import { HelperTooltip } from './HelperTooltip';
import { StakedLegUsdBar } from './StakedLegUsdBar';
import { ToxicFlowSwarmsSlotChart } from './ToxicFlowSwarmsSlotChart';
import { WalletAddressGlyph } from './WalletAddressGlyph';
import { ToxicFlowRowActionsTip } from './ToxicFlowRowActionsTip';
import {
  STAKED_NET_EPS,
  walletStakeNetSignedUsd,
  walletStakeNetAbsUsd,
  toxicCohortStakedNetSurplusHalves,
  ledgerWinRateFracFromStored,
  toxicRowResolvedStatsLow,
  isToxicFlowSwarmWallet,
} from '../lib/toxicFlowStakeCohort';
import { ledgerHighWinRateFromLedgerInput, walletAddressColorClass } from '../lib/walletAddressColor';
import { primeTiltAudioContextFromUserGesture } from '../lib/tiltNotifySound';
import { toxicWalletDisplayLabel } from '../lib/toxicWalletDisplayLabel';
import { useToxicWalletTag } from '../lib/toxicWalletTags';
import {
  readTiltWhaleAmountUsd,
  DEFAULT_TILT_WHALE_AMOUNT_USD,
  TILT_WHALE_AMOUNT_USD_CHANGED_EVENT,
  TILT_WHALE_AMOUNT_USD_LS_KEY,
} from '../lib/tiltWhaleAmountUsd';
import { useNotifyTiltAppliesToSelectedMarket } from '../lib/notifyTiltMarketFilters';
import { useAppStore } from '../stores/appStore';
import { TOXIC_TABLE_ROW_CLS } from '../lib/toxicFlowTableAnimate';
import { useCancelDomAnimationsOnUnmount } from '../lib/cancelDomAnimations';
import {
  STAKED_NET_FLASH_MS,
  type StakedNetFlashDir,
  stakedNetDeltaFlashDir,
  stakedNetUsdTableCellWithFlash,
} from '../lib/toxicStakedNetFlash';
import { fmtPriceShare, walletMarketUsdcInCell } from './WalletLatestMarketsTradedTable';

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

function rPnlToneClass(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return 'text-gray-400';
  return v > 0 ? 'text-green-400' : 'text-red-400';
}

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

function fmtWalletMarketRoiFromFlow(m: WalletPosition): { text: string; tone: string } {
  const usdcIn = typeof m.usdcIn === 'number' && Number.isFinite(m.usdcIn) ? m.usdcIn : 0;
  const usdcOut = typeof m.usdcOut === 'number' && Number.isFinite(m.usdcOut) ? m.usdcOut : 0;
  const fee = typeof m.feeTotal === 'number' && Number.isFinite(m.feeTotal) ? m.feeTotal : 0;
  const denom = usdcIn + fee;
  if (!(denom > 0)) return { text: '–', tone: 'text-gray-500' };
  return fmtRoiPercent(usdcOut / denom - 1);
}

function walletMarketPayoutPnlRoiCells(m: WalletPosition) {
  const rowUsdcIn = typeof m.usdcIn === 'number' && Number.isFinite(m.usdcIn) ? m.usdcIn : 0;
  const rowUsdcOut = typeof m.usdcOut === 'number' && Number.isFinite(m.usdcOut) ? m.usdcOut : 0;
  const rowFee = typeof m.feeTotal === 'number' && Number.isFinite(m.feeTotal) ? m.feeTotal : 0;
  const rowPnlFlow = rowUsdcOut - rowUsdcIn - rowFee;
  const rowPayout = typeof m.payout === 'number' && Number.isFinite(m.payout) ? m.payout : 0;
  const wlfSum = (m.w ?? 0) + (m.l ?? 0) + (m.f ?? 0);
  const payoutUnresolved = wlfSum === 0;
  const hasChainOutcome = m.outcome === 0 || m.outcome === 1;
  const roiFmt = hasChainOutcome ? fmtWalletMarketRoiFromFlow(m) : { text: '–', tone: 'text-gray-500' };
  return { rowPnlFlow, rowPayout, payoutUnresolved, roiFmt };
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

const TOXIC_WALLET_ROW_PX = 23;
const TOXIC_VIRTUAL_OVERSCAN = 12;

type ToxicFlowTableVariant = 'toxicFlow' | 'marketView' | 'swarms';

function toxicTableColCount(showRank: boolean, variant: ToxicFlowTableVariant): number {
  const favCol = variant === 'swarms' ? 0 : 1;
  return (showRank ? 1 : 0) + favCol + 11;
}

function marketIsUpDown(market: { question?: string; eventSlug?: string } | null | undefined): boolean {
  return !!(market?.question?.match(/up\s+or\s+down/i) || market?.eventSlug?.match(/up-or-down|updown/i));
}

export function SwarmSidePill({ side, upDown }: { side: string | undefined; upDown: boolean }) {
  const s = (side || '').trim().toUpperCase();
  const yes = s === 'YES' || s === 'Y' || s === 'UP';
  const text = yes ? (upDown ? 'UP' : 'YES') : upDown ? 'DOWN' : 'NO';
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1 py-px text-[9px] font-bold leading-none ${
        yes ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
      }`}
    >
      {text}
    </span>
  );
}

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
    /** Swarm / synthetic row label (overrides address shortening). */
    rowDisplayLabel?: string;
  }
>(function WalletLink(
  {
    wallet,
    netShares,
    onOpenWallet,
    isSmart,
    ledgerEmbed,
    ledgerGold,
    rowDisplayLabel,
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

  const swarmRow = isToxicFlowSwarmWallet(wallet);
  const walletTag = useToxicWalletTag(swarmRow ? '' : wallet);
  const polymarketNick = polymarketNicknameFromEmbed(ledgerEmbed);
  const displayLabel = toxicWalletDisplayLabel(wallet, {
    tag: swarmRow ? null : walletTag,
    ledgerEmbed,
    displayLabel: rowDisplayLabel,
  });

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
  const highWinRateAddr =
    !ledgerAbsent && !resolvedStatsLow && ledgerHighWinRateFromLedgerInput(ledgerEmbed, summary);
  const addrClass = walletAddressColorClass({ ledgerEmbed, summary, isSmart, ledgerGold });
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
    if (highWinRateAddr) parts.push('Ledger WR ≥75%, ≥10 resolved markets');
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
  tiltRowFlashEnabled?: boolean;
  toggleFavouriteWallet: (addr: string, nickname?: string) => void;
  toggleBellWallet: (addr: string) => void;
  toggleXWallet: (addr: string) => void;
  onOpenWallet?: (wallet: string, netShares?: number) => void;
  stakedPct: number;
  cumStakedPct: number;
  favColRef?: RefObject<HTMLTableCellElement>;
  selectedWallet?: string | null;
  onRowClick?: (wallet: string) => void;
  showRank?: boolean;
  variant?: ToxicFlowTableVariant;
  swarmUpDownMarket?: boolean;
  onSwarmRowHover?: (wallet: string | null) => void;
}

function WalletTableBodyRowImpl({
  rank,
  w,
  shadeRowByStakedNet,
  favouriteActive,
  bellActive,
  xActive,
  tiltWhaleAmountUsd,
  tiltRowFlashEnabled = true,
  toggleFavouriteWallet,
  toggleBellWallet,
  toggleXWallet,
  onOpenWallet,
  stakedPct,
  cumStakedPct,
  favColRef,
  selectedWallet,
  onRowClick,
  showRank = true,
  variant = 'toxicFlow',
  swarmUpDownMarket = false,
  onSwarmRowHover,
}: WalletTableBodyRowProps) {
  const trRef = useRef<HTMLTableRowElement>(null);
  useCancelDomAnimationsOnUnmount(trRef);
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
  const marketViewCols = variant === 'marketView';
  const displayIy = marketViewCols
    ? Math.max(typeof w.maxInvYes === 'number' && Number.isFinite(w.maxInvYes) ? w.maxInvYes : 0, iy)
    : iy;
  const displayInn = marketViewCols
    ? Math.max(typeof w.maxInvNo === 'number' && Number.isFinite(w.maxInvNo) ? w.maxInvNo : 0, inn)
    : inn;
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
    tiltRowFlashEnabled &&
    !rowNearResolved &&
    Number.isFinite(stakeNetAbsUsd) &&
    stakeNetAbsUsd >= tiltWhaleAmountUsd;
  const rowClass =
    walletRowClassForStakedNet(shadeRowByStakedNet, stakeNetSigned) +
    rowPulseClassFor(bellActive && tiltRowFlashEnabled, tiltWhaleRowFlash) +
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
  const swarmRow = isToxicFlowSwarmWallet(w.wallet);
  const wk = (w.wallet || '').trim().toLowerCase();
  const selected = selectedWallet?.trim().toLowerCase() === wk;
  const { rowPnlFlow, rowPayout, payoutUnresolved, roiFmt } = marketViewCols
    ? walletMarketPayoutPnlRoiCells(w)
    : { rowPnlFlow: 0, rowPayout: 0, payoutUnresolved: true, roiFmt: { text: '–', tone: 'text-gray-500' } };
  const rowUsdcIn = typeof w.usdcIn === 'number' && Number.isFinite(w.usdcIn) ? w.usdcIn : 0;

  return (
    <tr
      ref={trRef}
      className={`${rowClass} ${TOXIC_TABLE_ROW_CLS}${selected ? ' bg-gray-700/40' : ''}${onRowClick ? ' cursor-pointer' : ''}`}
      onMouseEnter={
        swarmRow && onSwarmRowHover
          ? () => onSwarmRowHover(w.wallet)
          : swarmRow
            ? undefined
            : onRowEnter
      }
      onMouseMove={swarmRow ? undefined : onRowMove}
      onMouseLeave={
        swarmRow && onSwarmRowHover
          ? () => onSwarmRowHover(null)
          : swarmRow
            ? undefined
            : onRowLeave
      }
      onClick={onRowClick ? () => onRowClick(w.wallet) : undefined}
    >
      {showRank ? (
        <td className={`${TOXIC_TABLE_BODY_TD_CLS} pr-0 text-gray-600 ${TOXIC_TABLE_RANK_COL_CLS}`}>{rank}</td>
      ) : null}
      {variant !== 'swarms' ? (
        <td ref={favColRef} className={`${TOXIC_TABLE_BODY_TD_CLS} ${TOXIC_TABLE_FAV_COL_CLS}`}>
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
      ) : null}
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} whitespace-nowrap px-1`}>
        <div className={TOXIC_TABLE_ROW_INNER_CLS}>
          {swarmRow ? (
            <span className="flex items-center gap-1 min-w-0 font-bold text-gray-200 leading-none" title={w.displayLabel}>
              <span className="truncate">{w.displayLabel ?? w.wallet}</span>
              <SwarmSidePill side={w.netSide} upDown={swarmUpDownMarket} />
            </span>
          ) : (
            <WalletLink
              ref={hoverRef}
              wallet={w.wallet}
              netShares={signedLegNet}
              onOpenWallet={onOpenWallet}
              isSmart={isSmartGold(w)}
              ledgerEmbed={ledgerEmbed}
              ledgerGold={ledgerGoldFromEmbed(ledgerEmbed)}
              rowDisplayLabel={w.displayLabel}
            />
          )}
        </div>
      </td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 font-bold ${invYToneClass(displayIy)} bg-green-900/10`}>{rowFmtInt(displayIy)}</td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 font-bold text-red-400 bg-red-900/10`}>{rowFmtInt(displayInn)}</td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 whitespace-nowrap tabular-nums`} title="inv_yes − inv_no (|net| Y / N)">
        {inventoryNetSharesTableCell(signedLegNet)}
      </td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 tabular-nums ${priceSharePxClass(w.priceYes)}`}>{fmtPriceShare(w.priceYes)}</td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 tabular-nums ${priceSharePxClass(w.priceNo)}`}>{fmtPriceShare(w.priceNo)}</td>
      <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 text-gray-400`}>
        {typeof w.tradeCount === 'number' && Number.isFinite(w.tradeCount) ? rowFmtInt(w.tradeCount) : '–'}
      </td>
      <td
        className={`${TOXIC_TABLE_BODY_TD_CLS} px-1 ${TOXIC_TABLE_STAKED_COL_CLS}`}
        title={marketViewCols ? 'usdc_in' : 'Signed Staked Net USD; Y / N suffix by dominant inv leg'}
      >
        {marketViewCols
          ? walletMarketUsdcInCell(rowUsdcIn)
          : stakedNetUsdTableCellWithFlash(stakeNetSigned, stakedNetFlash)}
      </td>
      {!marketViewCols ? (
        <td className={`${TOXIC_TABLE_BODY_TD_CLS} px-1 text-cyan-300 ${TOXIC_TABLE_STAKED_PCT_COL_CLS}`}>
          {stakedPct > 0 ? `${NF_PCT_1.format(stakedPct)}%` : '-'}
        </td>
      ) : null}
      {marketViewCols ? (
        <>
          <td
            className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 tabular-nums font-bold ${payoutUnresolved ? 'text-gray-500' : rPnlToneClass(rowPayout)}`}
            title={payoutUnresolved ? 'Market not scored (W/L/F all zero)' : 'wallet_market_positions.payout'}
          >
            {payoutUnresolved ? '-' : fmtUsdSignedLedger(rowPayout)}
          </td>
          <td
            className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 tabular-nums font-bold ${rPnlToneClass(rowPnlFlow)}`}
            title="usdc_out − usdc_in − fee"
          >
            {fmtUsdSignedLedger(rowPnlFlow)}
          </td>
          <td
            className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 tabular-nums font-bold ${roiFmt.tone}`}
            title="(usdc_out/(usdc_in+fee)) − 1"
          >
            {roiFmt.text}
          </td>
        </>
      ) : (
        <>
          <td className={`${TOXIC_TABLE_BODY_TD_CLS} px-1 text-cyan-200/70 ${TOXIC_TABLE_STAKED_PCT_COL_CLS}`}>
            {cumStakedPct > 0 ? `${NF_PCT_1.format(cumStakedPct)}%` : '-'}
          </td>
          <td className={`${TOXIC_TABLE_BODY_TD_CLS} text-right px-1 ${biasToneClass(signedLegNet)}`}>
            {`${NF_INT_EN.format(Math.round(bias * 100))}%`}
          </td>
        </>
      )}
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
    a.tiltRowFlashEnabled !== b.tiltRowFlashEnabled ||
    a.stakedPct !== b.stakedPct ||
    a.cumStakedPct !== b.cumStakedPct ||
    a.toggleFavouriteWallet !== b.toggleFavouriteWallet ||
    a.toggleBellWallet !== b.toggleBellWallet ||
    a.toggleXWallet !== b.toggleXWallet ||
    a.onOpenWallet !== b.onOpenWallet ||
    a.selectedWallet !== b.selectedWallet ||
    a.onRowClick !== b.onRowClick ||
    a.showRank !== b.showRank ||
    a.variant !== b.variant ||
    a.swarmUpDownMarket !== b.swarmUpDownMarket ||
    a.onSwarmRowHover !== b.onSwarmRowHover
  ) {
    return false;
  }
  const wa = a.w;
  const wb = b.w;
  if (wa === wb) return true;
  if (
    wa.wallet !== wb.wallet ||
    wa.displayLabel !== wb.displayLabel ||
    wa.netSide !== wb.netSide ||
    wa.firstTradeTime !== wb.firstTradeTime ||
    wa.invYes !== wb.invYes ||
    wa.invNo !== wb.invNo ||
    wa.maxInvYes !== wb.maxInvYes ||
    wa.maxInvNo !== wb.maxInvNo ||
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
    wa.isSmart !== wb.isSmart ||
    wa.usdcIn !== wb.usdcIn ||
    wa.usdcOut !== wb.usdcOut ||
    wa.feeTotal !== wb.feeTotal ||
    wa.payout !== wb.payout ||
    wa.outcome !== wb.outcome ||
    wa.w !== wb.w ||
    wa.l !== wb.l ||
    wa.f !== wb.f
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
  rowActionsTipOpen = false,
  onDismissRowActionsTip,
  rowActionsAnchorRef,
  selectedWallet,
  onRowClick,
  hideStakeBar = false,
  showRank = true,
  variant = 'toxicFlow',
  rankStart = 0,
  pnlSortOrder,
  onPnlSortClick,
  swarmsChart,
  marketActiveUnixForChart = 0,
  marketDurationSecForChart = 0,
  swarmHighlightSlot = null,
  onSwarmRowHover,
}: {
  wallets: WalletPosition[] | null;
  label: string;
  totalStakedNetUsd?: number | null;
  onOpenWallet?: (wallet: string, netShares?: number) => void;
  shadeRowByStakedNet?: boolean;
  rowActionsTipOpen?: boolean;
  onDismissRowActionsTip?: () => void;
  rowActionsAnchorRef?: RefObject<HTMLTableCellElement>;
  selectedWallet?: string | null;
  onRowClick?: (wallet: string) => void;
  hideStakeBar?: boolean;
  showRank?: boolean;
  variant?: ToxicFlowTableVariant;
  rankStart?: number;
  pnlSortOrder?: 'asc' | 'desc';
  onPnlSortClick?: () => void;
  swarmsChart?: readonly ToxicFlowSwarm[];
  marketActiveUnixForChart?: number;
  marketDurationSecForChart?: number;
  swarmHighlightSlot?: number | null;
  onSwarmRowHover?: (wallet: string | null) => void;
}) {
  const tiltWhaleAmountUsd = useSyncExternalStore(
    subscribeTiltWhaleAmountUsd,
    readTiltWhaleAmountUsd,
    () => DEFAULT_TILT_WHALE_AMOUNT_USD,
  );
  const tiltNotifyApplies = useNotifyTiltAppliesToSelectedMarket();
  const tiltRowFlashEnabled = variant !== 'marketView' && tiltNotifyApplies;
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const swarmUpDownMarket = useMemo(() => marketIsUpDown(selectedMarket), [selectedMarket]);
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
    onDismissRowActionsTip?.();
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
  }, [onDismissRowActionsTip]);
  useEffect(() => {
    recordToxicFavouriteNicknamesFromRows(rows, favouriteWallets);
  }, [rows, favouriteWallets]);
  const toggleBellWallet = useCallback((addr: string) => {
    onDismissRowActionsTip?.();
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
  }, [onDismissRowActionsTip]);
  const toggleXWallet = useCallback((addr: string) => {
    onDismissRowActionsTip?.();
    const k = addr.trim().toLowerCase();
    if (!k) return;
    setXWallets((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      persistToxicXWallets(next);
      return next;
    });
  }, [onDismissRowActionsTip]);
  const { sumYUsd: cohortSumYUsd, sumNUsd: cohortSumNUsd } = useMemo(
    () => toxicCohortStakedNetSurplusHalves(rows),
    [rows],
  );
  const cohortStakeBarTotal = cohortSumYUsd + cohortSumNUsd;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [virtRange, setVirtRange] = useState(() => ({ start: 0, end: rows.length }));
  const tableColSpan = toxicTableColCount(!!showRank, variant);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => {
      const scrollTop = el.scrollTop;
      const viewportH = el.clientHeight || 0;
      const start = Math.max(0, Math.floor(scrollTop / TOXIC_WALLET_ROW_PX) - TOXIC_VIRTUAL_OVERSCAN);
      const end = Math.min(
        rows.length,
        Math.ceil((scrollTop + viewportH) / TOXIC_WALLET_ROW_PX) + TOXIC_VIRTUAL_OVERSCAN,
      );
      setVirtRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, [rows.length]);

  useEffect(() => {
    setVirtRange((prev) => {
      const end = Math.min(rows.length, Math.max(prev.end, TOXIC_VIRTUAL_OVERSCAN * 2));
      return { start: 0, end };
    });
  }, [rows.length]);

  const virtTopPad = virtRange.start * TOXIC_WALLET_ROW_PX;
  const virtBottomPad = Math.max(0, (rows.length - virtRange.end) * TOXIC_WALLET_ROW_PX);

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center text-gray-500 text-[10px] py-3">
        No {label} data yet
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden w-full min-w-0">
      {!hideStakeBar ? (
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
            compactTotalStakeNetUsd={cohortStakeBarTotal > 0 ? cohortStakeBarTotal : null}
          />
        </div>
      ) : null}
      {variant === 'swarms' && swarmsChart && swarmsChart.length > 0 ? (
        <ToxicFlowSwarmsSlotChart
          swarms={swarmsChart}
          marketActiveUnix={marketActiveUnixForChart}
          marketDurationSec={marketDurationSecForChart}
          highlightSlot={swarmHighlightSlot}
        />
      ) : null}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto w-full min-w-0 overscroll-contain toxic-flow-scroll-stable"
      >
      <table className="w-full min-w-full whitespace-nowrap text-[10px]">
        <thead className="sticky top-0 z-[1] bg-gray-950">
          <tr className="text-gray-500 border-b border-gray-700">
            {showRank ? <th className={`align-middle py-1 pr-0 ${TOXIC_TABLE_RANK_COL_CLS}`}>#</th> : null}
            {variant !== 'swarms' ? (
              <th className={`align-middle py-1 text-left ${TOXIC_TABLE_FAV_COL_CLS}`} aria-label="Favourite, bell, and X mark" />
            ) : null}
            <th className="align-middle py-1 text-left px-1">{variant === 'swarms' ? 'Swarm' : 'Wallet'}</th>
            <th
              className="align-middle py-1 text-right px-1 bg-green-900/15"
              title={variant === 'marketView' ? 'max_inv_yes' : 'inv_yes'}
            >
              {variant === 'marketView' ? 'Max Y' : 'Inv Y'}
            </th>
            <th
              className="align-middle py-1 text-right px-1 bg-red-900/15 text-red-300"
              title={variant === 'marketView' ? 'max_inv_no' : 'inv_no'}
            >
              {variant === 'marketView' ? 'Max N' : 'Inv N'}
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
            <th
              className={`align-middle py-1 px-1 ${TOXIC_TABLE_STAKED_COL_CLS} ${
                variant === 'marketView' ? 'font-semibold text-red-300' : 'text-gray-300'
              }`}
              title={
                variant === 'marketView'
                  ? 'usdc_in'
                  : 'inv_yes > inv_no → (inv_yes−inv_no)×price_yes [Y]; else (inv_no−inv_yes)×price_no [N]; green = YES / red = NO'
              }
            >
              Staked
            </th>
            {variant !== 'marketView' && variant !== 'swarms' ? (
              <th
                className={`align-middle py-1 px-1 ${TOXIC_TABLE_STAKED_PCT_COL_CLS}`}
                title="|Staked| USD ÷ total market staked (Σ|signed net|)"
              >
                %
              </th>
            ) : null}
            {variant === 'marketView' ? (
              <>
                <th className="align-middle py-1 text-right px-1 whitespace-nowrap bg-gray-950" title="wallet_market_positions.payout">
                  Payout
                </th>
                <th
                  className={`align-middle py-1 text-right px-1 whitespace-nowrap bg-gray-950${onPnlSortClick ? ' cursor-pointer select-none hover:text-gray-300' : ''}`}
                  title="usdc_out − usdc_in − fee"
                  onClick={onPnlSortClick}
                >
                  PnL{pnlSortOrder ? (pnlSortOrder === 'desc' ? ' ▼' : ' ▲') : ''}
                </th>
                <th className="align-middle py-1 text-right px-1 whitespace-nowrap bg-gray-950" title="(usdc_out/(usdc_in+fee)) − 1">
                  ROI
                </th>
              </>
            ) : variant === 'swarms' ? (
              <>
                <th
                  className={`align-middle py-1 px-1 ${TOXIC_TABLE_STAKED_PCT_COL_CLS}`}
                  title="|Staked| USD ÷ total swarm staked"
                >
                  %
                </th>
                <th
                  className={`align-middle py-1 px-1 ${TOXIC_TABLE_STAKED_PCT_COL_CLS}`}
                  title="Running sum of % within swarm list"
                >
                  Cum%
                </th>
                <th className="align-middle py-1 text-right px-1">Bias</th>
              </>
            ) : (
              <>
                <th
                  className={`align-middle py-1 px-1 ${TOXIC_TABLE_STAKED_PCT_COL_CLS}`}
                  title="Running sum of % by table order (Staked / total staked)"
                >
                  Cum%
                </th>
                <th className="align-middle py-1 text-right px-1">Bias</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {virtTopPad > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={tableColSpan} style={{ height: virtTopPad, padding: 0, border: 'none' }} />
            </tr>
          ) : null}
          {rows.slice(virtRange.start, virtRange.end).map((w, vi) => {
            const i = virtRange.start + vi;
            const wk = (w.wallet || '').toLowerCase();
            const metrics = rowStakedMetrics[i] ?? { stakedPct: 0, cumStakedPct: 0 };
            return (
              <WalletTableBodyRow
                key={w.wallet}
                rank={rankStart + i + 1}
                w={w}
                shadeRowByStakedNet={!!shadeRowByStakedNet}
                favouriteActive={favouriteWallets.has(wk)}
                bellActive={bellWallets.has(wk)}
                xActive={xWallets.has(wk)}
                toggleFavouriteWallet={toggleFavouriteWallet}
                toggleBellWallet={toggleBellWallet}
                toggleXWallet={toggleXWallet}
                tiltWhaleAmountUsd={tiltWhaleAmountUsd}
                tiltRowFlashEnabled={tiltRowFlashEnabled}
                onOpenWallet={onOpenWallet}
                stakedPct={metrics.stakedPct}
                cumStakedPct={metrics.cumStakedPct}
                favColRef={i === 0 ? rowActionsAnchorRef : undefined}
                selectedWallet={selectedWallet}
                onRowClick={onRowClick}
                showRank={showRank}
                variant={variant}
                swarmUpDownMarket={variant === 'swarms' ? swarmUpDownMarket : false}
                onSwarmRowHover={variant === 'swarms' ? onSwarmRowHover : undefined}
              />
            );
          })}
          {virtBottomPad > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={tableColSpan} style={{ height: virtBottomPad, padding: 0, border: 'none' }} />
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>
      {rowActionsAnchorRef && onDismissRowActionsTip ? (
        <ToxicFlowRowActionsTip
          anchorRef={rowActionsAnchorRef}
          open={rowActionsTipOpen}
          onDismiss={onDismissRowActionsTip}
        />
      ) : null}
    </div>
  );
}

const WalletTable = memo(WalletTableInner, (a, b) => {
  if (
    a.label !== b.label ||
    a.onOpenWallet !== b.onOpenWallet ||
    a.shadeRowByStakedNet !== b.shadeRowByStakedNet ||
    a.totalStakedNetUsd !== b.totalStakedNetUsd ||
    a.rowActionsTipOpen !== b.rowActionsTipOpen ||
    a.onDismissRowActionsTip !== b.onDismissRowActionsTip ||
    a.rowActionsAnchorRef !== b.rowActionsAnchorRef ||
    a.selectedWallet !== b.selectedWallet ||
    a.onRowClick !== b.onRowClick ||
    a.hideStakeBar !== b.hideStakeBar ||
    a.showRank !== b.showRank ||
    a.variant !== b.variant ||
    a.rankStart !== b.rankStart ||
    a.pnlSortOrder !== b.pnlSortOrder ||
    a.onPnlSortClick !== b.onPnlSortClick ||
    a.marketActiveUnixForChart !== b.marketActiveUnixForChart ||
    a.marketDurationSecForChart !== b.marketDurationSecForChart ||
    a.swarmHighlightSlot !== b.swarmHighlightSlot ||
    a.onSwarmRowHover !== b.onSwarmRowHover
  ) {
    return false;
  }
  const sa = a.swarmsChart;
  const sb = b.swarmsChart;
  if (sa !== sb) {
    if (sa == null || sb == null) return sa === sb;
    if (sa.length !== sb.length) return false;
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] !== sb[i]) return false;
    }
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

export type ToxicFlowWalletTableProps = {
  wallets: WalletPosition[] | null;
  label: string;
  totalStakedNetUsd?: number | null;
  onOpenWallet?: (wallet: string, netShares?: number) => void;
  shadeRowByStakedNet?: boolean;
  rowActionsTipOpen?: boolean;
  onDismissRowActionsTip?: () => void;
  rowActionsAnchorRef?: RefObject<HTMLTableCellElement>;
  selectedWallet?: string | null;
  onRowClick?: (wallet: string) => void;
  hideStakeBar?: boolean;
  showRank?: boolean;
  variant?: ToxicFlowTableVariant;
  rankStart?: number;
  pnlSortOrder?: 'asc' | 'desc';
  onPnlSortClick?: () => void;
  swarmsChart?: readonly ToxicFlowSwarm[];
  marketActiveUnixForChart?: number;
  marketDurationSecForChart?: number;
  swarmHighlightSlot?: number | null;
  onSwarmRowHover?: (wallet: string | null) => void;
};

export const ToxicFlowWalletTable = WalletTable;
