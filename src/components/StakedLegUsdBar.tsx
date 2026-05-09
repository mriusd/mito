/** Horizontal bar: green vs red = share of net USD imbalance (typically YES-heavy vs NO-heavy leg surplus). */

function fmtUsd(absVal: number): string {
  return absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function StakedLegUsdBar({
  sumYUsd,
  sumNUsd,
  dense,
  compact,
}: {
  sumYUsd: number;
  sumNUsd: number;
  dense?: boolean;
  /** Match Sidebar MiniBar row (h-[5px], left label column). */
  compact?: boolean;
}) {
  const total = sumYUsd + sumNUsd;
  if (total <= 1e-9) return null;
  const pctY = (sumYUsd / total) * 100;
  const pctN = (sumNUsd / total) * 100;
  const lean = (sumYUsd - sumNUsd) / total; // [-1,1]; + = YES-heavy (same vibe as Sidebar MiniBar biases)
  const tip = `YES-heavy ${pctY.toFixed(1)}% ($${fmtUsd(sumYUsd)}) · NO-heavy ${pctN.toFixed(1)}% ($${fmtUsd(sumNUsd)}) · |net| $${fmtUsd(total)}`;

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
    return (
      <div className={`flex items-center gap-1 min-w-0 ${dense ? '' : ''}`}>
        <span className="text-[8px] text-gray-500 w-[38px] shrink-0 truncate" title={tip}>
          Stake
        </span>
        <div className="flex-1 min-w-0">{bar}</div>
        <span
          className={`text-[8px] font-bold w-[28px] shrink-0 tabular-nums text-right ${leanColor}`}
          title={`Imbalance: YES-heavy ${pctY.toFixed(1)}% vs NO-heavy ${pctN.toFixed(1)}%; |net| $${fmtUsd(total)}`}
        >
          {leanPct > 0 ? '+' : ''}
          {leanPct.toFixed(0)}%
        </span>
      </div>
    );
  }

  return (
    <div className={dense ? 'shrink-0' : 'mb-2 shrink-0'}>
      <div className="flex justify-between items-center gap-1 text-[9px] text-gray-500 mb-0.5 px-0.5">
        <span className="text-green-400 tabular-nums font-medium" title="YES-heavy imbalance (Σ|YES| − Σ|NO| surplus if positive; else cohort / market equivalent)">
          Y ${fmtUsd(sumYUsd)}
        </span>
        <span className="text-gray-400 tabular-nums" title="|net| USD imbalance (matches Staked pill for market-wide source)">
          ${fmtUsd(total)}
        </span>
        <span className="text-red-400 tabular-nums font-medium" title="NO-heavy imbalance (Σ|NO| − Σ|YES| surplus if positive)">
          N ${fmtUsd(sumNUsd)}
        </span>
      </div>
      {bar}
    </div>
  );
}
