/** Read fee USDC from mito REST/WS rows (camel, snake, feesPaid). */

export function numberOrZero(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function tradeFeeUsd(row: Record<string, unknown> | null | undefined): number {
  if (!row) return 0;
  const n =
    numberOrZero(row.fee) ||
    numberOrZero(row.fees) ||
    numberOrZero(row.feesPaid) ||
    numberOrZero(row.feeUsdc) ||
    numberOrZero(row.fee_usdc) ||
    numberOrZero(row.fees_paid);
  return n > 0 ? n : 0;
}

export function walletRowFeeTotal(row: Record<string, unknown> | null | undefined): number {
  if (!row) return 0;
  const n =
    numberOrZero(row.feeTotal) ||
    numberOrZero(row.fee_total) ||
    numberOrZero(row.fees) ||
    numberOrZero(row.feesPaid) ||
    numberOrZero(row.fees_paid);
  return n > 0 ? n : 0;
}
