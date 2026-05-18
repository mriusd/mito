/**
 * Toxic Flow “cohort surplus” stake math shared by ToxicFlowDialog sidebar strip and market Sidebar.
 */

import type { ToxicFlowData, WalletPosition, WalletScoresLedgerEmbed, WalletSummary } from '../api';
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

/** Ledger/display basis: inv_n×px_n − inv_y×px_y — matches Staked Net column. */
export function walletStakeNetSignedUsd(w: WalletPosition): number {
  const sy = walletStakeYUsd(w);
  const sn = walletStakeNUsd(w);
  if (!(Number.isFinite(sy) || Number.isFinite(sn))) return NaN;
  const y = Number.isFinite(sy) ? sy : 0;
  const n = Number.isFinite(sn) ? sn : 0;
  return n - y;
}

export function walletStakeNetAbsUsd(w: WalletPosition): number {
  const s = walletStakeNetSignedUsd(w);
  return Number.isFinite(s) ? Math.abs(s) : NaN;
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

function toxicFlowRowSig(w: WalletPosition): string {
  const emb = w.walletLedgerSummary;
  return [
    w.wallet,
    w.net,
    w.netYes ?? '',
    w.netNo ?? '',
    w.invYes ?? '',
    w.invNo ?? '',
    w.tradeCount,
    w.priceYes ?? '',
    w.priceNo ?? '',
    w.isSmart ? 1 : 0,
    emb?.totalTrades ?? '',
    emb?.pnl ?? '',
    emb?.winRate ?? '',
  ].join('\x00');
}

function toxicFlowListEqual(a: WalletPosition[], b: WalletPosition[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (toxicFlowRowSig(a[i]) !== toxicFlowRowSig(b[i])) return false;
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
  if (!toxicFlowListEqual(a.topYes ?? [], b.topYes ?? [])) return false;
  if (!toxicFlowListEqual(a.topNo ?? [], b.topNo ?? [])) return false;
  if (!toxicFlowListEqual(a.topVolume ?? [], b.topVolume ?? [])) return false;
  if (!toxicFlowListEqual(a.topTraders ?? [], b.topTraders ?? [])) return false;
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
  winners: WalletPosition[];
  stripLists: NonNullable<ReturnType<typeof toxicFlowStakeStripWalletLists>>;
};

/** One dedupe Map + one pass of tab sorts per payload (was 7+ Maps per render). */
export function buildToxicFlowTabWalletViews(
  data: ToxicFlowData,
  favouriteSet: ReadonlySet<string>,
  whaleFloorUsd: number,
): ToxicFlowTabWalletViews {
  const universe = toxicFlowWalletUniverse(data);
  const topYes = [...universe.filter((w) => {
    const stake = walletStakeNetSignedUsd(w);
    return Number.isFinite(stake) && stake < -STAKED_NET_EPS;
  })].sort((a, b) => {
    const d = stakedNetSortKeyDesc(b) - stakedNetSortKeyDesc(a);
    if (d !== 0) return d;
    const dn = walletNet(b) - walletNet(a);
    if (dn !== 0) return dn;
    return (a.wallet || '').localeCompare(b.wallet || '');
  });
  const topNo = [...universe.filter((w) => {
    const stake = walletStakeNetSignedUsd(w);
    return Number.isFinite(stake) && stake > STAKED_NET_EPS;
  })].sort((a, b) => {
    const d = stakedNetSortKeyAsc(b) - stakedNetSortKeyAsc(a);
    if (d !== 0) return d;
    const dn = walletNet(a) - walletNet(b);
    if (dn !== 0) return dn;
    return (a.wallet || '').localeCompare(b.wallet || '');
  });
  const topHolders = [...(data.topHolders ?? [])].sort(sortStakeNetMagThenWalletNet);
  const smart = [...universe.filter(toxicRowMatchesSmartLedgerDefinition)].sort(sortStakeNetMagThenWalletNet);
  const favourites = [
    ...universe.filter((w) => favouriteSet.has((w.wallet || '').trim().toLowerCase())),
  ].sort(sortStakeNetMagThenWalletNet);
  const whales = [...universe.filter((w) => {
    const absUsd = walletStakeNetAbsUsd(w);
    return Number.isFinite(absUsd) && absUsd >= whaleFloorUsd;
  })].sort((a, b) => {
    const va = walletStakeNetAbsUsd(a);
    const vb = walletStakeNetAbsUsd(b);
    const d = vb - va;
    if (d !== 0) return d;
    const dn = walletNet(b) - walletNet(a);
    if (dn !== 0) return dn;
    return (a.wallet || '').localeCompare(b.wallet || '');
  });
  const winners = [...universe.filter(
    (w) => !toxicRowMissingWalletScoresLedgerEmbed(w) && !toxicRowLedgerLifetimePnlNegative(w),
  )].sort((a, b) => {
    const d = stakeSortKeyDesc(b, 'net') - stakeSortKeyDesc(a, 'net');
    if (d !== 0) return d;
    const fa = toxicRowSortWinRateFrac(a);
    const fb = toxicRowSortWinRateFrac(b);
    if (fa != null && fb != null && fb !== fa) return fb - fa;
    if (fa != null && fb == null) return -1;
    if (fa == null && fb != null) return 1;
    return sortStakeNetMagThenWalletNet(a, b);
  });
  const stripLists = toxicFlowStakeStripWalletLists(data, favouriteSet, universe)!;
  return { topYes, topNo, topHolders, smart, favourites, whales, winners, stripLists };
}

/** Deduped union of toxic cohort rows. */
export function toxicFlowWalletUniverse(data: ToxicFlowData | null | undefined): WalletPosition[] {
  if (!data) return [];
  return dedupeWalletsByAddress([
    ...(data.topHolders ?? []),
    ...(data.topYes ?? []),
    ...(data.topNo ?? []),
    ...(data.topVolume ?? []),
    ...(data.topTraders ?? []),
  ]);
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

  const holdersSorted = [...(data.topHolders ?? [])].sort(sortStakeNetMagThenWalletNet);
  const top20Sorted = holdersSorted.slice(0, 20);
  const universe = universePrecomputed ?? toxicFlowWalletUniverse(data);
  const freshSorted = [...universe.filter(toxicRowMatchesFreshTab)].sort(sortStakeNetMagThenWalletNet);
  const smartSorted = [...universe.filter(toxicRowMatchesSmartLedgerDefinition)].sort(sortStakeNetMagThenWalletNet);
  const favouritesSorted = [
    ...universe.filter((w) => favouriteSet.has((w.wallet || '').trim().toLowerCase())),
  ].sort(sortStakeNetMagThenWalletNet);
  const winnersSorted = [
    ...universe.filter((w) => !toxicRowMissingWalletScoresLedgerEmbed(w) && !toxicRowLedgerLifetimePnlNegative(w)),
  ].sort((a, b) => {
    const d = stakeSortKeyDesc(b, 'net') - stakeSortKeyDesc(a, 'net');
    if (d !== 0) return d;
    const fa = toxicRowSortWinRateFrac(a);
    const fb = toxicRowSortWinRateFrac(b);
    if (fa != null && fb != null && fb !== fa) return fb - fa;
    if (fa != null && fb == null) return -1;
    if (fa == null && fb != null) return 1;
    return sortStakeNetMagThenWalletNet(a, b);
  });

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
