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
  compactLabel,
  barMode = 'grossLegTotals',
  /** Sidebar: pulse Y or N segment when |tilt| ≥ threshold (default 30%). */
  flashExtremeTilt = false,
  /** Fraction 0.01–0.999; default 0.3. Used when flashExtremeTilt. */
  extremeFlashTiltThreshold = 0.3,
  compactLegUsdFooter = false,
}: {
  sumYUsd: number;
  sumNUsd: number;
  dense?: boolean;
  /** Match Sidebar MiniBar row (h-[5px], left label column). */
  compact?: boolean;
  /** Left caption when compact (default "Stake"). */
  compactLabel?: string;
  /** grossLegTotals: market Σ|usd_yes| vs Σ|usd_no|. cohortSurplusHalves: Σ max(0,net) vs Σ max(0,−net) in active toxic tab. */
  barMode?: StakedLegBarMode;
  flashExtremeTilt?: boolean;
  extremeFlashTiltThreshold?: number;
  compactLegUsdFooter?: boolean;
}) {
  const total = sumYUsd + sumNUsd;
  if (total <= 1e-9) return null;
  const pctY = (sumYUsd / total) * 100;
  const pctN = (sumNUsd / total) * 100;
  /** Signed tilt: gross mode ≈ (ΣY−ΣN)/(ΣY+ΣN); cohort surplus mode → ±100% when one-sided. */
  const lean = (sumYUsd - sumNUsd) / total;
  const netAbs = Math.abs(sumYUsd - sumNUsd);
  const flashFrac =
    typeof extremeFlashTiltThreshold === 'number' && Number.isFinite(extremeFlashTiltThreshold)
      ? Math.min(0.999, Math.max(0.01, extremeFlashTiltThreshold))
      : 0.3;
  const flashY = flashExtremeTilt && Number.isFinite(lean) && lean >= flashFrac;
  const flashN = flashExtremeTilt && Number.isFinite(lean) && lean <= -flashFrac;
  const tip =
    barMode === 'grossLegTotals'
      ? `YES leg ${pctY.toFixed(1)}% ($${fmtUsd(sumYUsd)}) · NO leg ${pctN.toFixed(1)}% ($${fmtUsd(sumNUsd)}) · Σ legs $${fmtUsd(total)} · Staked pill |ΣY−ΣN| $${fmtUsd(netAbs)}`
      : `Splits per wallet inv×px: Σ max(0, signed net) greenside + Σ max(0, −signed) redside equals Σ|net| for this cohort only ($${fmtUsd(total)}). Header Staked is ‖Σ ‖Y-leg‖ − Σ ‖N-leg‖‖ over all wallets—different pooling; neither caps the other.`;

  const bar = (
    <div
      className={`${compact ? 'h-[5px]' : 'h-2'} bg-gray-700 rounded-full overflow-hidden flex w-full`}
      title={tip}
    >
      <div
        className={`bg-emerald-500/80 h-full shrink-0 transition-[width] duration-150 ease-out${flashY ? ' sidebar-bar-seg-flash-left' : ''}`}
        style={{ width: `${pctY}%` }}
      />
      <div
        className={`bg-red-500/80 h-full shrink-0 transition-[width] duration-150 ease-out${flashN ? ' sidebar-bar-seg-flash-right' : ''}`}
        style={{ width: `${pctN}%` }}
      />
    </div>
  );

  if (compact) {
    const leanPct = lean * 100;
    const leanColor = lean > 0.01 ? 'text-green-400' : lean < -0.01 ? 'text-red-400' : 'text-gray-500';
    const leanTitle =
      barMode === 'grossLegTotals'
        ? `(ΣY − ΣN) / (ΣY + ΣN) tilt: ${leanPct >= 0 ? '+' : ''}${leanPct.toFixed(0)}% · |ΣY−ΣN| $${fmtUsd(netAbs)}`
        : `(Σ splits YES − Σ splits NO)/(Σ splits): ${leanPct >= 0 ? '+' : ''}${leanPct.toFixed(0)}%; center $${fmtUsd(total)} = Σ|per-wallet inv×px net| in cohort—not header Staked.`;
    const leftLbl = compactLabel ?? 'Stake';
    const yFoot =
      barMode === 'grossLegTotals' ? `Σ|YES| $${fmtUsd(sumYUsd)}` : `Y surplus $${fmtUsd(sumYUsd)}`;
    const nFoot =
      barMode === 'grossLegTotals' ? `Σ|NO| $${fmtUsd(sumNUsd)}` : `N surplus $${fmtUsd(sumNUsd)}`;
    return (
      <div className="min-w-0 space-y-0.5">
        <div className={`flex items-center gap-1 min-w-0 ${dense ? '' : ''}`}>
          <span className="text-[8px] text-gray-500 w-[38px] shrink-0 truncate" title={tip}>
            {leftLbl}
          </span>
          <div className="flex-1 min-w-0">{bar}</div>
          <span className={`text-[8px] font-bold w-[28px] shrink-0 tabular-nums text-right ${leanColor}`} title={leanTitle}>
            {leanPct > 0 ? '+' : ''}
            {leanPct.toFixed(0)}%
          </span>
        </div>
        {compactLegUsdFooter ? (
          <div className="flex gap-1 min-w-0 items-baseline">
            <span className="w-[38px] shrink-0" aria-hidden />
            <div
              className="flex flex-1 justify-between gap-2 min-w-0 text-[8px] tabular-nums leading-tight"
              title={`${yFoot} · ${nFoot}`}
            >
              <span className="text-green-400 font-medium truncate">
                Y ${fmtUsd(sumYUsd)}
              </span>
              <span className="text-red-400 font-medium truncate text-right">
                N ${fmtUsd(sumNUsd)}
              </span>
            </div>
            <span className="w-[28px] shrink-0" aria-hidden />
          </div>
        ) : null}
      </div>
    );
  }

  const yLbl = barMode === 'grossLegTotals' ? `Y $${fmtUsd(sumYUsd)}` : `Y net $${fmtUsd(sumYUsd)}`;
  const nLbl = barMode === 'grossLegTotals' ? `N $${fmtUsd(sumNUsd)}` : `N net $${fmtUsd(sumNUsd)}`;
  const midTitle =
    barMode === 'grossLegTotals' ? `Σ legs $${fmtUsd(total)} · |ΣY−ΣN| $${fmtUsd(netAbs)}` : `Σᵢ|inv×px netᵢ| = $${fmtUsd(total)} (Top Holders only)`;

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
