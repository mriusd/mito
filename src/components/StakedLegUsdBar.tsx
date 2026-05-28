/** Sidebar: bar = Σ|YES leg| vs Σ|NO leg| proportions; pill |ΣY−ΣN| is separate. Toxic cohort: bar = YES-net vs NO-net surplus halves. */

import { SidebarBarMidMarker } from './SidebarBarMidMarker';

function fmtUsd(absVal: number): string {
  return absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUsdWhole(absVal: number): string {
  return Math.round(absVal).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export type StakedLegBarMode = 'grossLegTotals' | 'cohortSurplusHalves' | 'yesBookDepth';

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
  /** Draw 25% / 50% / 75% ticks — sidebar only unless opted in. */
  midMarker = false,
  /** When compact, skip the fixed left label column (external label row). */
  compactOmitLeftLabel = false,
  /** Compact right column: `±N% / $|ΣY−ΣN| / $total` (cohort) or lean-side $ (other modes). */
  compactShowLeanDirectionUsd = false,
  compactTotalStakeNetUsd,
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
  midMarker?: boolean;
  compactOmitLeftLabel?: boolean;
  compactShowLeanDirectionUsd?: boolean;
  compactTotalStakeNetUsd?: number | null;
}) {
  const finiteY = typeof sumYUsd === 'number' && Number.isFinite(sumYUsd);
  const finiteN = typeof sumNUsd === 'number' && Number.isFinite(sumNUsd);
  const hasValues = finiteY && finiteN;
  const total = hasValues ? sumYUsd + sumNUsd : 0;
  /** No colored split — missing inputs or negligible total. */
  const neutralBar = !hasValues || total <= 1e-9;
  const displayTotal = neutralBar ? 0 : total;
  const pctY = neutralBar ? 0 : (sumYUsd / displayTotal) * 100;
  const pctN = neutralBar ? 0 : (sumNUsd / displayTotal) * 100;
  /** Signed tilt: gross mode ≈ (ΣY−ΣN)/(ΣY+ΣN); cohort surplus mode → ±100% when one-sided. */
  const lean = neutralBar ? 0 : (sumYUsd - sumNUsd) / displayTotal;
  const netAbs = neutralBar ? 0 : Math.abs(sumYUsd - sumNUsd);
  const flashFrac =
    typeof extremeFlashTiltThreshold === 'number' && Number.isFinite(extremeFlashTiltThreshold)
      ? Math.min(0.999, Math.max(0.01, extremeFlashTiltThreshold))
      : 0.3;
  const flashY = !neutralBar && flashExtremeTilt && Number.isFinite(lean) && lean >= flashFrac;
  const flashN = !neutralBar && flashExtremeTilt && Number.isFinite(lean) && lean <= -flashFrac;
  const totalStakeNetUsd =
    typeof compactTotalStakeNetUsd === 'number' && Number.isFinite(compactTotalStakeNetUsd)
      ? compactTotalStakeNetUsd
      : barMode === 'cohortSurplusHalves' && !neutralBar
        ? displayTotal
        : null;
  const directionUsd = neutralBar
    ? null
    : barMode === 'cohortSurplusHalves'
      ? netAbs
      : barMode === 'grossLegTotals' && totalStakeNetUsd != null && totalStakeNetUsd > 0
        ? (() => {
            const yHalf = (totalStakeNetUsd * (1 + lean)) / 2;
            const nHalf = (totalStakeNetUsd * (1 - lean)) / 2;
            return lean >= 0 ? yHalf : nHalf;
          })()
        : lean >= 0
          ? sumYUsd
          : sumNUsd;
  const tip = neutralBar
    ? barMode === 'yesBookDepth'
      ? 'No YES / NO bid depth to chart'
      : barMode === 'grossLegTotals'
      ? 'No gross leg totals to chart'
      : 'No cohort staked-net split to chart'
    : barMode === 'yesBookDepth'
      ? `YES bids ${pctY.toFixed(1)}% ($${fmtUsd(sumYUsd)}) · NO bids ${pctN.toFixed(1)}% ($${fmtUsd(sumNUsd)}) · 5–95¢`
      : barMode === 'grossLegTotals'
      ? `YES leg ${pctY.toFixed(1)}% ($${fmtUsd(sumYUsd)}) · NO leg ${pctN.toFixed(1)}% ($${fmtUsd(sumNUsd)}) · Σ legs $${fmtUsd(displayTotal)} · Staked pill |ΣY−ΣN| $${fmtUsd(netAbs)}`
      : `Splits per wallet inv×px: Σ max(0, signed net) greenside + Σ max(0, −signed) redside equals Σ|net| for this cohort only ($${fmtUsd(displayTotal)}). Header Staked is ‖Σ ‖Y-leg‖ − Σ ‖N-leg‖‖ over all wallets—different pooling; neither caps the other.`;

  const bar = neutralBar ? (
    <div
      className={`relative ${compact ? 'h-[5px]' : 'h-2'} rounded-full overflow-hidden flex w-full bg-gray-600/90`}
      title={tip}
    >
      {midMarker ? <SidebarBarMidMarker /> : null}
    </div>
  ) : (
    <div
      className={`relative ${compact ? 'h-[5px]' : 'h-2'} bg-gray-700 rounded-full overflow-hidden flex w-full`}
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
      {midMarker ? <SidebarBarMidMarker /> : null}
    </div>
  );

  if (compact) {
    const leanPct = lean * 100;
    const leanColor = neutralBar
      ? 'text-gray-500'
      : lean > 0.01
        ? 'text-green-400'
        : lean < -0.01
          ? 'text-red-400'
          : 'text-gray-500';
    const leanPctLabel =
      neutralBar
        ? '—'
        : barMode === 'yesBookDepth'
          ? (() => {
              const absPct = Math.min(100, Math.round(Math.abs(lean) * 100));
              if (absPct <= 0) return '0%';
              return `${absPct}% ${lean >= 0 ? 'Y' : 'N'}`;
            })()
          : `${leanPct > 0 ? '+' : ''}${leanPct.toFixed(0)}%`;
    const leanTitle =
      neutralBar ? 'No split'
      : barMode === 'grossLegTotals'
        ? `(ΣY − ΣN) / (ΣY + ΣN) tilt: ${leanPct >= 0 ? '+' : ''}${leanPct.toFixed(0)}% · |ΣY−ΣN| gross $${fmtUsd(netAbs)}`
        : `(Σ Staked Y − Σ Staked N) / (Σ Staked Y + Σ Staked N) in this tab: ${leanPct >= 0 ? '+' : ''}${leanPct.toFixed(0)}% · $${fmtUsdWhole(netAbs)} = higher side minus lower · total = Σ Staked $ in rows`;
    const leanRightContent =
      neutralBar || directionUsd == null ? (
        '—'
      ) : compactShowLeanDirectionUsd ? (
        totalStakeNetUsd != null && totalStakeNetUsd > 0 ? (
          <>
            <span className={leanColor}>${fmtUsdWhole(directionUsd)}</span>
            <span className={leanColor}> ({leanPctLabel})</span>
            <span className="text-gray-500">{' \\ '}</span>
            <span className="text-gray-500">${fmtUsdWhole(totalStakeNetUsd)}</span>
          </>
        ) : (
          <>
            <span className={leanColor}>${fmtUsdWhole(directionUsd)}</span>
            <span className={leanColor}> ({leanPctLabel})</span>
          </>
        )
      ) : (
        leanPctLabel
      );
    const leanRightTitle =
      neutralBar || directionUsd == null
        ? leanTitle
        : compactShowLeanDirectionUsd
          ? totalStakeNetUsd != null && totalStakeNetUsd > 0
            ? `${leanTitle} · |ΣY−ΣN| $${fmtUsdWhole(directionUsd!)} · tab total $${fmtUsdWhole(totalStakeNetUsd)}`
            : `${leanTitle} · ${lean >= 0 ? 'YES' : 'NO'} direction staked $${fmtUsdWhole(directionUsd!)}`
          : leanTitle;
    const leanColClass = compactShowLeanDirectionUsd
      ? totalStakeNetUsd != null && totalStakeNetUsd > 0
        ? 'min-w-[10.5rem] max-w-[10.5rem] text-[10px] leading-tight'
        : 'min-w-[6.75rem] max-w-[6.75rem] text-[10px] leading-tight'
      : 'w-[28px] text-[8px]';
    const leftLbl = compactLabel ?? 'Stake';
    const yFoot =
      neutralBar ? '—'
      : barMode === 'grossLegTotals'
        ? `Σ|YES| $${fmtUsd(sumYUsd)}`
        : `Y surplus $${fmtUsd(sumYUsd)}`;
    const nFoot =
      neutralBar ? '—'
      : barMode === 'grossLegTotals'
        ? `Σ|NO| $${fmtUsd(sumNUsd)}`
        : `N surplus $${fmtUsd(sumNUsd)}`;
    return (
      <div className="min-w-0 space-y-0.5">
        <div className={`flex items-center gap-1 min-w-0 ${dense ? '' : ''}`}>
          {compactOmitLeftLabel ? null : (
            <span className="text-[8px] text-gray-500 w-[38px] shrink-0 truncate" title={tip}>
              {leftLbl}
            </span>
          )}
          <div className="flex-1 min-w-0">{bar}</div>
          <span
            className={`font-bold shrink-0 tabular-nums text-right whitespace-nowrap ${leanColClass}${compactShowLeanDirectionUsd && !neutralBar && directionUsd != null ? '' : ` ${leanColor}`}`}
            title={leanRightTitle}
          >
            {leanRightContent}
          </span>
        </div>
        {compactLegUsdFooter ? (
          <div className="flex gap-1 min-w-0 items-baseline">
            {compactOmitLeftLabel ? null : <span className="w-[38px] shrink-0" aria-hidden />}
            <div
              className="flex flex-1 justify-between gap-2 min-w-0 text-[8px] tabular-nums leading-tight"
              title={`${yFoot} · ${nFoot}`}
            >
              <span className={`font-medium truncate ${neutralBar ? 'text-gray-500' : 'text-green-400'}`}>
                {neutralBar ? '—' : `Y $${fmtUsd(sumYUsd)}`}
              </span>
              <span className={`font-medium truncate text-right ${neutralBar ? 'text-gray-500' : 'text-red-400'}`}>
                {neutralBar ? '—' : `N $${fmtUsd(sumNUsd)}`}
              </span>
            </div>
            <span className={`shrink-0 ${compactShowLeanDirectionUsd ? (totalStakeNetUsd != null && totalStakeNetUsd > 0 ? 'min-w-[10.5rem]' : 'min-w-[6.75rem]') : 'w-[28px]'}`} aria-hidden />
          </div>
        ) : null}
      </div>
    );
  }

  const yLbl =
    neutralBar ? '—' : barMode === 'grossLegTotals' ? `Y $${fmtUsd(sumYUsd)}` : `Y net $${fmtUsd(sumYUsd)}`;
  const nLbl =
    neutralBar ? '—' : barMode === 'grossLegTotals' ? `N $${fmtUsd(sumNUsd)}` : `N net $${fmtUsd(sumNUsd)}`;
  const midTitle = neutralBar
    ? tip
    : barMode === 'grossLegTotals'
      ? `Σ legs $${fmtUsd(displayTotal)} · |ΣY−ΣN| $${fmtUsd(netAbs)}`
      : `Σᵢ|inv×px netᵢ| = $${fmtUsd(displayTotal)} (Top Holders only)`;

  return (
    <div className={dense ? 'shrink-0' : 'mb-2 shrink-0'}>
      <div className="flex justify-between items-center gap-1 text-[9px] text-gray-500 mb-0.5 px-0.5">
        <span
          className={`tabular-nums font-medium ${neutralBar ? 'text-gray-500' : 'text-green-400'}`}
          title={neutralBar ? tip : barMode === 'grossLegTotals' ? 'Σ|YES leg|' : 'Σ max(0, per-wallet net)'}
        >
          {yLbl}
        </span>
        <span className={`tabular-nums font-medium px-1 ${neutralBar ? 'text-gray-500' : 'text-gray-400'}`} title={midTitle}>
          {neutralBar ? '—' : `$${fmtUsd(displayTotal)}`}
        </span>
        <span
          className={`tabular-nums font-medium ${neutralBar ? 'text-gray-500' : 'text-red-400'}`}
          title={neutralBar ? tip : barMode === 'grossLegTotals' ? 'Σ|NO leg|' : 'Σ max(0, −per-wallet net)'}
        >
          {nLbl}
        </span>
      </div>
      {bar}
    </div>
  );
}
