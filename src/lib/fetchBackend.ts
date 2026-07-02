const DEFAULT_BACKEND_FETCH_MS = 8_000;

export async function fetchBackend(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_BACKEND_FETCH_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  const ext = init?.signal;
  if (ext) {
    if (ext.aborted) ctrl.abort();
    else ext.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    window.clearTimeout(timer);
  }
}
