import { memo } from 'react';
import {
  roundSidebarBsMathCents,
  sidebarBsMathButtonLabel,
  useSidebarSpotStripBs,
} from '../lib/sidebarSpotStripStore';

const SIDEBAR_BS_MATH_BTN_CLASS =
  'bg-yellow-900/55 hover:bg-yellow-800/65 text-amber-200 disabled:pointer-events-none disabled:opacity-40';

export const SidebarOrderBsMathButton = memo(function SidebarOrderBsMathButton({
  orderKind,
  onPickPrice,
}: {
  orderKind: 'limit' | 'market';
  onPickPrice: (cents: string) => void;
}) {
  const spotBs = useSidebarSpotStripBs();
  const limitBsCents = roundSidebarBsMathCents(spotBs?.mathCents);

  return (
    <button
      type="button"
      className={`${SIDEBAR_BS_MATH_BTN_CLASS} rounded text-[9px] font-bold h-6 tabular-nums`}
      disabled={orderKind === 'market' || limitBsCents == null}
      onClick={() => {
        if (orderKind === 'market' || limitBsCents == null) return;
        onPickPrice(String(limitBsCents));
      }}
      aria-label="Set price to BS math probability for current side"
      title="BS math"
    >
      {sidebarBsMathButtonLabel(limitBsCents)}
    </button>
  );
});
