import type { ToxicFlowData, WalletPosition } from '../api';
import type { Market } from '../types';
import { buildMarketByIdRecord } from '../components/WalletLatestMarketsTradedTable';
import { findToxicFlowWalletPosition, marketConditionKeysEqual } from './toxicFlowWs';

/** CLOB outcome tokens from a wallet ledger row (camelCase or snake_case). */
export function clobTokenIdsFromWalletPosition(
  pos: WalletPosition | null | undefined,
): string[] {
  if (!pos) return [];
  const row = pos as WalletPosition & { token_id_yes?: string; token_id_no?: string };
  const yes = String(row.tokenIdYes || row.token_id_yes || '').trim();
  if (!yes) return [];
  const no = String(row.tokenIdNo || row.token_id_no || '').trim();
  return no ? [yes, no] : [yes];
}

function preferClobTokenIds(...candidates: Array<string[] | undefined | null>): string[] {
  for (const c of candidates) {
    const yes = c?.[0]?.trim();
    if (yes) return c!.map((t) => String(t || '').trim()).filter(Boolean);
  }
  return [];
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
    const tokens = preferClobTokenIds(existing?.clobTokenIds, clobTokenIdsFromWalletPosition(pos));
    const merged: Market = {
      ...(existing || {
        id: mid,
        conditionId: mid,
        question: pos.question || pos.marketAsset || mid,
        eventSlug: pos.eventSlug,
        endDate: pos.endDate || '',
        clobTokenIds: tokens,
      }),
      id: mid,
      conditionId: existing?.conditionId || mid,
      question: existing?.question || pos.question || pos.marketAsset || mid,
      eventSlug: existing?.eventSlug || pos.eventSlug,
      endDate: existing?.endDate || pos.endDate || '',
      // Always prefer known tokens — store marketLookup often lacks clobTokenIds for
      // historical/expired markets, which left the wallet-info chart empty.
      clobTokenIds: tokens.length > 0 ? tokens : existing?.clobTokenIds || [],
    };
    byId[mid] = merged;
    byId[lc] = merged;
  }
  return byId;
}

/** Best-effort market end ms from ledger row (endDate, else last trade). */
export function walletPositionEndMs(pos: WalletPosition | null | undefined): number | undefined {
  if (!pos) return undefined;
  const raw = String(pos.endDate || '').trim();
  if (raw) {
    const t = Date.parse(raw);
    if (Number.isFinite(t) && t > 0) return t;
  }
  const lt = pos.lastTradeTime;
  if (typeof lt === 'number' && Number.isFinite(lt) && lt > 0) {
    return lt < 1e12 ? lt * 1000 : lt;
  }
  const ft = pos.firstTradeTime;
  if (typeof ft === 'number' && Number.isFinite(ft) && ft > 0) {
    return ft < 1e12 ? ft * 1000 : ft;
  }
  return undefined;
}

/** Market metadata for wallet-info chart (tokens from store, position, or later fetch). */
export function resolveWalletInfoChartMarket(
  selectedMarketId: string,
  marketById: Record<string, Market>,
  positions: WalletPosition[],
): Market | null {
  const raw = selectedMarketId.trim();
  if (!raw) return null;
  const lc = raw.toLowerCase();
  const pos =
    positions.find((row) => String(row.marketId || '').trim().toLowerCase() === lc) ??
    positions.find((row) => marketConditionKeysEqual(String(row.marketId || ''), raw)) ??
    null;

  const mk = marketById[raw] || marketById[lc] || null;
  const tokens = preferClobTokenIds(mk?.clobTokenIds, clobTokenIdsFromWalletPosition(pos));
  // Prefer ledger endDate; if missing, synthesize from lastTradeTime so history is
  // anchored on the trade window (older markets often lack joined markets.end_date).
  let endDate = String(mk?.endDate || pos?.endDate || '').trim();
  if (!endDate) {
    const endMs = walletPositionEndMs(pos);
    if (endMs) endDate = new Date(endMs).toISOString();
  }

  // Prefer a real question; if missing, seed with ticker so extractAssetFromMarket finds BTC/ETH.
  const assetHint = String(pos?.marketAsset || pos?.underlyingAsset || '').trim();
  const question =
    mk?.question ||
    pos?.question ||
    (assetHint ? `${assetHint} market` : '') ||
    mk?.question ||
    '';

  if (mk) {
    return {
      ...mk,
      clobTokenIds: tokens.length > 0 ? tokens : mk.clobTokenIds || [],
      question: question || mk.question,
      eventSlug: mk.eventSlug || pos?.eventSlug,
      endDate: endDate || mk.endDate || '',
      ...(assetHint && !mk.underlyingAsset
        ? { underlyingAsset: assetHint }
        : {}),
    };
  }
  if (!pos) return null;

  return {
    id: raw,
    conditionId: raw,
    question: question || pos.marketAsset || raw,
    eventSlug: pos.eventSlug,
    endDate,
    clobTokenIds: tokens,
    ...(assetHint ? { underlyingAsset: assetHint } : {}),
  };
}

/** Wallet position for selected market — toxic-flow WS row wins when same market. */
export function resolveWalletInfoMarketPosition(
  wallet: string,
  selectedMarketId: string,
  markets: WalletPosition[],
  toxicFlowData: ToxicFlowData | null | undefined,
  toxicFlowMarketId: string,
): WalletPosition | null {
  const raw = selectedMarketId.trim();
  if (!raw) return null;
  const toxicMkt = String(toxicFlowData?.marketId || toxicFlowMarketId || '').trim();
  if (toxicFlowData && toxicMkt && marketConditionKeysEqual(toxicMkt, raw)) {
    return findToxicFlowWalletPosition(toxicFlowData, wallet);
  }
  return (
    markets.find((row) => marketConditionKeysEqual(String(row.marketId || ''), raw)) ??
    markets.find((row) => String(row.marketId || '').trim().toLowerCase() === raw.toLowerCase()) ??
    null
  );
}

export function walletInfoChartMarketWithOutcomeTokens(
  market: Market | null,
  tokenIdYes: string,
  tokenIdNo: string,
): Market | null {
  if (!market) return null;
  const storeYes = market.clobTokenIds?.[0]?.trim() || '';
  const storeNo = market.clobTokenIds?.[1]?.trim() || '';
  const yes = tokenIdYes.trim() || storeYes;
  if (!yes) return null;
  const no = tokenIdNo.trim() || storeNo;
  // Always merge: ledger/store often only has YES — callers may still supply NO from fetch.
  if (storeYes === yes && storeNo === no) return market;
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
