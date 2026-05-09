/** Sidebar: bar = Σ|YES leg| vs Σ|NO leg| proportions; pill |ΣY−ΣN| is separate. Toxic cohort: bar = YES-net vs NO-net surplus halves. */

function fmtUsd(absVal: number): string {
  return absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type StakedLegBarMode = 'grossLegTotals' | 'cohortSurplusHalves';

export function StakedLegUsdBar({
  sumYUsd,
  sumNUsd,
  dense,
  compact,
  barMode = 'grossLegTotals',
}: {
  sumYUsd: number;
  sumNUsd: number;
  dense?: boolean;
  /** Match Sidebar MiniBar row (h-[5px], left label column). */
  compact?: boolean;
  /** grossLegTotals: market Σ|usd_yes| vs Σ|usd_no|. cohortSurplusHalves: Σ max(0,net) vs Σ max(0,−net) in active toxic tab. */
  barMode?: StakedLegBarMode;
}) {
  const total = sumYUsd + sumNUsd;
  if (total <= 1e-9) return null;
  const pctY = (sumYUsd / total) * 100;
  const pctN = (sumNUsd / total) * 100;
  /** Signed tilt: gross mode ≈ (ΣY−ΣN)/(ΣY+ΣN); cohort surplus mode → ±100% when one-sided. */
  const lean = (sumYUsd - sumNUsd) / total;
  const netAbs = Math.abs(sumYUsd - sumNUsd);
  const tip =
    barMode === 'grossLegTotals'
      ? `YES leg ${pctY.toFixed(1)}% ($${fmtUsd(sumYUsd)}) · NO leg ${pctN.toFixed(1)}% ($${fmtUsd(sumNUsd)}) · Σ legs $${fmtUsd(total)} · Staked pill |ΣY−ΣN| $${fmtUsd(netAbs)}`
      : `Cohort YES-net ${pctY.toFixed(1)}% ($${fmtUsd(sumYUsd)}) · NO-net ${pctN.toFixed(1)}% ($${fmtUsd(sumNUsd)}) · |cohort net| $${fmtUsd(total)}`;

  const bar = (
    <div
      className={`${compact ? 'h-[5px]' : 'h-2'} bg-gray-700 rounded-full overflow-hidden flex w-full`}
      title={tip}
    >
      <div className="bg-emerald-500/80 h-full shrink-0 transition-all" style={{ width: `${pctY}%` }} />
      <div className="bg-red-500/80 h-full shrink-0 transition-all" style={{ width: `${pctN}%` }} />
    </div>
  );

  if (compact) {
    const leanPct = lean * 100;
    const leanColor = lean > 0.01 ? 'text-green-400' : lean < -0.01 ? 'text-red-400' : 'text-gray-500';
    const leanTitle =
      barMode === 'grossLegTotals'
        ? `(ΣY − ΣN) / (ΣY + ΣN) tilt: ${leanPct >= 0 ? '+' : ''}${leanPct.toFixed(0)}% · |ΣY−ΣN| $${fmtUsd(netAbs)}`
        : `Cohort imbalance: YES-net ${pctY.toFixed(1)}% vs NO-net ${pctN.toFixed(1)}%; |cohort net| $${fmtUsd(total)}`;
    return (
      <div className={`flex items-center gap-1 min-w-0 ${dense ? '' : ''}`}>
        <span className="text-[8px] text-gray-500 w-[38px] shrink-0 truncate" title={tip}>
          Stake
        </span>
        <div className="flex-1 min-w-0">{bar}</div>
        <span className={`text-[8px] font-bold w-[28px] shrink-0 tabular-nums text-right ${leanColor}`} title={leanTitle}>
          {leanPct > 0 ? '+' : ''}
          {leanPct.toFixed(0)}%
        </span>
      </div>
    );
  }

  const yLbl = barMode === 'grossLegTotals' ? `Y $${fmtUsd(sumYUsd)}` : `Y net $${fmtUsd(sumYUsd)}`;
  const nLbl = barMode === 'grossLegTotals' ? `N $${fmtUsd(sumNUsd)}` : `N net $${fmtUsd(sumNUsd)}`;
  const midTitle =
    barMode === 'grossLegTotals' ? `Σ legs $${fmtUsd(total)} · |ΣY−ΣN| $${fmtUsd(netAbs)}` : `|cohort net| $${fmtUsd(total)}`;

  return (
    <div className={dense ? 'shrink-0' : 'mb-2 shrink-0'}>
      <div className="flex justify-between items-center gap-1 text-[9px] text-gray-500 mb-0.5 px-0.5">
        <span className="text-green-400 tabular-nums font-medium" title={barMode === 'grossLegTotals' ? 'Σ|YES leg|' : 'Σ max(0, per-wallet net)'}>
          {yLbl}
        </span>
        <span className="text-gray-400 tabular-nums font-medium px-1" title={midTitle}>
          ${fmtUsd(total)}
        </span>
        <span className="text-red-400 tabular-nums font-medium" title={barMode === 'grossLegTotals' ? 'Σ|NO leg|' : 'Σ max(0, −per-wallet net)'}>
          {nLbl}
        </span>
      </div>
      {bar}
    </div>
  );
}
