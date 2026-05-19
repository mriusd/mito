import { memo, useMemo } from 'react';
import type { WalletPosition } from '../api';
import { StakedLegUsdBar } from './StakedLegUsdBar';
import { HelpTooltip } from './HelpTooltip';
import { HelpCircle } from 'lucide-react';
import { toxicCohortStakedNetSurplusHalves } from '../lib/toxicFlowStakeCohort';

/** Human copy: market-wide gross YES vs NO legs (all wallets). */
export const TOXIC_TOTAL_STAKE_BAR_HELP =
  'Total dollars staked on this market across all wallets. Green = more on YES, red = more on NO.';

function walletsPreviewPropEqual(a: readonly WalletPosition[], b: readonly WalletPosition[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function ToxicFlowStakePreviewInner({
  label,
  wallets = [],
  marketGrossLegsUsd,
  flashExtremeTilt,
  extremeFlashTiltThreshold,
  helpText,
  layout = 'inline',
}: {
  label: string;
  wallets?: readonly WalletPosition[];
  marketGrossLegsUsd?: { stakedUsdYesLeg: number; stakedUsdNoLeg: number } | null;
  flashExtremeTilt?: boolean;
  extremeFlashTiltThreshold?: number;
  helpText?: string;
  layout?: 'inline' | 'stacked';
}) {
  const { sumYUsd, sumNUsd, barMode } = useMemo(() => {
    const g = marketGrossLegsUsd;
    if (
      g &&
      typeof g.stakedUsdYesLeg === 'number' &&
      Number.isFinite(g.stakedUsdYesLeg) &&
      typeof g.stakedUsdNoLeg === 'number' &&
      Number.isFinite(g.stakedUsdNoLeg)
    ) {
      return {
        sumYUsd: g.stakedUsdYesLeg,
        sumNUsd: g.stakedUsdNoLeg,
        barMode: 'grossLegTotals' as const,
      };
    }
    const c = toxicCohortStakedNetSurplusHalves(wallets ?? []);
    return { sumYUsd: c.sumYUsd, sumNUsd: c.sumNUsd, barMode: 'cohortSurplusHalves' as const };
  }, [marketGrossLegsUsd, wallets]);
  const total = sumYUsd + sumNUsd;
  const hasSplit = Number.isFinite(sumYUsd) && Number.isFinite(sumNUsd) && total > 1e-9;

  const helpIcon =
    layout === 'stacked' && helpText != null && helpText !== '' ? (
      <HelpTooltip text={helpText} openOnHover wrapClassName="inline-flex shrink-0 items-center leading-none">
        <HelpCircle className="h-3 w-3 text-gray-500 hover:text-gray-300 cursor-help" strokeWidth={2} aria-label="Help" />
      </HelpTooltip>
    ) : null;

  const innerBar = (
    <StakedLegUsdBar
      sumYUsd={hasSplit ? sumYUsd : 0}
      sumNUsd={hasSplit ? sumNUsd : 0}
      compact
      dense
      compactLabel={layout === 'inline' ? label : ''}
      compactOmitLeftLabel={layout === 'stacked'}
      barMode={barMode}
      midMarker
      flashExtremeTilt={!!flashExtremeTilt && hasSplit}
      extremeFlashTiltThreshold={extremeFlashTiltThreshold ?? 0.3}
    />
  );

  if (layout === 'stacked') {
    return (
      <div className="w-full min-w-0 flex items-center gap-1.5">
        <div className="flex shrink-0 items-center gap-0.5 w-[54px] min-w-[54px]" title={label}>
          <span className="text-[8px] uppercase tracking-wide text-gray-500 truncate min-w-0">{label}</span>
          {helpIcon}
        </div>
        <div className="flex-1 min-w-0">{innerBar}</div>
      </div>
    );
  }

  return <div className="min-w-0 space-y-0.5">{innerBar}</div>;
}

export const ToxicFlowStakePreview = memo(ToxicFlowStakePreviewInner, (a, b) => {
  if (
    a.label !== b.label ||
    a.flashExtremeTilt !== b.flashExtremeTilt ||
    a.extremeFlashTiltThreshold !== b.extremeFlashTiltThreshold ||
    a.helpText !== b.helpText ||
    a.layout !== b.layout
  ) {
    return false;
  }
  const ga = a.marketGrossLegsUsd;
  const gb = b.marketGrossLegsUsd;
  if (ga !== gb) {
    if (ga == null || gb == null) return ga === gb;
    if (ga.stakedUsdYesLeg !== gb.stakedUsdYesLeg || ga.stakedUsdNoLeg !== gb.stakedUsdNoLeg) return false;
  }
  return walletsPreviewPropEqual(a.wallets ?? [], b.wallets ?? []);
});
