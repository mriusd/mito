import { useMemo } from 'react';
import type { WalletPosition } from '../api';
import { StakedLegUsdBar } from './StakedLegUsdBar';
import { SidebarBarMidMarker } from './SidebarBarMidMarker';
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

  const helpIcon =
    layout === 'stacked' && helpText != null && helpText !== '' ? (
      <HelpTooltip text={helpText} openOnHover wrapClassName="inline-flex shrink-0 items-center leading-none">
        <HelpCircle className="h-3 w-3 text-gray-500 hover:text-gray-300 cursor-help" strokeWidth={2} aria-label="Help" />
      </HelpTooltip>
    ) : null;

  if (layout === 'stacked') {
    return (
      <div className="w-full min-w-0 space-y-1">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[8px] uppercase tracking-wide text-gray-500 truncate" title={label}>
            {label}
          </span>
          {helpIcon}
        </div>
        {total <= 1e-9 ? (
          <div className="relative h-[5px] rounded-full bg-gray-800/90 overflow-hidden w-full" title="No staked net in cohort">
            <SidebarBarMidMarker />
          </div>
        ) : (
          <StakedLegUsdBar
            sumYUsd={sumYUsd}
            sumNUsd={sumNUsd}
            compact
            dense
            compactLabel={label}
            compactOmitLeftLabel
            barMode="cohortSurplusHalves"
            midMarker
            flashExtremeTilt={!!flashExtremeTilt}
            extremeFlashTiltThreshold={extremeFlashTiltThreshold ?? 0.3}
          />
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-0.5">
      {total <= 1e-9 ? (
        <>
          <div className="text-[8px] text-gray-500 truncate" title={label}>
            {label}
          </div>
          <div className="relative h-[5px] rounded-full bg-gray-800/90 overflow-hidden" title="No staked net in cohort">
            <SidebarBarMidMarker />
          </div>
        </>
      ) : (
        <StakedLegUsdBar
          sumYUsd={sumYUsd}
          sumNUsd={sumNUsd}
          compact
          dense
          compactLabel={label}
          barMode="cohortSurplusHalves"
          midMarker
          flashExtremeTilt={!!flashExtremeTilt}
          extremeFlashTiltThreshold={extremeFlashTiltThreshold ?? 0.3}
        />
      )}
    </div>
  );
}
