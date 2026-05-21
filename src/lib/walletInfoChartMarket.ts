import type { WalletPosition } from '../api';
import type { Market } from '../types';
import { buildMarketByIdRecord } from '../components/WalletLatestMarketsTradedTable';

function marketIsUpDown(market: { question?: string; eventSlug?: string } | null | undefined): boolean {
  return !!(market?.question?.match(/up\s+or\s+down/i) || market?.eventSlug?.match(/up-or-down|updown/i));
}

function upDownStartTimeFromMarket(market: Market): number {
  if (!marketIsUpDown(market) || !market.endDate) return 0;
  const endMs = new Date(market.endDate).getTime();
  if (Number.isNaN(endMs)) return 0;
  const combined = `${market.eventSlug || ''} ${market.question || ''}`;
  let intervalMs = 60 * 60 * 1000;
  if (combined.match(/updown-5m/i) || combined.match(/\b5[- ]?min/i)) intervalMs = 5 * 60 * 1000;
  else if (combined.match(/updown-15m/i) || combined.match(/\b15[- ]?min/i)) intervalMs = 15 * 60 * 1000;
  else if (combined.match(/updown-4h/i) || combined.match(/\b4[- ]?h/i)) intervalMs = 4 * 60 * 60 * 1000;
  else if (combined.match(/up-or-down-on-/i) || combined.match(/\b24[- ]?h/i)) intervalMs = 24 * 60 * 60 * 1000;
  return endMs - intervalMs;
}

function tradeTimeMs(t: number | undefined | null): number | null {
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return null;
  return t < 1e12 ? t * 1000 : t;
}

/** Merge ledger position end dates + labels into marketById for wallet-info charts. */
export function enrichMarketByIdFromWalletPositions(
  marketLookup: Record<string, Market> | null | undefined,
  positions: WalletPosition[],
): Record<string, Market> {
  const byId = buildMarketByIdRecord(marketLookup);
  for (const pos of positions) {
    const mid = String(pos.marketId || '').trim();
    if (!mid) continue;
    const lc = mid.toLowerCase();
    const existing = byId[mid] || byId[lc];
    const merged: Market = {
      ...(existing || {
        id: mid,
        conditionId: mid,
        question: pos.question || pos.marketAsset || mid,
        eventSlug: pos.eventSlug,
        endDate: pos.endDate || '',
        clobTokenIds: [],
      }),
      id: mid,
      conditionId: existing?.conditionId || mid,
      question: existing?.question || pos.question || pos.marketAsset || mid,
      eventSlug: existing?.eventSlug || pos.eventSlug,
      endDate: existing?.endDate || pos.endDate || '',
    };
    byId[mid] = merged;
    byId[lc] = merged;
  }
  return byId;
}

/** Market metadata for wallet-info chart (outcome tokens resolved separately via backend). */
export function resolveWalletInfoChartMarket(
  selectedMarketId: string,
  marketById: Record<string, Market>,
  positions: WalletPosition[],
): Market | null {
  const raw = selectedMarketId.trim();
  if (!raw) return null;
  const lc = raw.toLowerCase();
  const pos = positions.find((row) => String(row.marketId || '').trim().toLowerCase() === lc);

  const mk = marketById[raw] || marketById[lc] || null;
  if (mk) return mk;
  if (!pos) return null;

  return {
    id: raw,
    conditionId: raw,
    question: pos.question || pos.marketAsset || raw,
    eventSlug: pos.eventSlug,
    endDate: pos.endDate || '',
    clobTokenIds: [],
  };
}

export function walletInfoChartMarketWithOutcomeTokens(
  market: Market | null,
  tokenIdYes: string,
  tokenIdNo: string,
): Market | null {
  const yes = tokenIdYes.trim();
  if (!market || !yes) return null;
  const no = tokenIdNo.trim();
  return {
    ...market,
    clobTokenIds: no ? [yes, no] : [yes],
  };
}

export function walletInfoChartTimeRange(
  market: Market,
  pos: WalletPosition | undefined,
): { startTime: number; endTime: number } {
  const upDownStart = upDownStartTimeFromMarket(market);
  const endFromMarket = market.endDate ? new Date(market.endDate).getTime() : NaN;
  const firstMs = tradeTimeMs(pos?.firstTradeTime);
  const lastMs = tradeTimeMs(pos?.lastTradeTime);

  let endTime = Number.isFinite(endFromMarket) ? endFromMarket : Date.now();
  if (lastMs != null) endTime = Math.max(endTime, lastMs);
  endTime += 60 * 60 * 1000;

  let startTime = upDownStart > 0 ? upDownStart : (firstMs ?? endTime - 30 * 24 * 60 * 60 * 1000);
  if (firstMs != null) startTime = Math.min(startTime, firstMs);
  if (startTime >= endTime) startTime = endTime - 7 * 24 * 60 * 60 * 1000;

  return { startTime, endTime };
}

export function resolveLiveTradeChartWindow(
  tokenId: string | undefined,
  startTime: number | undefined,
  endTime: number | undefined,
): { startMs: number; endMs: number } {
  const now = Date.now();
  let endMs = endTime && Number.isFinite(endTime) ? endTime : now + 60 * 60 * 1000;
  let startMs =
    startTime && Number.isFinite(startTime)
      ? startTime
      : endMs < now
        ? endMs - 30 * 24 * 60 * 60 * 1000
        : now - 24 * 60 * 60 * 1000;
  if (startMs >= endMs) startMs = endMs - 7 * 24 * 60 * 60 * 1000;
  void tokenId;
  return { startMs, endMs };
}
