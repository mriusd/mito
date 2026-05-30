import type { Signal } from '../types';
import { useGridSignals } from '../lib/gridSignalsStore';

/** @deprecated use useGridSignals — kept for call sites */
export function useThrottledGridSignals(_ms = 2000): Signal[] {
  return useGridSignals();
}
