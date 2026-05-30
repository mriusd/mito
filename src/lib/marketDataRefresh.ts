let refreshImpl: (() => void) | null = null;

export function setMarketDataRefreshFn(fn: (() => void) | null): void {
  refreshImpl = fn;
}

export function triggerMarketDataRefresh(): void {
  refreshImpl?.();
}
