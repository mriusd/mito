import type { WalletPosition } from '../api';
import type { Market } from '../types';
import { buildMarketByIdRecord } from '../components/WalletLatestMarketsTradedTable';

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
