let refreshImpl: (() => Promise<void>) | null = null;

export function setAppRefreshFn(fn: (() => Promise<void>) | null): void {
  refreshImpl = fn;
}

export async function runAppRefresh(): Promise<void> {
  await refreshImpl?.();
}
