import { memo } from 'react';

const TICK =
  'pointer-events-none absolute top-0 z-10 h-full w-[1.5px] -translate-x-1/2 rounded-full shadow-[0_0_1px_rgba(0,0,0,0.65)]';

/** 25%, 50%, 75% geometric ticks — parent track must be `relative`. */
export const SidebarBarMidMarker = memo(function SidebarBarMidMarker() {
  return (
    <>
      <span aria-hidden className={`${TICK} left-[25%] bg-white/72`} />
      <span aria-hidden className={`${TICK} left-1/2 bg-white/92`} />
      <span aria-hidden className={`${TICK} left-[75%] bg-white/72`} />
    </>
  );
});
