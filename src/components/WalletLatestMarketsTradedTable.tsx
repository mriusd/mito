import { memo, type ReactNode } from 'react';
import type { WalletPosition } from '../api';
import type { Market } from '../types';
import {
  shortenUpDownMarketListCell,
  ASSET_COLORS,
  extractAssetFromMarket,
  assetTickerFromQuestion,
} from '../utils/format';

/** Condition id + legacy id map (same shape as Sidebar marketById). */
export function buildMarketByIdRecord(marketLookup: Record<string, Market> | null | undefined): Record<string, Market> {
  const m: Record<string, Market> = {};
  for (const mk of Object.values(marketLookup || {})) {
    if (!mk) continue;
    if (mk.id && !m[mk.id]) m[mk.id] = mk;
    const cid = (mk.conditionId || '').trim().toLowerCase();
    if (cid && !m[cid]) m[cid] = mk;
  }
  return m;
}

/** Same basis as Wallet Info Date column: market end, row update, last trade. */
export function walletPositionListSortMs(m: WalletPosition, marketById: Record<string, Market>): number {
  const parse = (s: string) => {
    const t = Date.parse(s);
    return Number.isNaN(t) ? 0 : t;
  };
  const raw = (m.endDate || '').trim();
  if (raw) {
    const t = parse(raw);
    if (t) return t;
  }
  const mk = marketById[m.marketId] || marketById[String(m.marketId || '').trim().toLowerCase()];
  const mkEnd = mk?.endDate != null ? String(mk.endDate).trim() : '';
  if (mkEnd) {
    const t = parse(mkEnd);
    if (t) return t;
  }
  const lu = (m.lastUpdated || '').trim();
  if (lu) {
    const t = parse(lu);
    if (t) return t;
  }
  const lt = m.lastTradeTime;
  if (typeof lt === 'number' && Number.isFinite(lt) && lt > 0) {
    return lt < 1e12 ? lt * 1000 : lt;
  }
  return 0;
}

export function sortWalletPositionsByDisplayedDateDesc(
  rows: WalletPosition[],
  marketById: Record<string, Market>,
): WalletPosition[] {
  return rows.filter((r): r is WalletPosition => r != null && Boolean(String(r.marketId || '').trim())).sort(
    (a, b) => walletPositionListSortMs(b, marketById) - walletPositionListSortMs(a, marketById),
  );
}

function walletInvY(w: WalletPosition): number {
  return typeof w.invYes === 'number' && Number.isFinite(w.invYes) ? w.invYes : (w.netYes ?? 0);
}
function walletInvN(w: WalletPosition): number {
  return typeof w.invNo === 'number' && Number.isFinite(w.invNo) ? w.invNo : (w.netNo ?? 0);
}
function walletNet(w: WalletPosition): number {
  return walletInvY(w) - walletInvN(w);
}

function fmtUsd2En(absVal: number): string {
  if (!Number.isFinite(absVal)) return '–';
  return absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUsdSignedLedger(v: number): string {
  if (!Number.isFinite(v)) return '–';
  const s = v >= 0 ? '+' : '−';
  const a = Math.abs(v);
  return `${s}$${a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtRoiPercent(roi: number | undefined): { text: string; tone: string } {
  if (roi == null || !Number.isFinite(roi)) return { text: '–', tone: 'text-gray-500' };
  const pct = roi * 100;
  const s = pct >= 0 ? '+' : '';
  const tone = Math.abs(roi) < 1e-12 ? 'text-gray-400' : roi > 0 ? 'text-green-400' : 'text-red-400';
  const txt = pct.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return { text: `${s}${txt}%`, tone };
}

function fmtWalletMarketRoiFromFlow(m: WalletPosition): { text: string; tone: string } {
  const usdcIn = typeof m.usdcIn === 'number' && Number.isFinite(m.usdcIn) ? m.usdcIn : 0;
  const usdcOut = typeof m.usdcOut === 'number' && Number.isFinite(m.usdcOut) ? m.usdcOut : 0;
  const fee = typeof m.feeTotal === 'number' && Number.isFinite(m.feeTotal) ? m.feeTotal : 0;
  const denom = usdcIn + fee;
  if (!(denom > 0)) return { text: '–', tone: 'text-gray-500' };
  return fmtRoiPercent(usdcOut / denom - 1);
}

function walletOutcomeLetterCell(m: WalletPosition) {
  const oc = m.outcome;
  if (oc !== 0 && oc !== 1) return <span className="text-gray-600">–</span>;
  const letter = oc === 1 ? 'Y' : 'N';
  let cls: string;
  if (m.w === 1) cls = 'font-bold text-green-400';
  else if (m.l === 1) cls = 'font-bold text-red-400';
  else if (m.f === 1) cls = 'font-bold text-gray-400';
  else cls = oc === 1 ? 'font-bold text-green-400' : 'font-bold text-red-400';
  return <span className={cls}>{letter}</span>;
}

/** Shared by this table and ToxicFlowDialog wallet cohort tables. */
export function fmtPriceShare(p: number | undefined): string {
  if (p == null || !Number.isFinite(p)) return '–';
  if (Math.abs(p) < 1e-12) return '-';
  return `${(p * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}¢`;
}

function rPnlToneClass(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return 'text-gray-400';
  return v > 0 ? 'text-green-400' : 'text-red-400';
}

function walletMarketUsdcInCell(usdcIn: number): ReactNode {
  if (!Number.isFinite(usdcIn) || usdcIn < 0) return <span className="text-gray-400">–</span>;
  const mag = fmtUsd2En(usdcIn);
  return <span className="tabular-nums font-semibold text-red-400">−${mag}</span>;
}

function fmtSharesIntEn(v: number): string {
  if (!Number.isFinite(v)) return '–';
  return Math.round(Math.abs(v)).toLocaleString('en-US');
}

function marketListEndDateTimeLocale(endDate: string | null): { label: string; color: string } {
  if (!endDate) return { label: '-', color: 'text-gray-400' };
  const dt = new Date(endDate);
  if (Number.isNaN(dt.getTime())) return { label: '-', color: 'text-gray-400' };
  const label = dt.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
  return { label, color: isWeekend ? 'text-purple-400' : 'text-gray-300' };
}

function walletMarketsRowsEqual(a: WalletPosition[], b: WalletPosition[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function walletMarketByIdEqual(a: Record<string, Market>, b: Record<string, Market>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

const WalletLatestMarketsTradedRow = memo(function WalletLatestMarketsTradedRow({
  m,
  mk,
  selected,
  onRowClick,
}: {
  m: WalletPosition;
  mk: Market | undefined;
  selected: boolean;
  onRowClick?: (marketId: string) => void;
}) {
  const qFromApi = (m.question || '').trim();
  const title = qFromApi || mk?.question || mk?.groupItemTitle;
  const endRaw = (m.endDate || '').trim() || (mk?.endDate ? String(mk.endDate).trim() : '');
  const marketName = title
    ? shortenUpDownMarketListCell(title, m.eventSlug || mk?.eventSlug || null, endRaw || null)
    : `${m.marketAsset || '-'} ${m.marketTimeframe || ''}`;
  const titleForAsset = (title || '').trim();
  const assetForColor =
    mk && typeof mk.question === 'string'
      ? extractAssetFromMarket(mk) || assetTickerFromQuestion(titleForAsset)
      : assetTickerFromQuestion(titleForAsset);
  const dd = marketListEndDateTimeLocale(endRaw || null);
  const iy = walletInvY(m);
  const inn = walletInvN(m);
  const netLeg = walletNet(m);
  const netMagStr = fmtSharesIntEn(netLeg);
  const netCol =
    Math.abs(netLeg) < 0.001 ? (
      <span className="text-gray-400">–</span>
    ) : netLeg > 0 ? (
      <span className="tabular-nums whitespace-nowrap font-bold text-green-400">{netMagStr} Y</span>
    ) : (
      <span className="tabular-nums whitespace-nowrap font-bold text-red-400">{netMagStr} N</span>
    );
  const rowUsdcIn = typeof m.usdcIn === 'number' && Number.isFinite(m.usdcIn) ? m.usdcIn : 0;
  const rowUsdcOut = typeof m.usdcOut === 'number' && Number.isFinite(m.usdcOut) ? m.usdcOut : 0;
  const rowFee = typeof m.feeTotal === 'number' && Number.isFinite(m.feeTotal) ? m.feeTotal : 0;
  const rowPnlFlow = rowUsdcOut - rowUsdcIn - rowFee;
  const rowPayout = typeof m.payout === 'number' && Number.isFinite(m.payout) ? m.payout : 0;
  const wlfSum = (m.w ?? 0) + (m.l ?? 0) + (m.f ?? 0);
  const payoutUnresolved = wlfSum === 0;
  const hasChainOutcome = m.outcome === 0 || m.outcome === 1;
  const roiFmt = hasChainOutcome ? fmtWalletMarketRoiFromFlow(m) : { text: '–', tone: 'text-gray-500' };
  const clickable = typeof onRowClick === 'function';

  return (
    <tr
      className={`border-b border-gray-800 ${clickable ? 'cursor-pointer hover:bg-gray-700/30' : ''} ${
        selected ? 'bg-gray-700/40' : ''
      }`}
      onClick={clickable ? () => onRowClick!(m.marketId) : undefined}
    >
      <td className={`py-0.5 whitespace-normal min-w-[10rem] ${dd.color}`}>{dd.label}</td>
      <td className="text-center py-0.5 align-middle whitespace-nowrap">{walletOutcomeLetterCell(m)}</td>
      <td
        className={`py-0.5 whitespace-nowrap font-bold ${ASSET_COLORS[assetForColor] || 'text-gray-200'}`}
        title={titleForAsset || undefined}
      >
        {marketName}
      </td>
      <td className="text-right tabular-nums font-bold text-green-400 bg-green-900/15 whitespace-nowrap">
        {fmtSharesIntEn(iy)}
      </td>
      <td className="text-right tabular-nums font-bold text-red-400 bg-red-900/15 whitespace-nowrap">
        {fmtSharesIntEn(inn)}
      </td>
      <td className="text-right whitespace-nowrap" title="Inv Y − Inv N">
        {netCol}
      </td>
      <td className="text-right text-yellow-400 tabular-nums whitespace-nowrap">{fmtPriceShare(m.priceYes)}</td>
      <td className="text-right text-yellow-400 tabular-nums whitespace-nowrap">{fmtPriceShare(m.priceNo)}</td>
      <td className="text-right tabular-nums whitespace-nowrap" title="usdc_in">
        {walletMarketUsdcInCell(rowUsdcIn)}
      </td>
      <td
        className={`text-right tabular-nums font-medium whitespace-nowrap ${rowFee === 0 ? 'text-gray-400' : 'text-red-400'}`}
        title="fee_total"
      >
        {rowFee === 0 ? `$${fmtUsd2En(0)}` : `−$${fmtUsd2En(rowFee)}`}
      </td>
      <td
        className={`text-right tabular-nums font-bold whitespace-nowrap ${payoutUnresolved ? 'text-gray-500' : rPnlToneClass(rowPayout)}`}
        title={payoutUnresolved ? 'Market not scored (W/L/F all zero)' : 'payout'}
      >
        {payoutUnresolved ? '-' : fmtUsdSignedLedger(rowPayout)}
      </td>
      <td className={`text-right tabular-nums font-bold whitespace-nowrap ${rPnlToneClass(rowPnlFlow)}`} title="usdc_out − usdc_in − fee">
        {fmtUsdSignedLedger(rowPnlFlow)}
      </td>
      <td
        className={`text-right tabular-nums font-bold whitespace-nowrap ${roiFmt.tone}`}
        title={hasChainOutcome ? '(usdc_out/(usdc_in+fee)) − 1' : 'ROI after market outcome is known'}
      >
        {roiFmt.text}
      </td>
    </tr>
  );
});

export const WalletLatestMarketsTradedTable = memo(function WalletLatestMarketsTradedTable({
  markets,
  marketById,
  loading,
  selectedMarketId,
  onRowClick,
  /** Wider px on every th/td (e.g. History panel). */
  horizontalCellPadding = false,
}: {
  markets: WalletPosition[];
  marketById: Record<string, Market>;
  loading: boolean;
  selectedMarketId?: string | null;
  onRowClick?: (marketId: string) => void;
  horizontalCellPadding?: boolean;
}) {
  const cellPad = horizontalCellPadding
    ? ' [&_th]:!px-2.5 [&_td]:!px-2.5 [&_th]:!py-1 [&_td]:!py-1'
    : '';
  const thead = (
    <thead>
      <tr className="text-gray-500 border-b border-gray-700">
        <th className="text-left py-1 whitespace-normal min-w-[10rem]">Date</th>
        <th className="text-center w-5 py-1 whitespace-nowrap" title="Resolved outcome (Y/N); color from ledger win/loss">
          O
        </th>
        <th className="text-left whitespace-nowrap">Market</th>
        <th className="text-right bg-green-900/15 text-green-300 font-bold py-1 whitespace-nowrap">Net Y</th>
        <th className="text-right bg-red-900/15 text-red-300 font-bold py-1 whitespace-nowrap">Net N</th>
        <th className="text-right whitespace-nowrap">Net</th>
        <th className="text-right whitespace-nowrap" title="price_yes">
          Px Y
        </th>
        <th className="text-right whitespace-nowrap" title="price_no">
          Px N
        </th>
        <th
          className="text-right whitespace-nowrap font-semibold text-red-300 py-1"
          title="wallet_market_positions.usdc_in — USDC spent (shown as −USDC)"
        >
          Staked
        </th>
        <th className="text-right whitespace-nowrap" title="wallet_market_positions.fee_total">
          Fee
        </th>
        <th className="text-right whitespace-nowrap" title="wallet_market_positions.payout">
          Payout
        </th>
        <th className="text-right whitespace-nowrap" title="usdc_out − usdc_in − fee">
          PnL
        </th>
        <th className="text-right whitespace-nowrap" title="(usdc_out/(usdc_in+fee)) − 1">
          ROI
        </th>
      </tr>
    </thead>
  );

  if (loading || markets.length === 0) {
    return (
      <div className="flex min-h-full flex-col">
        <table className={`w-full text-[10px] whitespace-nowrap shrink-0${cellPad}`}>
          {thead}
        </table>
        <div className="flex flex-1 min-h-0 items-center justify-center text-gray-500 text-[10px]">
          {loading ? 'Loading markets...' : 'No markets found.'}
        </div>
      </div>
    );
  }

  return (
    <table
      className={`w-full text-[10px] whitespace-nowrap${cellPad}`}
    >
      {thead}
      <tbody>
        {markets.filter((m) => m != null && String(m.marketId || '').trim()).map((m) => {
          const mk =
            marketById[m.marketId] ||
            marketById[(m.marketId || '').toLowerCase()] ||
            (m.question ? (m as unknown as Market) : undefined);
          return (
            <WalletLatestMarketsTradedRow
              key={`${m.marketId}-${m.wallet}`}
              m={m}
              mk={mk}
              selected={selectedMarketId === m.marketId}
              onRowClick={onRowClick}
            />
          );
        })}
      </tbody>
    </table>
  );
}, (a, b) =>
  a.loading === b.loading &&
  a.selectedMarketId === b.selectedMarketId &&
  a.onRowClick === b.onRowClick &&
  a.horizontalCellPadding === b.horizontalCellPadding &&
  walletMarketsRowsEqual(a.markets, b.markets) &&
  walletMarketByIdEqual(a.marketById, b.marketById));
