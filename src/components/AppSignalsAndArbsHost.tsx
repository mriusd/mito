import { memo } from 'react';
import { useSignalsAndArbs } from '../hooks/useSignalsAndArbs';

/** Isolate signal/arb recompute from App — must not subscribe price ticks on App. */
export const AppSignalsAndArbsHost = memo(function AppSignalsAndArbsHost() {
  useSignalsAndArbs();
  return null;
});
