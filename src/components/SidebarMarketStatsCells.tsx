import { memo, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { MarketStakedLegsResponse } from '../api';
import { fetchMarketStakedLegs, marketTotalStakedAbsUsd, mergeMarketStakedLegsResponse } from '../api';
import { useThrottledBidAskMarketRow } from '../hooks/useThrottledBidAskMarketRow';
import { setSidebarNotifyStakedGatePasses } from '../lib/sidebarNotifyStakedGateStore';
import { useSidebarToxicFlowData } from '../lib/sidebarToxicFlowStore';

function stakedNetAbsUsd(legs: MarketStakedLegsResponse | null): number | null {
  return marketTotalStakedAbsUsd(legs);
}

function stakedGrossUsd(legs: MarketStakedLegsResponse | null): number | null {
  if (!legs) return null;
  const y = legs.stakedUsdYesLeg;
  const n = legs.stakedUsdNoLeg;
  if (!Number.isFinite(y) || !Number.isFinite(n)) return null;
  return Math.abs(y) + Math.abs(n);
}

export const SidebarNotifyStakedGateSync = memo(function SidebarNotifyStakedGateSync({
  yesTokenId,
  marketConditionId,
  notifyStakedMinUsd,
}: {
  yesTokenId: string;
  marketConditionId: string;
  notifyStakedMinUsd: number;
}) {
  const [marketStakedLegs, setMarketStakedLegs] = useState<MarketStakedLegsResponse | null>(null);
  const row = useThrottledBidAskMarketRow(yesTokenId);

  useEffect(() => {
    const mid = marketConditionId.trim();
    if (!mid) {
      setMarketStakedLegs(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const legs = await fetchMarketStakedLegs(mid);
        if (!cancelled) setMarketStakedLegs(legs);
      } catch {
        if (!cancelled) setMarketStakedLegs(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marketConditionId]);

  const gate = useMemo(() => {
    const tid = yesTokenId.trim();
    if (!tid) return true;
    let live: MarketStakedLegsResponse | null = null;
    if (row) {
      const wy = row.stakedUsdYesLeg;
      const wn = row.stakedUsdNoLeg;
      const sumAbs = row.stakedSumAbsSignedNetUsd;
      if (typeof wy === 'number' && Number.isFinite(wy) && typeof wn === 'number' && Number.isFinite(wn)) {
        live = { stakedUsdYesLeg: wy, stakedUsdNoLeg: wn };
        if (typeof sumAbs === 'number' && Number.isFinite(sumAbs)) {
          live.stakedSumAbsSignedNetUsd = sumAbs;
        }
      }
    }
    const merged = mergeMarketStakedLegsResponse(live, marketStakedLegs);
    const net = stakedNetAbsUsd(merged);
    if (notifyStakedMinUsd <= 0) return true;
    if (net == null || !Number.isFinite(net)) return false;
    return net > notifyStakedMinUsd;
  }, [yesTokenId, row, marketStakedLegs, notifyStakedMinUsd]);

  useLayoutEffect(() => {
    setSidebarNotifyStakedGatePasses(gate);
  }, [gate]);

  return null;
});

export const SidebarMarketStatsCells = memo(function SidebarMarketStatsCells({
  yesTokenId,
  stakedLegs: stakedLegsProp,
  canShowEmbeddedToxic,
  onExpandToxic,
}: {
  yesTokenId: string;
  /** REST+WS merged legs from Sidebar (needed for weather — WS shareStats often all-zero). */
  stakedLegs: MarketStakedLegsResponse | null;
  canShowEmbeddedToxic: boolean;
  onExpandToxic: () => void;
}) {
  const row = useThrottledBidAskMarketRow(yesTokenId);
  // Same source as expanded Holders (toxic-flow): WS shareStats often empty/wrong for weather.
  const toxicFlow = useSidebarToxicFlowData();

  const stakedLegs = useMemo(() => {
    // Prefer parent merge (REST fills weather); re-merge live row in case parent lags one tick.
    let live: MarketStakedLegsResponse | null = null;
    if (row) {
      const wy = row.stakedUsdYesLeg;
      const wn = row.stakedUsdNoLeg;
      const sumAbs = row.stakedSumAbsSignedNetUsd;
      const netY = row.stakedNetYesUsd;
      const netN = row.stakedNetNoUsd;
      if (typeof wy === 'number' && Number.isFinite(wy) && typeof wn === 'number' && Number.isFinite(wn)) {
        live = { stakedUsdYesLeg: wy, stakedUsdNoLeg: wn };
        if (typeof sumAbs === 'number' && Number.isFinite(sumAbs)) {
          live.stakedSumAbsSignedNetUsd = sumAbs;
        }
        if (typeof netY === 'number' && Number.isFinite(netY) && typeof netN === 'number' && Number.isFinite(netN)) {
          live.stakedNetYesUsd = netY;
          live.stakedNetNoUsd = netN;
        }
      }
    }
    return mergeMarketStakedLegsResponse(live, stakedLegsProp) ?? stakedLegsProp;
  }, [row, stakedLegsProp]);

  const holdersDisplay = useMemo(() => {
    // Expanded Holders "Wallets" = totalWallets from toxic-flow / WMP COUNT(*).
    const toxicHolders = toxicFlow?.totalWallets;
    if (typeof toxicHolders === 'number' && Number.isFinite(toxicHolders)) {
      return toxicHolders.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
    const v = row?.holders;
    if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }, [row, toxicFlow?.totalWallets]);

  const stakedHalves = useMemo(() => {
    const y = stakedLegs?.stakedNetYesUsd;
    const n = stakedLegs?.stakedNetNoUsd;
    const sumAbs = stakedLegs?.stakedSumAbsSignedNetUsd;
    const yesOk = typeof y === 'number' && Number.isFinite(y) && y >= 0;
    const noOk = typeof n === 'number' && Number.isFinite(n) && n >= 0;
    if (yesOk && noOk) {
      const tot = y + n;
      return {
        yesUsd: y,
        noUsd: n,
        yesPct: tot > 0 ? (y / tot) * 100 : null,
        noPct: tot > 0 ? (n / tot) * 100 : null,
        total: tot,
      };
    }
    // Legacy: only total abs — cannot split.
    if (typeof sumAbs === 'number' && Number.isFinite(sumAbs) && sumAbs > 0) {
      return { yesUsd: null, noUsd: null, yesPct: null, noPct: null, total: sumAbs };
    }
    return { yesUsd: null, noUsd: null, yesPct: null, noPct: null, total: null };
  }, [stakedLegs]);

  const stakedGross = useMemo(() => stakedGrossUsd(stakedLegs), [stakedLegs]);
  const yesK =
    stakedHalves.yesUsd != null && Number.isFinite(stakedHalves.yesUsd)
      ? `${(stakedHalves.yesUsd / 1000).toFixed(2)}k`
      : null;
  const noK =
    stakedHalves.noUsd != null && Number.isFinite(stakedHalves.noUsd)
      ? `${(stakedHalves.noUsd / 1000).toFixed(2)}k`
      : null;
  const yesPctLabel =
    stakedHalves.yesPct != null ? `${Math.round(stakedHalves.yesPct)}%` : null;
  const noPctLabel = stakedHalves.noPct != null ? `${Math.round(stakedHalves.noPct)}%` : null;
  const stakedTitle = `Staked net halves: YES $${stakedHalves.yesUsd != null ? stakedHalves.yesUsd.toFixed(0) : '—'} (${yesPctLabel ?? '—'}) · NO $${stakedHalves.noUsd != null ? stakedHalves.noUsd.toFixed(0) : '—'} (${noPctLabel ?? '—'}). Gross Σ|usd| $${typeof stakedGross === 'number' && Number.isFinite(stakedGross) ? stakedGross.toFixed(0) : '—'}. Click to expand Toxic Flow.`;
  const stakedProbTitle = `Staked probability = StakedYes / (StakedYes+StakedNo) ≈ ${yesPctLabel ?? '—'}. Click to expand Toxic Flow.`;

  const pillBtn = canShowEmbeddedToxic
    ? 'cursor-pointer hover:brightness-110 active:brightness-125'
    : 'cursor-default';

  return (
    <>
      <button
        type="button"
        className={`rounded px-1.5 py-1 min-w-0 border border-emerald-800/55 bg-emerald-950/25 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-cyan-500/70 ${pillBtn}`}
        title={stakedTitle}
        onClick={onExpandToxic}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="text-[8px] uppercase tracking-wide text-emerald-400/90 truncate">Stk Yes</div>
        <div className="tabular-nums font-bold text-emerald-300 truncate">
          {yesK != null ? `$${yesK}` : '--'}
        </div>
      </button>
      <button
        type="button"
        className={`rounded px-1.5 py-1 min-w-0 border border-red-800/55 bg-red-950/25 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-cyan-500/70 ${pillBtn}`}
        title={stakedTitle}
        onClick={onExpandToxic}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="text-[8px] uppercase tracking-wide text-red-400/90 truncate">Stk No</div>
        <div className="tabular-nums font-bold text-red-300 truncate">
          {noK != null ? `$${noK}` : '--'}
        </div>
      </button>
      <button
        type="button"
        className={`rounded px-1.5 py-1 min-w-0 border border-violet-700/55 bg-violet-950/30 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-cyan-500/70 ${pillBtn}`}
        title={stakedProbTitle}
        onClick={onExpandToxic}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="text-[8px] uppercase tracking-wide text-violet-400/90 truncate">Staked Prob</div>
        <div className="tabular-nums font-bold text-violet-300 truncate">{yesPctLabel ?? '--'}</div>
      </button>
      <button
        type="button"
        className={`min-w-0 w-full rounded border border-yellow-500/50 bg-yellow-900/20 px-1.5 py-1 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-amber-500/70 ${pillBtn}`}
        title={
          canShowEmbeddedToxic
            ? 'Wallets with WMP rows (same as Holders panel Wallets). Click to expand.'
            : 'Wallets count from wallet_market_positions (toxic-flow totalWallets)'
        }
        onClick={onExpandToxic}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="text-[8px] uppercase tracking-wide text-yellow-400 truncate">Holders</div>
        <div className="tabular-nums font-bold text-yellow-300 truncate">{holdersDisplay}</div>
      </button>
    </>
  );
});
