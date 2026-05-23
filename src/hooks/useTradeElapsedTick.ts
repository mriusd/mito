import { useEffect, useState } from 'react';

/** Tick every 5s (+ once on enable) so trade elapsed labels stay fresh. */
export function useTradeElapsedTick(enabled: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const id = window.setInterval(tick, 5000);
    return () => window.clearInterval(id);
  }, [enabled]);

  return nowMs;
}
