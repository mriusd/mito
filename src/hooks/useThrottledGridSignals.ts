import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import type { Signal } from '../types';

const EMPTY_SIGNALS: Signal[] = [];

export function useThrottledGridSignals(ms = 2000): Signal[] {
  const signalsOnGrid = useAppStore((s) => s.signalsOnGrid);
  const live = useAppStore((s) => (s.signalsOnGrid ? s.signals : EMPTY_SIGNALS));
  const [throttled, setThrottled] = useState(live);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    if (!signalsOnGrid) {
      setThrottled(EMPTY_SIGNALS);
      return;
    }
    const id = window.setTimeout(() => setThrottled(liveRef.current), ms);
    return () => window.clearTimeout(id);
  }, [live, ms, signalsOnGrid]);

  return signalsOnGrid ? throttled : EMPTY_SIGNALS;
}
