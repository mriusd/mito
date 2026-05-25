import { useEffect, useState } from 'react';
import type { LiveTrade } from './usePolymarketOB';
import { usePolymarketChartTrades } from './usePolymarketChartTrades';

function tapeHeadEqual(a: LiveTrade[], b: LiveTrade[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  const p0 = a[0];
  const t0 = b[0];
  return p0.id === t0.id && p0.timestamp === t0.timestamp && p0.size === t0.size;
}

/** Chart tape — coalesce WS bursts; live trades list stays unthrottled. */
export function useThrottledPolymarketChartTrades(ms = 500): LiveTrade[] {
  const live = usePolymarketChartTrades();
  const [throttled, setThrottled] = useState(live);

  useEffect(() => {
    let latest = live;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      setThrottled((prev) => (tapeHeadEqual(prev, latest) ? prev : latest));
    };

    const schedule = () => {
      latest = live;
      if (timer != null) return;
      timer = setTimeout(flush, ms);
    };

    schedule();

    return () => {
      if (timer != null) clearTimeout(timer);
    };
  }, [live, ms]);

  return throttled;
}
