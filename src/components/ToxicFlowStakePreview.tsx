import { useMemo } from 'react';
import type { WalletPosition } from '../api';
import { StakedLegUsdBar } from './StakedLegUsdBar';
import { SidebarBarMidMarker } from './SidebarBarMidMarker';
import { toxicCohortStakedNetSurplusHalves } from '../lib/toxicFlowStakeCohort';

export function ToxicFlowStakePreview({
  label,
  wallets,
  flashExtremeTilt,
  extremeFlashTiltThreshold,
}: {
  label: string;
  wallets: readonly WalletPosition[];
  flashExtremeTilt?: boolean;
  extremeFlashTiltThreshold?: number;
}) {
  const { sumYUsd, sumNUsd } = useMemo(() => toxicCohortStakedNetSurplusHalves(wallets ?? []), [wallets]);
  const total = sumYUsd + sumNUsd;
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
