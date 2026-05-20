import { memo, useMemo, type MutableRefObject } from 'react';
import { CirclePercent } from 'lucide-react';
import type { SidebarPolymarketBookSnapshot } from './SidebarPolymarketOBHost';
import { useSidebarTopOfBookDigest } from '../lib/sidebarTopOfBookStore';

export const SidebarSpotStripMathButton = memo(function SidebarSpotStripMathButton({
  mathCents,
  sidebarBookRef,
  onPickPrice,
}: {
  mathCents: number;
  sidebarBookRef: MutableRefObject<SidebarPolymarketBookSnapshot | null>;
  onPickPrice: (cents: string) => void;
}) {
  const topOfBookDigest = useSidebarTopOfBookDigest();
  const bsColor = useMemo(() => {
    void topOfBookDigest;
    const obAsks = sidebarBookRef.current?.displayAsks ?? [];
    const bestAsk = obAsks.length > 0 ? parseFloat(obAsks[0].price) * 100 : null;
    if (bestAsk == null) return 'text-yellow-400';
    if (bestAsk < mathCents * 0.95) return 'text-green-400';
    if (bestAsk > mathCents * 1.05) return 'text-red-400';
    return 'text-yellow-400';
  }, [mathCents, sidebarBookRef, topOfBookDigest]);

  return (
    <button
      type="button"
      className={`inline-flex max-w-full items-center justify-center gap-0.5 whitespace-nowrap rounded-none border-0 bg-transparent p-0 text-[11px] font-bold font-sans tabular-nums shadow-none outline-none ring-0 ${bsColor} cursor-pointer hover:underline focus-visible:ring-1 focus-visible:ring-amber-500/60`}
      onClick={() => onPickPrice(mathCents.toFixed(1))}
    >
      <CirclePercent className="h-2.5 w-2.5 shrink-0 opacity-90" strokeWidth={2.5} aria-hidden />
      <span>{mathCents.toFixed(1)}</span>
    </button>
  );
});
