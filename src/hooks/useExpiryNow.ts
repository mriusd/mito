import { useSyncExternalStore } from 'react';
import { getExpiryTickNow, subscribeExpiryTick } from '../lib/expiryTickStore';

export function useExpiryNow(): number {
  return useSyncExternalStore(subscribeExpiryTick, getExpiryTickNow, getExpiryTickNow);
}
