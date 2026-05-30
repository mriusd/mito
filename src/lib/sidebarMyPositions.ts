import type { Market, Position, Trade } from '../types';
import type { WalletPosition } from '../api';
import { normalizeClobTokenId, getPositionClobTokenId, outcomeTokenBelongsToSelectedMarket } from '../utils/format';
import type { WSPosition } from '../hooks/useOnchainTradesWS';
import { marketConditionKeysEqual } from './toxicFlowWs';

export const SIDEBAR_POSITION_DUST_SIZE = 0.01;

export function isSidebarDustPosition(size: number): boolean {
  return !Number.isFinite(size) || size < SIDEBAR_POSITION_DUST_SIZE;
}

export function mergeSidebarPositionsWsRest(
  restMarket: Position[],
  wsMarketRows: { tokenId: string; size: number; avgPrice: number }[],
): { asset: string; size: number; avgPrice: number }[] {
  const byTok = new Map<string, { asset: string; size: number; avgPrice: number }>();
  for (const p of restMarket) {
    const key = normalizeClobTokenId(getPositionClobTokenId(p));
    if (!key) continue;
    byTok.set(key, {
      asset: String(p.asset || '').trim() || key,
      size: p.size || 0,
      avgPrice: p.avgPrice || 0,
    });
  }
  for (const row of wsMarketRows) {
    const key = normalizeClobTokenId(row.tokenId);
    if (!key) continue;
    const prev = byTok.get(key);
    const avgPrice = prev?.avgPrice && prev.avgPrice > 0 ? prev.avgPrice : row.avgPrice > 0 ? row.avgPrice : 0;
    byTok.set(key, {
      asset: row.tokenId.trim() || prev?.asset || key,
      size: row.size,
      avgPrice,
    });
  }
  return [...byTok.values()];
}

/** Match sidebar merge for a single outcome token (pair legs, etc.). WS = live size; REST avg beats WS avg. */
export function resolveLegPositionForToken(
  tokenId: string,
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
): { size: number; avgPrice: number; feesPaid?: number } | null {
  const tidKey = normalizeClobTokenId(tokenId);
  if (!tidKey) return null;

  const rest = positions.find((p) => normalizeClobTokenId(getPositionClobTokenId(p)) === tidKey);
  let size = 0;
  let restAvg = 0;
  if (rest) {
    if ((rest.size || 0) > 0) size = rest.size || 0;
    if (rest.avgPrice != null && rest.avgPrice > 0) restAvg = rest.avgPrice;
  }

  let wsAvg = 0;
  let wsFees: number | undefined;
  if (liveTradesSource === 'onchain') {
    const ws = onchainWsPositions.find((p) => normalizeClobTokenId(p.tokenId) === tidKey);
    if (ws && ws.size > 0) {
      size = ws.size;
      if (ws.avgPrice > 0) wsAvg = ws.avgPrice;
      if (ws.feesPaid != null && Number.isFinite(ws.feesPaid)) wsFees = ws.feesPaid;
    }
  }

  if (isSidebarDustPosition(size)) return null;

  let avgPrice = restAvg > 0 ? restAvg : wsAvg;
  if (avgPrice <= 0 && restAvg > 0) avgPrice = restAvg;
  if (avgPrice <= 0 && wsAvg > 0) avgPrice = wsAvg;

  return { size, avgPrice, feesPaid: wsFees };
}

function legFeesFromHistoryRow(
  feeTotal: number,
  invY: number,
  invN: number,
  prY: number,
  prN: number,
  yesLeg: boolean,
): number {
  if (!Number.isFinite(feeTotal) || feeTotal <= 0) return 0;
  const hasY = Math.abs(invY) > 1e-9;
  const hasN = Math.abs(invN) > 1e-9;
  if (yesLeg) {
    if (!hasY) return 0;
    if (!hasN) return feeTotal;
  } else {
    if (!hasN) return 0;
    if (!hasY) return feeTotal;
  }
  const stakeY = Math.abs(invY * prY);
  const stakeN = Math.abs(invN * prN);
  const tot = stakeY + stakeN;
  if (tot <= 1e-18) return feeTotal * 0.5;
  return yesLeg ? feeTotal * (stakeY / tot) : feeTotal * (stakeN / tot);
}

/** Per-outcome leg from walletHistory WS row (same source as History panel). */
export function resolveLegPositionFromWalletHistory(
  tokenId: string,
  market: Market | null,
  history: WalletPosition[],
): { size: number; avgPrice: number; feesPaid?: number } | null {
  if (!market) return null;
  const mid = String(market.conditionId ?? market.id ?? '').trim();
  if (!mid) return null;
  const row = history.find((h) => marketConditionKeysEqual(String(h.marketId || ''), mid));
  if (!row) return null;

  const tidKey = normalizeClobTokenId(tokenId);
  if (!tidKey) return null;
  const yesTok = normalizeClobTokenId(row.tokenIdYes || market.clobTokenIds?.[0] || '');
  const noTok = normalizeClobTokenId(row.tokenIdNo || market.clobTokenIds?.[1] || '');
  const invY = Number(row.invYes ?? 0);
  const invN = Number(row.invNo ?? 0);
  const prY = Number(row.priceYes ?? 0);
  const prN = Number(row.priceNo ?? 0);
  const feeTotal = Number(row.feeTotal ?? 0);

  if (tidKey === yesTok && !isSidebarDustPosition(invY)) {
    return {
      size: invY,
      avgPrice: prY > 0 ? prY : 0,
      feesPaid: legFeesFromHistoryRow(feeTotal, invY, invN, prY, prN, true),
    };
  }
  if (tidKey === noTok && !isSidebarDustPosition(invN)) {
    return {
      size: invN,
      avgPrice: prN > 0 ? prN : 0,
      feesPaid: legFeesFromHistoryRow(feeTotal, invY, invN, prY, prN, false),
    };
  }
  return null;
}

/** Σ ledger/API fees for one outcome token (pair leg fees column). */
export function resolveFeesPaidForToken(
  tokenId: string,
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
  trades: Trade[] = [],
): number | null {
  const tidKey = normalizeClobTokenId(tokenId);
  if (!tidKey) return null;
  if (liveTradesSource === 'onchain') {
    const ws = onchainWsPositions.find((p) => normalizeClobTokenId(p.tokenId) === tidKey);
    if (ws && ws.feesPaid != null && Number.isFinite(ws.feesPaid)) return ws.feesPaid;
  }
  let sum = 0;
  let matched = false;
  for (const t of trades) {
    const tKey = normalizeClobTokenId(t.asset || t.asset_id || t.token_id || '');
    if (tKey !== tidKey) continue;
    matched = true;
    const f = parseFloat(t.fee || '0');
    if (Number.isFinite(f) && f > 0) sum += f;
  }
  if (liveTradesSource !== 'onchain' || matched) return sum;
  return null;
}

export function computeSidebarMyPositions(
  liveTradesSource: string,
  positions: Position[],
  selectedMarket: Market | null,
  marketLookup: Record<string, Market>,
  onchainWsPositions: WSPosition[],
): { asset: string; size: number; avgPrice: number }[] {
  if (!selectedMarket) return [];
  const wsMarketRows = (liveTradesSource === 'onchain' ? onchainWsPositions : [])
    .filter((p) => outcomeTokenBelongsToSelectedMarket(p.tokenId, selectedMarket, marketLookup))
    .map((p) => ({ tokenId: p.tokenId, size: p.size, avgPrice: p.avgPrice }));
  const restMarket = positions.filter((p) =>
    outcomeTokenBelongsToSelectedMarket(getPositionClobTokenId(p), selectedMarket, marketLookup),
  );
  return mergeSidebarPositionsWsRest(restMarket, wsMarketRows);
}

export type SidebarMergeEligible = {
  showButton: boolean;
  canOpenDialog: boolean;
  maxMerge: number;
  conditionId: string;
};

export function computeSidebarMergeEligible(
  selectedMarket: Market | null,
  myPositions: { asset: string; size: number; avgPrice: number }[],
  mergeFunderWallet: string,
): SidebarMergeEligible {
  if (!selectedMarket?.clobTokenIds || selectedMarket.clobTokenIds.length < 2) {
    return { showButton: false, canOpenDialog: false, maxMerge: 0, conditionId: '' };
  }
  const yesT = selectedMarket.clobTokenIds[0] || '';
  const noT = selectedMarket.clobTokenIds[1] || '';
  const yesP = myPositions.find((p) => (p.asset || '').trim() === yesT);
  const noP = myPositions.find((p) => (p.asset || '').trim() === noT);
  const yesSz = yesP?.size || 0;
  const noSz = noP?.size || 0;
  if (yesSz <= 0 || noSz <= 0) {
    return { showButton: false, canOpenDialog: false, maxMerge: 0, conditionId: '' };
  }
  let conditionId = (selectedMarket.conditionId || '').trim();
  if (!conditionId && yesP && typeof (yesP as { conditionId?: string }).conditionId === 'string') {
    conditionId = String((yesP as { conditionId?: string }).conditionId).trim();
  }
  const maxMerge = Math.min(yesSz, noSz);
  const canOpenDialog = Boolean(conditionId && mergeFunderWallet.trim());
  return { showButton: true, canOpenDialog, maxMerge, conditionId };
}
