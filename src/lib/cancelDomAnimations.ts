import { useEffect, type RefObject } from 'react';

/** Stop CSS animations so detached nodes can GC (infinite animations retain DOM). */
export function cancelDomAnimations(el: HTMLElement | null | undefined): void {
  if (!el) return;
  el.style.animation = 'none';
  el.getAnimations?.().forEach((a) => a.cancel());
}

export function useCancelDomAnimationsOnUnmount(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => () => cancelDomAnimations(ref.current), [ref]);
}
