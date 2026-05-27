import { memo, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { MarketStakedLegsResponse } from '../api';
import { fetchMarketStakedLegs, marketTotalStakedAbsUsd, mergeMarketStakedLegsResponse } from '../api';
import { useThrottledBidAskMarketRow } from '../hooks/useThrottledBidAskMarketRow';
import { formatPolymarketVolumeK } from '../utils/format';
import { setSidebarNotifyStakedGatePasses } from '../lib/sidebarNotifyStakedGateStore';

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

function stakedPillTier(net: number | null): 'muted' | 'low' | 'mid' | 'high' {
  if (typeof net !== 'number' || !Number.isFinite(net)) return 'muted';
  if (net < 15_000) return 'low';
  if (net <= 30_000) return 'mid';
  return 'high';
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
  canShowEmbeddedToxic,
  onExpandToxic,
}: {
  yesTokenId: string;
  canShowEmbeddedToxic: boolean;
  onExpandToxic: () => void;
}) {
  const row = useThrottledBidAskMarketRow(yesTokenId);

  const volumeDisplay = useMemo(() => {
    const v = row?.wmpVolumeSum;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    return formatPolymarketVolumeK(v);
  }, [row]);

  const sharesDisplay = useMemo(() => {
    const v = row?.sharesInExistence;
    if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }, [row]);

  const holdersDisplay = useMemo(() => {
    const v = row?.holders;
    if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }, [row]);

  const stakedNetAbs = useMemo(() => {
    const sumAbs = row?.stakedSumAbsSignedNetUsd;
    return typeof sumAbs === 'number' && Number.isFinite(sumAbs) ? sumAbs : null;
  }, [row]);

  const stakedGross = useMemo(() => {
    const wy = row?.stakedUsdYesLeg;
    const wn = row?.stakedUsdNoLeg;
    if (typeof wy !== 'number' || !Number.isFinite(wy) || typeof wn !== 'number' || !Number.isFinite(wn)) {
      return null;
    }
    return Math.abs(wy) + Math.abs(wn);
  }, [row]);

  const tier = stakedPillTier(stakedNetAbs);
  const stakedNetKDisplay =
    stakedNetAbs != null && Number.isFinite(stakedNetAbs) ? formatPolymarketVolumeK(stakedNetAbs) : null;

  return (
    <>
      <button
        type="button"
        className={`rounded px-1.5 py-1 min-w-0 border border-gray-700/70 bg-gray-900/50 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-cyan-500/70 ${
          canShowEmbeddedToxic ? 'cursor-pointer hover:brightness-110 active:brightness-125' : 'cursor-default'
        }`}
        title={
          canShowEmbeddedToxic
            ? 'Σ wallet_market_positions.volume (chart WS). Click to expand Toxic Flow holders panel.'
            : 'Σ wallet_market_positions.volume for this market (chart WS wmpVolumeSum)'
        }
        onClick={onExpandToxic}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="text-[8px] uppercase tracking-wide text-gray-500 truncate">Volume</div>
        <div className="tabular-nums font-bold text-green-400 truncate">
          {volumeDisplay ? `$${volumeDisplay}` : '--'}
        </div>
      </button>
      <button
        type="button"
        className={`rounded px-1.5 py-1 min-w-0 border text-left outline-none transition focus-visible:ring-1 focus-visible:ring-cyan-500/70 ${
          canShowEmbeddedToxic ? 'cursor-pointer hover:brightness-110 active:brightness-125' : 'cursor-default'
        } ${
          tier === 'low'
            ? 'border-red-700/65 bg-red-950/35'
            : tier === 'mid'
              ? 'border-amber-600/55 bg-amber-950/35'
              : tier === 'high'
                ? 'border-emerald-800/60 bg-emerald-950/30'
                : 'border-gray-700/70 bg-gray-900/50'
        }`}
        title={
          canShowEmbeddedToxic
            ? `Total staked: Σ_w |Staked Net| USD ≈ $${typeof stakedNetAbs === 'number' && Number.isFinite(stakedNetAbs) ? stakedNetAbs.toFixed(0) : '—'}. Σ|usd_yes|+Σ|usd_no| gross $${typeof stakedGross === 'number' && Number.isFinite(stakedGross) ? stakedGross.toFixed(0) : '—'}. Click to expand Toxic Flow.`
            : `Total staked (pill): Σ_w |Staked Net| USD ≈ $${typeof stakedNetAbs === 'number' && Number.isFinite(stakedNetAbs) ? stakedNetAbs.toFixed(0) : '—'}. Gross leg USD: $${typeof stakedGross === 'number' && Number.isFinite(stakedGross) ? stakedGross.toFixed(0) : '—'}`
        }
        onClick={onExpandToxic}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          className={`text-[8px] uppercase tracking-wide truncate ${
            tier === 'low'
              ? 'text-red-400/90'
              : tier === 'mid'
                ? 'text-amber-400/90'
                : tier === 'high'
                  ? 'text-emerald-500/90'
                  : 'text-gray-500'
          }`}
        >
          Staked
        </div>
        <div
          className={`tabular-nums font-bold truncate ${
            tier === 'low'
              ? 'text-red-300'
              : tier === 'mid'
                ? 'text-amber-200'
                : tier === 'high'
                  ? 'text-emerald-300'
                  : 'text-gray-200'
          }`}
        >
          {stakedNetKDisplay ? `$${stakedNetKDisplay}` : '--'}
        </div>
      </button>
      <button
        type="button"
        className={`rounded border border-gray-700/70 bg-gray-900/50 px-1.5 py-1 min-w-0 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-cyan-500/70 ${
          canShowEmbeddedToxic ? 'cursor-pointer hover:bg-gray-800/65 active:bg-gray-800/90' : 'cursor-default'
        }`}
        title={
          canShowEmbeddedToxic
            ? 'Shares in existence from net balances. Click to expand Toxic Flow holders panel.'
            : 'Shares in existence from net wallet balances: sum(abs(YES-NO))'
        }
        onClick={onExpandToxic}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="text-[8px] uppercase tracking-wide text-gray-500 truncate">Shares</div>
        <div className="tabular-nums font-bold text-gray-200 truncate">{sharesDisplay}</div>
      </button>
      <button
        type="button"
        className={`min-w-0 w-full rounded border border-yellow-500/50 bg-yellow-900/20 px-1.5 py-1 text-left outline-none transition focus-visible:ring-1 focus-visible:ring-amber-500/70 ${
          canShowEmbeddedToxic ? 'cursor-pointer hover:bg-yellow-900/35 active:bg-yellow-900/50' : 'cursor-default'
        }`}
        title={
          canShowEmbeddedToxic
            ? 'Holders count. Click to expand Toxic Flow holders panel.'
            : 'Holders count (desktop: expand sidebar chevron for Toxic Flow)'
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
