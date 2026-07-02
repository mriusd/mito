export const BACKEND_RECONNECT_EVENT = 'polybot:backend-reconnect';

export function notifyBackendReconnect(): void {
  window.dispatchEvent(new Event(BACKEND_RECONNECT_EVENT));
}

export function onBackendReconnect(listener: () => void): () => void {
  window.addEventListener(BACKEND_RECONNECT_EVENT, listener);
  return () => window.removeEventListener(BACKEND_RECONNECT_EVENT, listener);
}
