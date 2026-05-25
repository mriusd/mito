import { memo, type MutableRefObject } from 'react';
import { CirclePercent } from 'lucide-react';
import { CHART_MATH_PROB_COLOR } from '../lib/chartCandleEnrichment';
import type { SidebarPolymarketBookSnapshot } from './SidebarPolymarketOBHost';

export const SidebarSpotStripMathButton = memo(function SidebarSpotStripMathButton({
  mathCents,
  sidebarBookRef: _sidebarBookRef,
  onPickPrice,
}: {
  mathCents: number;
  sidebarBookRef: MutableRefObject<SidebarPolymarketBookSnapshot | null>;
  onPickPrice: (cents: string) => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center justify-center gap-0.5 whitespace-nowrap rounded-none border-0 bg-transparent p-0 text-[11px] font-bold font-sans tabular-nums shadow-none outline-none ring-0 cursor-pointer hover:underline focus-visible:ring-1 focus-visible:ring-amber-500/60"
      style={{ color: CHART_MATH_PROB_COLOR }}
      onClick={() => onPickPrice(mathCents.toFixed(1))}
    >
      <CirclePercent className="h-2.5 w-2.5 shrink-0 opacity-90" strokeWidth={2.5} aria-hidden />
      <span>{mathCents.toFixed(1)}</span>
    </button>
  );
});
