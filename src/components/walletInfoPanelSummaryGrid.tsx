import type { ReactNode } from 'react';
import type { WalletSummary, WalletScoresLedgerEmbed } from '../api';
import { HelperTooltip } from './HelperTooltip';
import { ledgerWinRateFracFromStored } from '../lib/toxicFlowStakeCohort';

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

function rPnlToneClass(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return 'text-gray-400';
  return v > 0 ? 'text-green-400' : 'text-red-400';
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

export function WalletScoresLedgerSummaryGrid({
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

export function polymarketNicknameTrim(n?: string | null): string {
  return (n ?? '').trim();
}

export function polymarketNicknameFromEmbed(embed?: WalletScoresLedgerEmbed | null): string {
  return polymarketNicknameTrim(embed?.polymarketNickname);
}

export function shortenWallet(w: string): string {
  if (w.length <= 12) return w;
  return w.slice(0, 6) + '…' + w.slice(-4);
}
