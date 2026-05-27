import type { OnchainFillRow } from '../api';
import type { Market } from '../types';
import type { WSTrade } from '../hooks/useOnchainTradesWS';

export const WALLET_TRADE_PENDING_ROW_BG = 'bg-sky-500/10';

export function isLedgerFillRow(f: OnchainFillRow): boolean {
  return f.fillSource === 'wallet_fill_ledger';
}

export function wsTradeToFillRow(t: WSTrade, wallet: string, marketId: string): OnchainFillRow {
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
    pending: t.pending === true,
    pendingId: t.pending ? t.id : undefined,
    priceApproximate: t.priceApproximate === true,
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

export function fillOutcomeDisplay(
  f: OnchainFillRow,
  mk: Market | Record<string, unknown>,
): { text: string; tone: 'yes' | 'no' | 'muted' } {
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

export function fmtIntEn(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

export function fmtUsd2En(absVal: number): string {
  if (!Number.isFinite(absVal)) return '—';
  return absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function walletInfoFeeLabel(fee: number | undefined | null): string {
  const feeN = Number(fee);
  if (!Number.isFinite(feeN)) return '—';
  if (feeN <= 0) return `$${fmtUsd2En(0)}`;
  return `-$${fmtUsd2En(feeN)}`;
}

export function walletInfoFeeClass(fee: number | undefined | null): string {
  const feeN = Number(fee);
  if (Number.isFinite(feeN) && feeN > 0) return 'text-right text-red-400 tabular-nums';
  return 'text-right text-gray-500 tabular-nums';
}
