import { useAppStore } from '../stores/appStore';

const DEFAULT_BACKEND_FETCH_MS = 8_000;
const CIRCUIT_OPEN_MS = 12_000;

export class BackendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendUnavailableError';
  }
}

export type FetchBackendOptions = {
  timeoutMs?: number;
  /** Health probe — allowed while backend marked down. */
  probe?: boolean;
};

let circuitOpenUntil = 0;

function isBackendTransportError(err: unknown): boolean {
  // Only hard network failures (connection refused / DNS / CORS) mark backend down.
  // AbortError = our own timeout on a slow endpoint — backend may be warming up; must NOT open circuit.
  if (err instanceof BackendUnavailableError) return false;
  return err instanceof TypeError;
}

/** WS feed retry delay: back off hard while backend marked down (avoids reconnect churn during restart). */
export function backendWsRetryDelayMs(baseMs: number): number {
  return useAppStore.getState().backendConnected === false ? Math.max(baseMs, 10_000) : baseMs;
}

export function markBackendRecovered(): void {
  circuitOpenUntil = 0;
}

function openBackendCircuit(): void {
  circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
  const store = useAppStore.getState();
  if (store.backendConnected !== false) {
    store.setBackendConnected(false);
  }
}

export function isBackendFetchAllowed(): boolean {
  const store = useAppStore.getState();
  if (store.backendConnected === false) return false;
  if (Date.now() < circuitOpenUntil) return false;
  return true;
}

export async function fetchBackend(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMsOrOpts: number | FetchBackendOptions = DEFAULT_BACKEND_FETCH_MS,
): Promise<Response> {
  const opts: FetchBackendOptions =
    typeof timeoutMsOrOpts === 'number' ? { timeoutMs: timeoutMsOrOpts } : timeoutMsOrOpts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_BACKEND_FETCH_MS;

  if (!opts.probe) {
    if (!isBackendFetchAllowed()) {
      throw new BackendUnavailableError('backend unavailable');
    }
  }

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  const ext = init?.signal;
  if (ext) {
    if (ext.aborted) ctrl.abort();
    else ext.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (!opts.probe && isBackendTransportError(err)) {
      openBackendCircuit();
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}
