export const MARKET_NOTIFY_MUTED_LS_KEY = 'polybot-market-notify-muted';

export const MARKET_NOTIFY_MUTED_CHANGED_EVENT = 'polybot-market-notify-muted-changed';

function marketKey(marketId: string): string {
  return marketId.trim();
}

export function getMarketNotifyMutedSnapshot(): string {
  try {
    return localStorage.getItem(MARKET_NOTIFY_MUTED_LS_KEY) ?? '[]';
  } catch {
    return '[]';
  }
}

export function readMutedMarketIds(): Set<string> {
  try {
    const raw = getMarketNotifyMutedSnapshot();
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x).trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function isMarketNotifyMuted(marketId: string): boolean {
  const k = marketKey(marketId);
  if (!k) return false;
  return readMutedMarketIds().has(k);
}

/** Toggle mute for one market. Returns true if now muted. */
export function toggleMarketNotifyMuted(marketId: string): boolean {
  const k = marketKey(marketId);
  if (!k) return false;
  const next = readMutedMarketIds();
  let muted: boolean;
  if (next.has(k)) {
    next.delete(k);
    muted = false;
  } else {
    next.add(k);
    muted = true;
  }
  try {
    localStorage.setItem(MARKET_NOTIFY_MUTED_LS_KEY, JSON.stringify([...next].sort()));
  } catch {
    return muted;
  }
  window.dispatchEvent(new Event(MARKET_NOTIFY_MUTED_CHANGED_EVENT));
  return muted;
}

export function subscribeMarketNotifyMuted(listener: () => void): () => void {
  const onChange = () => listener();
  const onStorage = (e: StorageEvent) => {
    if (e.key === MARKET_NOTIFY_MUTED_LS_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(MARKET_NOTIFY_MUTED_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(MARKET_NOTIFY_MUTED_CHANGED_EVENT, onChange);
  };
}
