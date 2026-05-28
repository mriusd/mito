import type { WalletScoresLedgerEmbed, WalletSummary } from '../api';
import { ledgerWinRateFracFromStored, toxicRowResolvedStatsLow } from './toxicFlowStakeCohort';

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

export function ledgerGoldFromEmbed(embed: WalletScoresLedgerEmbed | null | undefined): boolean {
  if (embed == null) return false;
  if ((embed.resolvedMarkets ?? 0) < 10) return false;
  if (typeof embed.winRate !== 'number' || !Number.isFinite(embed.winRate)) return false;
  if (ledgerWinRateFracFromStored(embed.winRate) <= 0.5) return false;
  const pnl = embed.pnl;
  return typeof pnl === 'number' && Number.isFinite(pnl) && pnl > 0;
}

export function ledgerGoldFromSummary(summary: WalletSummary | null | undefined): boolean {
  if (summary == null) return false;
  if ((summary.resolvedMarkets ?? 0) < 10) return false;
  if (typeof summary.winRate !== 'number' || !Number.isFinite(summary.winRate)) return false;
  if (ledgerWinRateFracFromStored(summary.winRate) <= 0.5) return false;
  return typeof summary.pnl === 'number' && Number.isFinite(summary.pnl) && summary.pnl > 0;
}

const LEDGER_HIGH_WIN_RATE_MIN_FRAC = 0.75;
const LEDGER_HIGH_WIN_RATE_MIN_RESOLVED = 10;

/** Toxic-flow pink glow: ledger WR ≥ 75% with ≥10 resolved markets. */
export function ledgerHighWinRateFromEmbed(embed: WalletScoresLedgerEmbed | null | undefined): boolean {
  if (embed == null) return false;
  if ((embed.resolvedMarkets ?? 0) < LEDGER_HIGH_WIN_RATE_MIN_RESOLVED) return false;
  if (typeof embed.winRate !== 'number' || !Number.isFinite(embed.winRate)) return false;
  return ledgerWinRateFracFromStored(embed.winRate) >= LEDGER_HIGH_WIN_RATE_MIN_FRAC;
}

export function ledgerHighWinRateFromSummary(summary: WalletSummary | null | undefined): boolean {
  if (summary == null) return false;
  if ((summary.resolvedMarkets ?? 0) < LEDGER_HIGH_WIN_RATE_MIN_RESOLVED) return false;
  if (typeof summary.winRate !== 'number' || !Number.isFinite(summary.winRate)) return false;
  return ledgerWinRateFracFromStored(summary.winRate) >= LEDGER_HIGH_WIN_RATE_MIN_FRAC;
}

export function ledgerHighWinRateFromLedgerInput(
  ledgerEmbed: WalletScoresLedgerEmbed | null | undefined,
  summary: WalletSummary | null | undefined,
): boolean {
  if (ledgerEmbed !== undefined && ledgerEmbed !== null) return ledgerHighWinRateFromEmbed(ledgerEmbed);
  if (summary !== undefined && summary !== null) return ledgerHighWinRateFromSummary(summary);
  return false;
}

export const TOXIC_FLOW_HIGH_WIN_RATE_ADDR_CLASS = 'text-pink-400 toxic-flow-wallet-high-wr-glow';

/** Toxic-flow wallet column colors (blue / amber / green / red / zinc). */
export function walletAddressColorClass(input: {
  ledgerEmbed?: WalletScoresLedgerEmbed | null;
  summary?: WalletSummary | null;
  isSmart?: boolean;
  ledgerGold?: boolean;
}): string {
  const { ledgerEmbed, summary, isSmart, ledgerGold: ledgerGoldOverride } = input;
  const lifetimeHue = lifetimeLedgerPnlHue(ledgerEmbed, summary);
  const ledgerAbsent = walletScoresLedgerRowAbsent(ledgerEmbed, summary);
  const resolvedLowEmbed = toxicRowResolvedStatsLow(ledgerEmbed);
  const resolvedLowSummary =
    ledgerEmbed === undefined &&
    summary !== undefined &&
    summary !== null &&
    (summary.resolvedMarkets ?? 0) < 10;
  const resolvedStatsLow = resolvedLowEmbed || resolvedLowSummary;
  const ledgerGold =
    ledgerGoldOverride ??
    (ledgerEmbed != null ? ledgerGoldFromEmbed(ledgerEmbed) : ledgerGoldFromSummary(summary));
  const smartGoldAddr = !ledgerAbsent && !resolvedStatsLow && (ledgerGold || isSmart);
  const highWinRateAddr =
    !ledgerAbsent && !resolvedStatsLow && ledgerHighWinRateFromLedgerInput(ledgerEmbed, summary);
  if (resolvedStatsLow || ledgerAbsent) return 'text-blue-400';
  if (highWinRateAddr) return TOXIC_FLOW_HIGH_WIN_RATE_ADDR_CLASS;
  if (smartGoldAddr) return 'text-amber-400';
  if (lifetimeHue === 'pos') return 'text-green-400';
  if (lifetimeHue === 'neg') return 'text-red-400';
  return 'text-zinc-400';
}

export function isSmartGoldTrader(row: { isSmart?: boolean; cashFlow?: number | null } | null | undefined): boolean {
  if (!row?.isSmart) return false;
  const c = row.cashFlow;
  const n = typeof c === 'number' && Number.isFinite(c) ? c : 0;
  return n >= -1e-6;
}
