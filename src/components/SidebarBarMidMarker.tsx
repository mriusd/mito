import { memo } from 'react';

/** Tick at geometric 50% — parent row must be `relative`. */
export const SidebarBarMidMarker = memo(function SidebarBarMidMarker() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-0 z-10 h-full w-[1.5px] -translate-x-1/2 rounded-full bg-white/90 shadow-[0_0_1px_rgba(0,0,0,0.65)]"
    />
  );
});
