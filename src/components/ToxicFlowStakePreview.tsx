import { useMemo } from 'react';
import type { WalletPosition } from '../api';
import { StakedLegUsdBar } from './StakedLegUsdBar';
import { HelpTooltip } from './HelpTooltip';
import { HelpCircle } from 'lucide-react';
import { toxicCohortStakedNetSurplusHalves } from '../lib/toxicFlowStakeCohort';

export function ToxicFlowStakePreview({
  label,
  wallets,
  flashExtremeTilt,
  extremeFlashTiltThreshold,
  helpText,
  layout = 'inline',
}: {
  label: string;
  wallets: readonly WalletPosition[];
  flashExtremeTilt?: boolean;
  extremeFlashTiltThreshold?: number;
  helpText?: string;
  layout?: 'inline' | 'stacked';
}) {
  const { sumYUsd, sumNUsd } = useMemo(() => toxicCohortStakedNetSurplusHalves(wallets ?? []), [wallets]);
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
      barMode="cohortSurplusHalves"
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
