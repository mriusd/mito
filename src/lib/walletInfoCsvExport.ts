import type { OnchainFillRow, WalletPosition } from '../api';
import type { Market } from '../types';
import { buildMarketByIdRecord, walletPositionListSortMs } from '../components/WalletLatestMarketsTradedTable';
import { shortenUpDownMarketListCell } from '../utils/format';

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return '';
  if (typeof v === 'number' && !Number.isFinite(v)) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

export function downloadCsvFile(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function walletInvY(w: WalletPosition): number {
  return typeof w.invYes === 'number' && Number.isFinite(w.invYes) ? w.invYes : (w.netYes ?? 0);
}
function walletInvN(w: WalletPosition): number {
  return typeof w.invNo === 'number' && Number.isFinite(w.invNo) ? w.invNo : (w.netNo ?? 0);
}

function marketTitleForCsv(m: WalletPosition, marketById: Record<string, Market>): string {
  const mk =
    marketById[m.marketId] ||
    marketById[(m.marketId || '').toLowerCase()] ||
    (m.question ? (m as unknown as Market) : undefined);
  const qFromApi = (m.question || '').trim();
  const title = qFromApi || mk?.question || mk?.groupItemTitle;
  const endRaw = (m.endDate || '').trim() || (mk?.endDate ? String(mk.endDate).trim() : '');
  if (title) {
    return shortenUpDownMarketListCell(title, m.eventSlug || mk?.eventSlug || null, endRaw || null);
  }
  return `${m.marketAsset || '-'} ${m.marketTimeframe || ''}`.trim();
}

function marketDateIsoForCsv(m: WalletPosition, marketById: Record<string, Market>): string {
  const ms = walletPositionListSortMs(m, marketById);
  if (ms > 0) return new Date(ms).toISOString();
  const raw = (m.endDate || '').trim();
  if (raw) {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  return '';
}

export function walletMarketsTradedCsv(
  markets: WalletPosition[],
  marketById: Record<string, Market>,
): string {
  const headers = [
    'date_iso',
    'outcome',
    'market',
    'net_y',
    'net_n',
    'net',
    'price_yes',
    'price_no',
    'usdc_in',
    'fee_total',
    'payout',
    'pnl',
    'roi',
    'market_id',
  ];
  const rows = markets.map((m) => {
    const iy = walletInvY(m);
    const inn = walletInvN(m);
    const netLeg = iy - inn;
    const rowUsdcIn = typeof m.usdcIn === 'number' && Number.isFinite(m.usdcIn) ? m.usdcIn : 0;
    const rowUsdcOut = typeof m.usdcOut === 'number' && Number.isFinite(m.usdcOut) ? m.usdcOut : 0;
    const rowFee = typeof m.feeTotal === 'number' && Number.isFinite(m.feeTotal) ? m.feeTotal : 0;
    const rowPnlFlow = rowUsdcOut - rowUsdcIn - rowFee;
    const rowPayout = typeof m.payout === 'number' && Number.isFinite(m.payout) ? m.payout : 0;
    const wlfSum = (m.w ?? 0) + (m.l ?? 0) + (m.f ?? 0);
    const hasChainOutcome = m.outcome === 0 || m.outcome === 1;
    const denom = rowUsdcIn + rowFee;
    const roi = hasChainOutcome && denom > 0 ? rowUsdcOut / denom - 1 : '';
    const oc = m.outcome === 0 || m.outcome === 1 ? m.outcome : '';
    const py = typeof m.priceYes === 'number' && Number.isFinite(m.priceYes) ? m.priceYes : '';
    const pn = typeof m.priceNo === 'number' && Number.isFinite(m.priceNo) ? m.priceNo : '';
    return [
      marketDateIsoForCsv(m, marketById),
      oc,
      marketTitleForCsv(m, marketById),
      iy,
      inn,
      netLeg,
      py,
      pn,
      rowUsdcIn,
      rowFee,
      wlfSum === 0 ? '' : rowPayout,
      rowPnlFlow,
      roi,
      m.marketId,
    ];
  });
  return rowsToCsv([headers, ...rows]);
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

function isLedgerFillRow(f: OnchainFillRow): boolean {
  return f.fillSource === 'wallet_fill_ledger';
}

function isUpDownFromFill(mk: Market | undefined, f: OnchainFillRow): boolean {
  const mkType = mk && 'marketType' in mk ? String((mk as { marketType?: string }).marketType || '') : '';
  const blob = `${f.marketType || ''} ${mkType} ${mk?.question || ''} ${mk?.eventSlug || ''}`.toLowerCase();
  return /upordown|up-down|up\s*or\s*down|updown/.test(blob);
}

function fillSideText(f: OnchainFillRow, mk: Market | undefined): string {
  const upDown = isUpDownFromFill(mk, f);
  const yesLab = upDown ? 'UP' : 'YES';
  const noLab = upDown ? 'DOWN' : 'NO';
  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');
  const raw = String(f.side ?? '').trim();
  if (raw) {
    const u = norm(raw);
    if (u === 'YES' || u === 'Y' || u === 'UP') return yesLab;
    if (u === 'NO' || u === 'N' || u === 'DOWN') return noLab;
    return raw;
  }
  const tid = String(f.tokenId || '').trim();
  const yT = String(mk?.clobTokenIds?.[0] ?? '').trim();
  const nT = String(mk?.clobTokenIds?.[1] ?? '').trim();
  if (tid && yT && sameClobToken(tid, yT)) return yesLab;
  if (tid && nT && sameClobToken(tid, nT)) return noLab;
  return '';
}

function fillBlockTimeIso(f: OnchainFillRow): string {
  const bt = Number(f.blockTime ?? 0);
  if (!(bt > 0)) return '';
  const ms = bt > 1e12 ? bt : bt * 1000;
  return new Date(ms).toISOString();
}

export function walletFillsCsv(
  fills: OnchainFillRow[],
  wallet: string,
  marketById: Record<string, Market>,
  selectedMarketId: string,
): string {
  const headers = [
    'time_iso',
    'action',
    'side',
    'is_taker',
    'shares',
    'price',
    'usdc',
    'fee',
    'tx_hash',
    'log_index',
  ];
  const walletLower = wallet.toLowerCase();
  const rows = fills.map((f) => {
    const mid = String(f.marketId || '').trim().toLowerCase();
    const mk =
      marketById[selectedMarketId] ||
      (mid && marketById[mid]) ||
      undefined;

    if (isLedgerFillRow(f)) {
      const sz = Number(f.size);
      const pr = f.price;
      const priceFinite = pr != null && Number.isFinite(pr);
      const sizeFinite = Number.isFinite(sz);
      const usdc = priceFinite && sizeFinite ? pr * sz : NaN;
      const feeN = Number(f.fee);
      return [
        fillBlockTimeIso(f),
        String(f.action ?? '').trim(),
        String(f.side ?? '').trim(),
        f.isTaker === true ? 1 : 0,
        sizeFinite ? sz : '',
        priceFinite ? pr : '',
        Number.isFinite(usdc) ? usdc : '',
        Number.isFinite(feeN) ? feeN : '',
        f.txHash,
        f.logIndex,
      ];
    }

    const isSplitMerge = f.orderHash === 'SPLIT' || f.orderHash === 'MERGE';
    if (isSplitMerge) {
      const amount = Number(f.makerAmount ?? 0);
      const feeN = Number(f.fee ?? 0);
      return [
        fillBlockTimeIso(f),
        String(f.orderHash),
        '',
        f.isTaker === true ? 1 : 0,
        Number.isFinite(amount) ? amount : '',
        '',
        Number.isFinite(amount) ? amount : '',
        Number.isFinite(feeN) ? feeN : '',
        f.txHash,
        f.logIndex,
      ];
    }

    const isTaker = (f.taker || '').toLowerCase() === walletLower;
    const walletPaysUsdc = (isTaker && f.takerAssetId === '0') || (!isTaker && f.makerAssetId === '0');
    const wa = String(f.walletAccountSide || '').toUpperCase();
    const action = wa === 'BUY' || wa === 'SELL' ? wa : walletPaysUsdc ? 'BUY' : 'SELL';
    const shares = walletPaysUsdc
      ? isTaker
        ? f.makerAmount
        : f.takerAmount
      : isTaker
        ? f.takerAmount
        : f.makerAmount;
    const usdc = walletPaysUsdc
      ? isTaker
        ? f.takerAmount
        : f.makerAmount
      : isTaker
        ? f.makerAmount
        : f.takerAmount;
    const nShares = Number(shares);
    const nUsdc = Number(usdc);
    const pricePerShare =
      nShares > 1e-9 && Number.isFinite(nShares) && Number.isFinite(nUsdc) ? nUsdc / nShares : NaN;
    const feeN = Number(f.fee ?? 0);
    return [
      fillBlockTimeIso(f),
      action,
      fillSideText(f, mk),
      f.isTaker === true ? 1 : 0,
      Number.isFinite(nShares) ? nShares : '',
      Number.isFinite(pricePerShare) ? pricePerShare : '',
      Number.isFinite(nUsdc) ? nUsdc : '',
      Number.isFinite(feeN) ? feeN : '',
      f.txHash,
      f.logIndex,
    ];
  });
  return rowsToCsv([headers, ...rows]);
}

export function exportWalletMarketsCsv(
  wallet: string,
  markets: WalletPosition[],
  marketLookup: Record<string, Market>,
): void {
  const marketById = buildMarketByIdRecord(marketLookup);
  const csv = walletMarketsTradedCsv(markets, marketById);
  const short = wallet.trim().toLowerCase().slice(0, 10);
  downloadCsvFile(`wallet-${short}-markets.csv`, csv);
}

export function exportWalletFillsCsv(
  wallet: string,
  fills: OnchainFillRow[],
  marketLookup: Record<string, Market>,
  selectedMarketId: string,
): void {
  const marketById = buildMarketByIdRecord(marketLookup);
  const csv = walletFillsCsv(fills, wallet, marketById, selectedMarketId);
  const short = wallet.trim().toLowerCase().slice(0, 10);
  const mid = selectedMarketId.trim().toLowerCase().slice(0, 12);
  downloadCsvFile(`wallet-${short}-fills-${mid}.csv`, csv);
}
