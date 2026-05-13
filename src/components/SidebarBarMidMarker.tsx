import { memo } from 'react';

const TICK =
  'pointer-events-none absolute top-0 z-10 h-full w-[2px] -translate-x-1/2 rounded-full bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.45),0_0_3px_rgba(0,0,0,0.85)]';

/** 25%, 50%, 75% geometric ticks — parent track must be `relative`. */
export const SidebarBarMidMarker = memo(function SidebarBarMidMarker() {
  return (
    <>
      <span aria-hidden className={`${TICK} left-[25%]`} />
      <span aria-hidden className={`${TICK} left-1/2`} />
      <span aria-hidden className={`${TICK} left-[75%]`} />
    </>
  );
});
