/** Per-candle Polymarket trade CVD (polycandles candles.cvd / kline `cvd`). */
export type CvdCandleSnapshot = {
  /** "polymarket" for PM trade CVD; legacy "binance" may appear on old rows. */
  source?: string;
  asset?: string;
  tokenId?: string;
  updatedAt: number;
  bucketMs: number;
  /** Taker BUY notional (USDC) in this candle bucket. */
  buyUsd: number;
  /** Taker SELL notional (USDC) in this candle bucket. */
  sellUsd: number;
  deltaUsd: number;
  /** Running token CVD after this update. */
  cumDeltaUsd: number;
  tradeCount: number;
};

export function parseCvdCandleSnapshot(raw: unknown): CvdCandleSnapshot | undefined {
  if (raw == null || raw === '') return undefined;
  let o: Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  } else if (typeof raw === 'object') {
    o = raw as Record<string, unknown>;
  } else {
    return undefined;
  }
  const source = String(o.source || '').trim().toLowerCase() || undefined;
  const asset = String(o.asset || '').trim().toUpperCase() || undefined;
  const tokenId = String(o.tokenId || o.token_id || '').trim() || undefined;
  const updatedAt = Number(o.updatedAt);
  const bucketMs = Number(o.bucketMs);
  const buyUsd = Number(o.buyUsd);
  const sellUsd = Number(o.sellUsd);
  const deltaUsd = Number(o.deltaUsd);
  const cumDeltaUsd = Number(o.cumDeltaUsd);
  const tradeCount = Number(o.tradeCount);
  if (!asset && !tokenId && !Number.isFinite(cumDeltaUsd) && !Number.isFinite(buyUsd)) {
    return undefined;
  }
  if (!Number.isFinite(buyUsd) && !Number.isFinite(sellUsd) && !Number.isFinite(cumDeltaUsd)) {
    return undefined;
  }
  return {
    source,
    asset,
    tokenId,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    bucketMs: Number.isFinite(bucketMs) ? bucketMs : 0,
    buyUsd: Number.isFinite(buyUsd) ? buyUsd : 0,
    sellUsd: Number.isFinite(sellUsd) ? sellUsd : 0,
    deltaUsd: Number.isFinite(deltaUsd)
      ? deltaUsd
      : Number.isFinite(buyUsd) && Number.isFinite(sellUsd)
        ? buyUsd - sellUsd
        : 0,
    cumDeltaUsd: Number.isFinite(cumDeltaUsd) ? cumDeltaUsd : 0,
    tradeCount: Number.isFinite(tradeCount) ? tradeCount : 0,
  };
}
