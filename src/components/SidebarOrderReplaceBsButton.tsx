import { memo } from 'react';
import {
  sidebarBsMathButtonLabel,
  sidebarBsMathCentsForOutcome,
  useSidebarSpotStripBs,
} from '../lib/sidebarSpotStripStore';

const SIDEBAR_BS_MATH_BTN_CLASS =
  'bg-yellow-900/55 hover:bg-yellow-800/65 text-amber-200 disabled:pointer-events-none disabled:opacity-40';

export const SidebarOrderReplaceBsButton = memo(function SidebarOrderReplaceBsButton({
  outcome,
  onReplace,
}: {
  outcome: string | null | undefined;
  onReplace: (cents: number) => void;
}) {
  const spotBs = useSidebarSpotStripBs();
  const orderBsCents = spotBs?.pastExpiry
    ? null
    : sidebarBsMathCentsForOutcome(spotBs?.yesMathCents, outcome);

  return (
    <button
      type="button"
      disabled={orderBsCents == null}
      onClick={() => {
        if (orderBsCents == null) return;
        onReplace(orderBsCents);
      }}
      className={`text-[9px] px-1 py-0 rounded font-bold tabular-nums ${SIDEBAR_BS_MATH_BTN_CLASS}`}
      aria-label="Replace at BS math probability for order side"
      title="BS math"
    >
      {sidebarBsMathButtonLabel(orderBsCents)}
    </button>
  );
});
