/**
 * Toxic Flow “cohort surplus” stake math shared by ToxicFlowDialog sidebar strip and market Sidebar.
 */

import type { ToxicFlowCluster, ToxicFlowData, ToxicFlowSwarm, WalletPosition, WalletScoresLedgerEmbed, WalletSummary } from '../api';

export const TOXIC_SWARM_WALLET_PREFIX = '__swarm:';

export function isToxicFlowSwarmWallet(wallet: string): boolean {
  return (wallet || '').startsWith(TOXIC_SWARM_WALLET_PREFIX);
}

function toxicFlowSwarmIdFromWallet(wallet: string): number {
  const m = (wallet || '').match(/^__swarm:(\d+)__$/);
  return m ? parseInt(m[1], 10) : NaN;
}

const SWARM_SLOT_SEC = 5;

export function swarmMarketActiveUnixFromMeta(
  eventSlug?: string,
  endDate?: string,
  timeframe?: string,
): number {
  const blob = (eventSlug || '').toLowerCase();
  const m = blob.match(/updown-(5m|15m|4h)-(\d+)/);
  if (m) {
    const ts = parseInt(m[2], 10);
    if (Number.isFinite(ts) && ts > 0) return ts;
  }
  const endMs = endDate ? Date.parse(endDate) : NaN;
  if (!Number.isFinite(endMs) || endMs <= 0) return 0;
  let dur = 300;
  const tf = (timeframe || '').toLowerCase();
  if (tf === '15m') dur = 900;
  else if (tf === '1h') dur = 3600;
  else if (tf === '4h') dur = 14400;
  else if (tf === '24h') dur = 86400;
  return Math.floor(endMs / 1000) - dur;
}

/** Market window length in seconds (up/down slug/tf, else end − active). */
export function swarmMarketDurationSecFromMeta(
  eventSlug?: string,
  endDate?: string,
  timeframe?: string,
): number {
  const blob = (eventSlug || '').toLowerCase();
  const m = blob.match(/updown-(5m|15m|4h)-/);
  if (m) {
    if (m[1] === '5m') return 300;
    if (m[1] === '15m') return 900;
    if (m[1] === '4h') return 14400;
  }
  const tf = (timeframe || '').toLowerCase();
  if (tf === '5m') return 300;
  if (tf === '15m') return 900;
  if (tf === '1h') return 3600;
  if (tf === '4h') return 14400;
  if (tf === '24h') return 86400;
  const active = swarmMarketActiveUnixFromMeta(eventSlug, endDate, timeframe);
  const endMs = endDate ? Date.parse(endDate) : NaN;
  if (active > 0 && Number.isFinite(endMs) && endMs > 0) {
    return Math.max(SWARM_SLOT_SEC, Math.floor(endMs / 1000) - active);
  }
  return 300;
}

/** 5s time bucket from market active; any time before open → −1. */
export function toxicSwarmTimeSlot(startTime: number, marketActive: number): number {
  if (!Number.isFinite(startTime) || startTime <= 0) return 0;
  if (!Number.isFinite(marketActive) || marketActive <= 0) return 0;
  const rel = startTime - marketActive;
  if (rel < 0) return -1;
  return Math.trunc(rel / SWARM_SLOT_SEC);
}

function toxicSwarmDisplaySlotFromStart(startTime: number, marketActive: number, side: string): number {
  const slot = toxicSwarmTimeSlot(startTime, marketActive);
  if (slot < 0) return -1;
  if (side === 'NO' && slot === 0) return 1;
  return slot;
}

export type SwarmSlotChartPoint = {
  slot: number;
  yesUsd: number;
  noUsd: number;
};

function toxicSwarmWalletStub(s: ToxicFlowSwarm): WalletPosition {
  return {
    wallet: '',
    marketId: '',
    invYes: s.invYes ?? 0,
    invNo: s.invNo ?? 0,
    boughtYes: s.boughtYes ?? 0,
    soldYes: s.soldYes ?? 0,
    boughtNo: s.boughtNo ?? 0,
    soldNo: s.soldNo ?? 0,
    net: s.net ?? 0,
    netYes: s.netYes ?? 0,
    netNo: s.netNo ?? 0,
    usdcIn: s.usdcIn ?? 0,
    usdcOut: s.usdcOut ?? 0,
    pnl: 0,
    priceYes: s.priceYes,
    priceNo: s.priceNo,
    tradeCount: s.tradeCount ?? 0,
    firstTradeTime: s.startTime ?? 0,
    lastTradeTime: s.endTime ?? 0,
    marketAsset: '',
    marketType: '',
    marketTimeframe: '',
    netSide: s.side,
    inventoryBias: 0,
  };
}

export function toxicSwarmStakedSignedUsd(s: ToxicFlowSwarm): number {
  return walletStakeNetSignedUsd(toxicSwarmWalletStub(s));
}

export function toxicSwarmStakedAbsUsd(s: ToxicFlowSwarm): number {
  const signed = toxicSwarmStakedSignedUsd(s);
  return Number.isFinite(signed) ? Math.abs(signed) : NaN;
}

export type SwarmSlotChartLayout = {
  points: SwarmSlotChartPoint[];
  postSlotCount: number;
  showPreOpen: boolean;
};

/** Full market timeline (−1 pre-open + every 5s bucket); empty slots included. */
export function buildSwarmSlotChartLayout(
  swarms: readonly ToxicFlowSwarm[],
  marketActiveUnix: number,
  marketDurationSec: number,
): SwarmSlotChartLayout {
  const fullTimeline =
    marketActiveUnix > 0 && marketDurationSec > 0;
  const postSlotCount = fullTimeline
    ? Math.max(1, Math.ceil(marketDurationSec / SWARM_SLOT_SEC))
    : 0;
  const showPreOpen = fullTimeline;

  const bySlot = new Map<number, { yesUsd: number; noUsd: number }>();
  const touch = (slot: number) => {
    let row = bySlot.get(slot);
    if (!row) {
      row = { yesUsd: 0, noUsd: 0 };
      bySlot.set(slot, row);
    }
    return row;
  };

  if (fullTimeline) {
    touch(-1);
    for (let i = 0; i < postSlotCount; i++) touch(i);
  }

  for (const s of swarms) {
    const slot =
      marketActiveUnix > 0
        ? toxicSwarmTimeSlot(s.startTime, marketActiveUnix)
        : toxicSwarmDisplaySlot(s, marketActiveUnix);
    const signed = toxicSwarmStakedSignedUsd(s);
    if (!Number.isFinite(signed) || Math.abs(signed) <= STAKED_NET_EPS) continue;
    const usd = Math.abs(signed);
    const row = touch(slot);
    if (signed < -STAKED_NET_EPS) row.yesUsd += usd;
    else row.noUsd += usd;
  }

  const slotOrder: number[] = fullTimeline
    ? [-1, ...Array.from({ length: postSlotCount }, (_, i) => i)]
    : [...bySlot.keys()].sort((a, b) => a - b);

  const points = slotOrder.map((slot) => {
    const v = bySlot.get(slot) ?? { yesUsd: 0, noUsd: 0 };
    return { slot, yesUsd: v.yesUsd, noUsd: v.noUsd };
  });

  return { points, postSlotCount, showPreOpen };
}

export function toxicSwarmDisplaySlot(
  s: Pick<ToxicFlowSwarm, 'slotIndex' | 'swarmId' | 'startTime' | 'side'>,
  marketActive = 0,
): number {
  if (typeof s.slotIndex === 'number' && Number.isFinite(s.slotIndex)) return s.slotIndex;
  if (marketActive > 0) return toxicSwarmDisplaySlotFromStart(s.startTime, marketActive, s.side);
  return s.swarmId;
}

/** Map API swarms to WalletPosition rows for the standard toxic-flow table. */
export function toxicFlowSwarmsToWalletRows(
  swarms: readonly ToxicFlowSwarm[],
  marketId: string,
  marketActiveUnix = 0,
): WalletPosition[] {
  const rows: WalletPosition[] = [];
  for (const s of swarms) {
    const iy = s.invYes ?? 0;
    const inn = s.invNo ?? 0;
    const gross = Math.abs(iy) + Math.abs(inn);
    const signed = iy - inn;
    rows.push({
      wallet: `__swarm:${s.swarmId}__`,
      displayLabel: `Swarm #${toxicSwarmDisplaySlot(s, marketActiveUnix)} (${s.walletCount})`,
      marketId,
      invYes: iy,
      invNo: inn,
      boughtYes: s.boughtYes ?? 0,
      soldYes: s.soldYes ?? 0,
      boughtNo: s.boughtNo ?? 0,
      soldNo: s.soldNo ?? 0,
      net: s.net ?? signed,
      netYes: s.netYes ?? 0,
      netNo: s.netNo ?? 0,
      usdcIn: s.usdcIn ?? 0,
      usdcOut: s.usdcOut ?? 0,
      priceYes: s.priceYes,
      priceNo: s.priceNo,
      feeTotal: s.feeTotal ?? 0,
      tradeCount: s.tradeCount ?? 0,
      netSide: s.side,
      inventoryBias: gross > 0 ? Math.abs(signed) / gross : 0,
      pnl: 0,
      firstTradeTime: s.detectedAt ?? s.startTime ?? 0,
      lastTradeTime: s.endTime ?? 0,
      marketAsset: '',
      marketType: '',
      marketTimeframe: '',
    });
  }
  rows.sort((a, b) => {
    const da = Math.abs(walletStakeNetAbsUsd(a));
    const db = Math.abs(walletStakeNetAbsUsd(b));
    if (da !== db) return db - da;
    const idA = toxicFlowSwarmIdFromWallet(a.wallet);
    const idB = toxicFlowSwarmIdFromWallet(b.wallet);
    return (Number.isFinite(idA) ? idA : 0) - (Number.isFinite(idB) ? idB : 0);
  });
  return rows;
}

export function toxicFlowSwarmMembersByRowWallet(
  swarms: readonly ToxicFlowSwarm[],
  wallet: string,
): string[] {
  if (!isToxicFlowSwarmWallet(wallet)) return [];
  const id = toxicFlowSwarmIdFromWallet(wallet);
  if (!Number.isFinite(id)) return [];
  const s = swarms.find((x) => x.swarmId === id);
  return s?.members ?? [];
}

export function toxicFlowSwarmByRowWallet(
  swarms: readonly ToxicFlowSwarm[],
  wallet: string,
): ToxicFlowSwarm | null {
  if (!isToxicFlowSwarmWallet(wallet)) return null;
  const id = toxicFlowSwarmIdFromWallet(wallet);
  if (!Number.isFinite(id)) return null;
  return swarms.find((x) => x.swarmId === id) ?? null;
}
import { walletSummaryFromLedgerEmbed } from '../api';

/** Epsilon for treating signed staked-net as flat (table + cohort bar). */
export const STAKED_NET_EPS = 1e-6;

export function walletInvY(w: WalletPosition): number {
  return typeof w.invYes === 'number' && Number.isFinite(w.invYes) ? w.invYes : w.netYes ?? 0;
}
export function walletInvN(w: WalletPosition): number {
  return typeof w.invNo === 'number' && Number.isFinite(w.invNo) ? w.invNo : w.netNo ?? 0;
}

/** Net = Inv Y − Inv N (matches holders table). */
export function walletNet(w: WalletPosition): number {
  return walletInvY(w) - walletInvN(w);
}

export function walletStakeYUsd(w: WalletPosition): number {
  const iy = walletInvY(w);
  const py = typeof w.priceYes === 'number' && Number.isFinite(w.priceYes) ? w.priceYes : NaN;
  return Number.isFinite(py) ? iy * py : NaN;
}

export function walletStakeNUsd(w: WalletPosition): number {
  const inn = walletInvN(w);
  const pn = typeof w.priceNo === 'number' && Number.isFinite(w.priceNo) ? w.priceNo : NaN;
  return Number.isFinite(pn) ? inn * pn : NaN;
}

export function walletStakeTotalUsd(w: WalletPosition): number {
  const sy = walletStakeYUsd(w);
  const sn = walletStakeNUsd(w);
  if (!(Number.isFinite(sy) || Number.isFinite(sn))) return NaN;
  return (Number.isFinite(sy) ? sy : 0) + (Number.isFinite(sn) ? sn : 0);
}

/** Signed Staked Net (USD): YES lean negative, NO lean positive.
 *  |net| = (inv_yes − inv_no)×price_yes when inv_yes > inv_no, else (inv_no − inv_yes)×price_no. */
export function walletStakeNetSignedUsd(w: WalletPosition): number {
  const iy = walletInvY(w);
  const inn = walletInvN(w);
  if (iy > inn) {
    const py = typeof w.priceYes === 'number' && Number.isFinite(w.priceYes) ? w.priceYes : NaN;
    if (!Number.isFinite(py)) return NaN;
    return -((iy - inn) * py);
  }
  const delta = inn - iy;
  if (delta <= STAKED_NET_EPS) return 0;
  const pn = typeof w.priceNo === 'number' && Number.isFinite(w.priceNo) ? w.priceNo : NaN;
  if (!Number.isFinite(pn)) return NaN;
  return delta * pn;
}

export function walletStakeNetAbsUsd(w: WalletPosition): number {
  const s = walletStakeNetSignedUsd(w);
  return Number.isFinite(s) ? Math.abs(s) : NaN;
}

/** Chart outcome from inventory / staked lean for wallet info (YES if flat). */
export function walletDirectionalChartOutcome(w: WalletPosition | null | undefined): 'YES' | 'NO' {
  if (!w) return 'YES';
  const net = walletNet(w);
  if (net > STAKED_NET_EPS) return 'YES';
  if (net < -STAKED_NET_EPS) return 'NO';
  const sy = walletStakeYUsd(w);
  const sn = walletStakeNUsd(w);
  if (Number.isFinite(sy) && Number.isFinite(sn)) {
    if (sy > sn + STAKED_NET_EPS) return 'YES';
    if (sn > sy + STAKED_NET_EPS) return 'NO';
  }
  return 'YES';
}

/** Avg entry in ¢ on dominant inventory leg (inv_yes vs inv_no). */
export function dominantStakedLegAvgPriceCents(w: WalletPosition): number | null {
  const iy = walletInvY(w);
  const inn = walletInvN(w);
  if (iy > inn) {
    return typeof w.priceYes === 'number' && Number.isFinite(w.priceYes) ? w.priceYes * 100 : null;
  }
  if (inn > iy) {
    return typeof w.priceNo === 'number' && Number.isFinite(w.priceNo) ? w.priceNo * 100 : null;
  }
  return null;
}

/** Staked-net cohort bar: Σ max(0, −signed_net) YES vs Σ max(0, signed_net) NO — `cohortSurplusHalves` mode. */
export function toxicCohortStakedNetSurplusHalves(wallets: readonly WalletPosition[]): {
  sumYUsd: number;
  sumNUsd: number;
} {
  let sumYUsd = 0;
  let sumNUsd = 0;
  for (const w of wallets) {
    const s = walletStakeNetSignedUsd(w);
    if (!Number.isFinite(s)) continue;
    if (s <= 0) sumYUsd += Math.max(0, -s);
    else sumNUsd += Math.max(0, s);
  }
  return { sumYUsd, sumNUsd };
}

export function cohortSurplusLean(sumYUsd: number, sumNUsd: number): number | null {
  const t = sumYUsd + sumNUsd;
  if (!(t > 1e-9)) return null;
  return (sumYUsd - sumNUsd) / t;
}

export function stakedNetSortKeyDesc(w: WalletPosition): number {
  const v = walletStakeNetSignedUsd(w);
  return Number.isFinite(v) ? -v : Number.NEGATIVE_INFINITY;
}

export function stakedNetSortKeyAsc(w: WalletPosition): number {
  const v = walletStakeNetSignedUsd(w);
  return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
}

export function stakeSortKeyDesc(w: WalletPosition, leg: 'y' | 'n' | 'tot' | 'net'): number {
  if (leg === 'net') {
    const v = walletStakeNetAbsUsd(w);
    return Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
  }
  const v = leg === 'y' ? walletStakeYUsd(w) : leg === 'n' ? walletStakeNUsd(w) : walletStakeTotalUsd(w);
  return Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
}

export function dedupeWalletsByAddress(list: WalletPosition[]): WalletPosition[] {
  const m = new Map<string, WalletPosition>();
  for (const w of list) {
    const k = (w.wallet || '').trim().toLowerCase();
    if (!k) continue;
    if (!m.has(k)) m.set(k, w);
  }
  return [...m.values()];
}

function walletPositionRowEqual(a: WalletPosition, b: WalletPosition): boolean {
  if (a === b) return true;
  const ea = a.walletLedgerSummary;
  const eb = b.walletLedgerSummary;
  return (
    a.wallet === b.wallet &&
    a.net === b.net &&
    a.netSide === b.netSide &&
    (a.netYes ?? null) === (b.netYes ?? null) &&
    (a.netNo ?? null) === (b.netNo ?? null) &&
    (a.invYes ?? null) === (b.invYes ?? null) &&
    (a.invNo ?? null) === (b.invNo ?? null) &&
    a.tradeCount === b.tradeCount &&
    (a.priceYes ?? null) === (b.priceYes ?? null) &&
    (a.priceNo ?? null) === (b.priceNo ?? null) &&
    Boolean(a.isSmart) === Boolean(b.isSmart) &&
    (ea?.totalTrades ?? null) === (eb?.totalTrades ?? null) &&
    (ea?.pnl ?? null) === (eb?.pnl ?? null) &&
    (ea?.winRate ?? null) === (eb?.winRate ?? null) &&
    (ea?.resolvedMarkets ?? null) === (eb?.resolvedMarkets ?? null)
  );
}

function stabilizeWalletList(prev: WalletPosition[], next: WalletPosition[]): WalletPosition[] {
  if (prev === next) return prev;
  if (next.length === 0) return next;
  const prevByWallet = new Map<string, WalletPosition>();
  for (const w of prev) prevByWallet.set((w.wallet || '').trim().toLowerCase(), w);
  const out = new Array<WalletPosition>(next.length);
  let allPrevRefs = prev.length === next.length;
  for (let i = 0; i < next.length; i++) {
    const n = next[i];
    const p = prevByWallet.get((n.wallet || '').trim().toLowerCase());
    if (p && walletPositionRowEqual(p, n)) out[i] = p;
    else {
      out[i] = n;
      allPrevRefs = false;
    }
  }
  if (allPrevRefs && prev.length === next.length) {
    let ixMatch = true;
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== out[i]) {
        ixMatch = false;
        break;
      }
    }
    if (ixMatch) return prev;
  }
  if (prev.length === out.length) {
    let sameContent = true;
    for (let i = 0; i < out.length; i++) {
      if (!walletPositionRowEqual(prev[i], out[i])) {
        sameContent = false;
        break;
      }
    }
    if (sameContent) return prev;
  }
  return out;
}

function toxicFlowClusterEqual(a: ToxicFlowCluster, b: ToxicFlowCluster): boolean {
  if (a === b) return true;
  if (
    a.clusterId !== b.clusterId ||
    a.mainWallet !== b.mainWallet ||
    a.clusterSize !== b.clusterSize ||
    a.membersInMarket !== b.membersInMarket ||
    a.stakedNetSignedUsd !== b.stakedNetSignedUsd ||
    a.net !== b.net ||
    a.tradeCount !== b.tradeCount
  ) {
    return false;
  }
  return toxicFlowListEqual(a.positions ?? [], b.positions ?? []);
}

function stabilizeClusterList(prev: ToxicFlowCluster[], next: ToxicFlowCluster[]): ToxicFlowCluster[] {
  if (prev === next) return prev;
  if (next.length === 0) return next;
  const prevById = new Map<number, ToxicFlowCluster>();
  for (const c of prev) prevById.set(c.clusterId, c);
  const out = new Array<ToxicFlowCluster>(next.length);
  let allPrevRefs = prev.length === next.length;
  for (let i = 0; i < next.length; i++) {
    const n = next[i];
    const p = prevById.get(n.clusterId);
    if (p && toxicFlowClusterEqual(p, n)) out[i] = p;
    else {
      out[i] = {
        ...n,
        positions: stabilizeWalletList(p?.positions ?? [], n.positions ?? []),
      };
      allPrevRefs = false;
    }
  }
  if (allPrevRefs && prev.length === next.length) {
    let ixMatch = true;
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== out[i]) {
        ixMatch = false;
        break;
      }
    }
    if (ixMatch) return prev;
  }
  return out;
}

function swarmEqual(a: ToxicFlowSwarm, b: ToxicFlowSwarm): boolean {
  if (a === b) return true;
  if (
    a.swarmId !== b.swarmId ||
    a.slotIndex !== b.slotIndex ||
    a.side !== b.side ||
    a.walletCount !== b.walletCount ||
    a.membersInMarket !== b.membersInMarket ||
    a.invYes !== b.invYes ||
    a.invNo !== b.invNo ||
    a.usdcIn !== b.usdcIn ||
    a.stakedNetSignedUsd !== b.stakedNetSignedUsd ||
    a.tradeCount !== b.tradeCount ||
    (a.positions?.length ?? 0) !== (b.positions?.length ?? 0)
  ) {
    return false;
  }
  return true;
}

function swarmListEqual(a: ToxicFlowSwarm[], b: ToxicFlowSwarm[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!swarmEqual(a[i], b[i])) return false;
  return true;
}

/** WS JSON → reuse prior list + row refs when row fields unchanged (stops Array× climb). */
export function coalesceToxicFlowPayload(prev: ToxicFlowData | null, next: ToxicFlowData): ToxicFlowData {
  if (!prev) return next;
  if (toxicFlowPayloadEqual(prev, next)) return prev;
  const swarmsNext = next.swarms ?? [];
  const swarmsPrev = prev.swarms ?? [];
  return {
    ...next,
    topHolders: stabilizeWalletList(prev.topHolders ?? [], next.topHolders ?? []),
    clusters: stabilizeClusterList(prev.clusters ?? [], next.clusters ?? []),
    swarms: swarmListEqual(swarmsPrev, swarmsNext) ? swarmsPrev : swarmsNext,
  };
}

function listsSameRefs(a: readonly WalletPosition[], b: readonly WalletPosition[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sortedListReuse(
  prev: WalletPosition[] | undefined,
  src: readonly WalletPosition[],
  cmp: (a: WalletPosition, b: WalletPosition) => number,
): WalletPosition[] {
  if (src.length === 0) return src as WalletPosition[];
  const sorted = src.length === 1 ? [src[0]] : [...src].sort(cmp);
  if (prev && listsSameRefs(prev, sorted)) return prev;
  return sorted;
}

function filteredSortedReuse(
  prev: WalletPosition[] | undefined,
  src: readonly WalletPosition[],
  pred: (w: WalletPosition) => boolean,
  cmp: (a: WalletPosition, b: WalletPosition) => number,
): WalletPosition[] {
  const filtered: WalletPosition[] = [];
  for (const w of src) {
    if (pred(w)) filtered.push(w);
  }
  return sortedListReuse(prev, filtered, cmp);
}

function sliceReuse(prev: WalletPosition[] | undefined, src: WalletPosition[], start: number, end: number): WalletPosition[] {
  const slice = src.slice(start, end);
  if (prev && listsSameRefs(prev, slice)) return prev;
  return slice;
}

function toxicFlowListEqual(a: WalletPosition[], b: WalletPosition[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!walletPositionRowEqual(a[i], b[i])) return false;
  }
  return true;
}

/** Skip React updates when WS re-parses the same cohort (avoids 7× Map + sort alloc per tick). */
export function toxicFlowPayloadEqual(a: ToxicFlowData, b: ToxicFlowData): boolean {
  if (a === b) return true;
  if (
    a.marketId !== b.marketId ||
    a.totalTrades !== b.totalTrades ||
    a.totalWallets !== b.totalWallets ||
    a.walletMarketTradesForMarket !== b.walletMarketTradesForMarket ||
    a.orderFilledEventsProcessed !== b.orderFilledEventsProcessed ||
    a.totalShares !== b.totalShares ||
    a.totalUsdcIn !== b.totalUsdcIn ||
    a.totalUsdcOut !== b.totalUsdcOut ||
    a.concentration !== b.concentration ||
    a.smartMoneyBias !== b.smartMoneyBias ||
    a.topHoldersBias !== b.topHoldersBias ||
    a.whaleBias !== b.whaleBias ||
    a.whaleCount !== b.whaleCount ||
    a.yesWallets !== b.yesWallets ||
    a.noWallets !== b.noWallets ||
    a.yesUsdcIn !== b.yesUsdcIn ||
    a.noUsdcIn !== b.noUsdcIn ||
    a.totalYesVol !== b.totalYesVol ||
    a.totalNoVol !== b.totalNoVol ||
    a.polygonWssConfigured !== b.polygonWssConfigured
  ) {
    return false;
  }
  if (!toxicFlowListEqual(a.topHolders ?? [], b.topHolders ?? [])) return false;
  const ca = a.clusters ?? [];
  const cb = b.clusters ?? [];
  if (ca.length !== cb.length) return false;
  for (let i = 0; i < ca.length; i++) {
    if (!toxicFlowClusterEqual(ca[i], cb[i])) return false;
  }
  if (!swarmListEqual(a.swarms ?? [], b.swarms ?? [])) return false;
  const ra = a.redFlags;
  const rb = b.redFlags;
  if ((ra?.length ?? 0) !== (rb?.length ?? 0)) return false;
  if (ra?.length) {
    for (let i = 0; i < ra.length; i++) {
      const f = ra[i];
      const g = rb![i];
      if (f.flag !== g.flag || f.value !== g.value || f.wallet !== g.wallet) return false;
    }
  }
  return true;
}

export type ToxicFlowTabWalletViews = {
  topYes: WalletPosition[];
  topNo: WalletPosition[];
  topHolders: WalletPosition[];
  smart: WalletPosition[];
  favourites: WalletPosition[];
  whales: WalletPosition[];
  favWhales: WalletPosition[];
  winners: WalletPosition[];
  stripLists: NonNullable<ReturnType<typeof toxicFlowStakeStripWalletLists>>;
};

let lastTabWalletViews: ToxicFlowTabWalletViews | null = null;

export function clearToxicFlowTabWalletViewsCache(): void {
  lastTabWalletViews = null;
}

/** One dedupe Map + one pass of tab sorts per payload (was 7+ Maps per render). */
export function buildToxicFlowTabWalletViews(
  data: ToxicFlowData,
  favouriteSet: ReadonlySet<string>,
  whaleFloorUsd: number,
  xSet: ReadonlySet<string> = new Set(),
): ToxicFlowTabWalletViews {
  const prev = lastTabWalletViews;
  const universe = toxicFlowWalletUniverse(data);
  const topYes = filteredSortedReuse(
    prev?.topYes,
    universe,
    (w) => {
      const stake = walletStakeNetSignedUsd(w);
      return Number.isFinite(stake) && stake < -STAKED_NET_EPS;
    },
    (a, b) => {
      const d = stakedNetSortKeyDesc(b) - stakedNetSortKeyDesc(a);
      if (d !== 0) return d;
      const dn = walletNet(b) - walletNet(a);
      if (dn !== 0) return dn;
      return (a.wallet || '').localeCompare(b.wallet || '');
    },
  );
  const topNo = filteredSortedReuse(
    prev?.topNo,
    universe,
    (w) => {
      const stake = walletStakeNetSignedUsd(w);
      return Number.isFinite(stake) && stake > STAKED_NET_EPS;
    },
    (a, b) => {
      const d = stakedNetSortKeyAsc(b) - stakedNetSortKeyAsc(a);
      if (d !== 0) return d;
      const dn = walletNet(a) - walletNet(b);
      if (dn !== 0) return dn;
      return (a.wallet || '').localeCompare(b.wallet || '');
    },
  );
  const topHolders = sortedListReuse(prev?.topHolders, data.topHolders ?? [], sortStakeNetMagThenWalletNet);
  const smart = filteredSortedReuse(
    prev?.smart,
    universe,
    toxicRowMatchesSmartLedgerDefinition,
    sortStakeNetMagThenWalletNet,
  );
  const favourites = filteredSortedReuse(
    prev?.favourites,
    universe,
    (w) => favouriteSet.has((w.wallet || '').trim().toLowerCase()),
    sortStakeNetMagThenWalletNet,
  );
  const whales = filteredSortedReuse(
    prev?.whales,
    universe,
    (w) => {
      if (toxicRowWalletIsXMarked(w, xSet)) return false;
      const absUsd = walletStakeNetAbsUsd(w);
      return Number.isFinite(absUsd) && absUsd >= whaleFloorUsd;
    },
    (a, b) => {
      const va = walletStakeNetAbsUsd(a);
      const vb = walletStakeNetAbsUsd(b);
      const d = vb - va;
      if (d !== 0) return d;
      const dn = walletNet(b) - walletNet(a);
      if (dn !== 0) return dn;
      return (a.wallet || '').localeCompare(b.wallet || '');
    },
  );
  const winners = filteredSortedReuse(
    prev?.winners,
    universe,
    (w) => !toxicRowMissingWalletScoresLedgerEmbed(w) && !toxicRowLedgerLifetimePnlNegative(w),
    (a, b) => {
      const d = stakeSortKeyDesc(b, 'net') - stakeSortKeyDesc(a, 'net');
      if (d !== 0) return d;
      const fa = toxicRowSortWinRateFrac(a);
      const fb = toxicRowSortWinRateFrac(b);
      if (fa != null && fb != null && fb !== fa) return fb - fa;
      if (fa != null && fb == null) return -1;
      if (fa == null && fb != null) return 1;
      return sortStakeNetMagThenWalletNet(a, b);
    },
  );
  const favWhales = sortedListReuse(
    prev?.favWhales,
    dedupeWalletsByAddress([...favourites, ...whales]),
    sortStakeNetMagThenWalletNet,
  );
  const stripLists = toxicFlowStakeStripWalletLists(data, favouriteSet, universe, prev?.stripLists ?? undefined)!;
  const views = { topYes, topNo, topHolders, smart, favourites, whales, favWhales, winners, stripLists };
  lastTabWalletViews = views;
  return views;
}

/** Wallet rows available for client-derived cohort tabs (top 100 holders from API/WS). */
export function toxicFlowWalletUniverse(data: ToxicFlowData | null | undefined): WalletPosition[] {
  if (!data) return [];
  return dedupeWalletsByAddress([...(data.topHolders ?? [])]);
}

export function normalizeWinRate(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const scaled = v > 1 ? v / 100 : v;
  return Math.max(0, Math.min(1, scaled));
}

export function ledgerWinRateFracFromStored(wrRaw: number): number {
  const wrFrac = wrRaw > 1 ? wrRaw / 100 : wrRaw;
  return Math.max(0, Math.min(1, wrFrac));
}

export function ledgerSummaryWinRateFracOrNull(s: WalletSummary | null | undefined): number | null {
  if (!s || typeof s.winRate !== 'number' || !Number.isFinite(s.winRate)) return null;
  return ledgerWinRateFracFromStored(s.winRate);
}

/** Ledger embed present and resolved-markets count is strictly below 10 (or no row). Excludes `undefined` embed (not batched). */
export function toxicRowResolvedStatsLow(
  embed: WalletScoresLedgerEmbed | null | undefined,
): boolean {
  if (embed === undefined) return false;
  if (embed === null) return true;
  return (embed.resolvedMarkets ?? 0) < 10;
}

/** Fresh cohort: batched ledger missing or &lt;10 resolved markets. */
export function toxicRowMatchesFreshTab(w: WalletPosition): boolean {
  return toxicRowResolvedStatsLow(w.walletLedgerSummary);
}

/** Smart tab: batched ledger embed only; PnL > 0, WR > 50%, resolved markets > 10. */
export function toxicRowMatchesSmartLedgerDefinition(w: WalletPosition): boolean {
  const embed = w.walletLedgerSummary;
  if (embed == null) return false;
  if ((embed.resolvedMarkets ?? 0) <= 10) return false;
  if (typeof embed.winRate !== 'number' || !Number.isFinite(embed.winRate)) return false;
  if (ledgerWinRateFracFromStored(embed.winRate) <= 0.5) return false;
  const pnl = embed.pnl;
  return typeof pnl === 'number' && Number.isFinite(pnl) && pnl > 0;
}

export function toxicRowWalletLedgerSummary(row: WalletPosition): WalletSummary | null | undefined {
  if (row.walletLedgerSummary === undefined) return undefined;
  if (row.walletLedgerSummary === null) return null;
  return walletSummaryFromLedgerEmbed(row.wallet, row.walletLedgerSummary);
}

export function toxicRowMissingWalletScoresLedgerEmbed(w: WalletPosition): boolean {
  return w.walletLedgerSummary == null;
}

export function toxicRowLedgerLifetimePnlNegative(w: WalletPosition): boolean {
  const emb = w.walletLedgerSummary;
  if (emb == null || emb === undefined) return false;
  const p = emb.pnl;
  return typeof p === 'number' && Number.isFinite(p) && p < 0;
}

export function toxicRowWalletIsXMarked(w: WalletPosition, xSet: ReadonlySet<string>): boolean {
  const k = (w.wallet || '').trim().toLowerCase();
  return k.length > 0 && xSet.has(k);
}

/** Whale Ring: ≥1 wallet at whale floor with dominant-leg avg entry strictly below max (¢). */
export function toxicFlowWhaleRingPriceGatePasses(
  data: ToxicFlowData | null | undefined,
  whaleFloorUsd: number,
  maxPriceCents: number,
  xSet: ReadonlySet<string> = new Set(),
  ignoreNegativePnl = false,
): boolean {
  if (!data || !Number.isFinite(maxPriceCents)) return false;
  for (const w of toxicFlowWalletUniverse(data)) {
    if (toxicRowWalletIsXMarked(w, xSet)) continue;
    const absUsd = walletStakeNetAbsUsd(w);
    if (!Number.isFinite(absUsd) || absUsd < whaleFloorUsd) continue;
    if (ignoreNegativePnl && toxicRowLedgerLifetimePnlNegative(w)) continue;
    const pc = dominantStakedLegAvgPriceCents(w);
    if (pc == null || !Number.isFinite(pc)) continue;
    if (pc < maxPriceCents) return true;
  }
  return false;
}

/** Insider Ring: ≥1 toxic-flow wallet with WR ≥ min (%) and |Staked Net| ≥ min stake. */
export function toxicFlowInsiderRingGatePasses(
  data: ToxicFlowData | null | undefined,
  minWinRatePct: number,
  minStakeUsd: number,
  xSet: ReadonlySet<string> = new Set(),
): boolean {
  if (!data || !Number.isFinite(minWinRatePct) || !Number.isFinite(minStakeUsd)) return false;
  const minFrac = Math.max(0, Math.min(1, minWinRatePct / 100));
  const floor = Math.max(0, minStakeUsd);
  for (const w of toxicFlowWalletUniverse(data)) {
    if (toxicRowWalletIsXMarked(w, xSet)) continue;
    const absUsd = walletStakeNetAbsUsd(w);
    if (!Number.isFinite(absUsd) || absUsd < floor) continue;
    const wr = toxicRowSortWinRateFrac(w);
    if (wr == null || !Number.isFinite(wr)) continue;
    if (wr >= minFrac) return true;
  }
  return false;
}

export function toxicRowSortWinRateFrac(w: WalletPosition): number | null {
  const ledgerSum = toxicRowWalletLedgerSummary(w);
  if (ledgerSum !== undefined && ledgerSum !== null) {
    const f = ledgerSummaryWinRateFracOrNull(ledgerSum);
    if (f != null) return f;
  }
  const fromJoin = typeof w.winRate === 'number' && Number.isFinite(w.winRate) ? w.winRate : undefined;
  if (fromJoin != null) return normalizeWinRate(fromJoin);
  const emb: WalletScoresLedgerEmbed | null | undefined = w.walletLedgerSummary;
  if (emb && typeof emb.winRate === 'number' && Number.isFinite(emb.winRate)) return normalizeWinRate(emb.winRate);
  return null;
}

function sortStakeNetMagThenWalletNet(a: WalletPosition, b: WalletPosition): number {
  const d = stakeSortKeyDesc(b, 'net') - stakeSortKeyDesc(a, 'net');
  if (d !== 0) return d;
  const da = Math.abs(walletNet(a));
  const db = Math.abs(walletNet(b));
  if (db !== da) return db - da;
  return (a.wallet || '').localeCompare(b.wallet || '');
}

/** Sorted wallet rows feeding each Toxic strip preview (Sidebar + ToxicFlowDialog). */
export function toxicFlowStakeStripWalletLists(
  data: ToxicFlowData | null,
  favouriteSet: ReadonlySet<string>,
  universePrecomputed?: WalletPosition[],
  prev?: {
    holders: WalletPosition[];
    smart: WalletPosition[];
    top20: WalletPosition[];
    favourites: WalletPosition[];
    pnlPlus: WalletPosition[];
    fresh: WalletPosition[];
  },
): {
  holders: WalletPosition[];
  smart: WalletPosition[];
  /** Top 20 holders by |staked net| (subset of Holders strip, same sort). */
  top20: WalletPosition[];
  favourites: WalletPosition[];
  pnlPlus: WalletPosition[];
  fresh: WalletPosition[];
} | null {
  if (!data) return null;

  const holdersSorted = sortedListReuse(prev?.holders, data.topHolders ?? [], sortStakeNetMagThenWalletNet);
  const top20Sorted = sliceReuse(prev?.top20, holdersSorted, 0, 20);
  const universe = universePrecomputed ?? toxicFlowWalletUniverse(data);
  const freshSorted = filteredSortedReuse(prev?.fresh, universe, toxicRowMatchesFreshTab, sortStakeNetMagThenWalletNet);
  const smartSorted = filteredSortedReuse(
    prev?.smart,
    universe,
    toxicRowMatchesSmartLedgerDefinition,
    sortStakeNetMagThenWalletNet,
  );
  const favouritesSorted = filteredSortedReuse(
    prev?.favourites,
    universe,
    (w) => favouriteSet.has((w.wallet || '').trim().toLowerCase()),
    sortStakeNetMagThenWalletNet,
  );
  const winnersSorted = filteredSortedReuse(
    prev?.pnlPlus,
    universe,
    (w) => !toxicRowMissingWalletScoresLedgerEmbed(w) && !toxicRowLedgerLifetimePnlNegative(w),
    (a, b) => {
      const d = stakeSortKeyDesc(b, 'net') - stakeSortKeyDesc(a, 'net');
      if (d !== 0) return d;
      const fa = toxicRowSortWinRateFrac(a);
      const fb = toxicRowSortWinRateFrac(b);
      if (fa != null && fb != null && fb !== fa) return fb - fa;
      if (fa != null && fb == null) return -1;
      if (fa == null && fb != null) return 1;
      return sortStakeNetMagThenWalletNet(a, b);
    },
  );

  return {
    holders: holdersSorted,
    smart: smartSorted,
    top20: top20Sorted,
    favourites: favouritesSorted,
    pnlPlus: winnersSorted,
    fresh: freshSorted,
  };
}

/** Same cohort strips as ToxicFlowDialog / Sidebar (holders / smart / top 20 / favourites / greens / fresh). */
export function buildToxicFlowStakeStripBars(
  data: ToxicFlowData | null,
  favouriteSet: ReadonlySet<string>,
): {
  holders: { sumYUsd: number; sumNUsd: number };
  smart: { sumYUsd: number; sumNUsd: number };
  top20: { sumYUsd: number; sumNUsd: number };
  favourites: { sumYUsd: number; sumNUsd: number };
  pnlPlus: { sumYUsd: number; sumNUsd: number };
  fresh: { sumYUsd: number; sumNUsd: number };
} | null {
  const lists = toxicFlowStakeStripWalletLists(data, favouriteSet);
  if (!lists) return null;
  return {
    holders: toxicCohortStakedNetSurplusHalves(lists.holders),
    smart: toxicCohortStakedNetSurplusHalves(lists.smart),
    top20: toxicCohortStakedNetSurplusHalves(lists.top20),
    favourites: toxicCohortStakedNetSurplusHalves(lists.favourites),
    pnlPlus: toxicCohortStakedNetSurplusHalves(lists.pnlPlus),
    fresh: toxicCohortStakedNetSurplusHalves(lists.fresh),
  };
}
