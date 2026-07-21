import { useAppStore } from '../stores/appStore';

const DEFAULT_BACKEND_FETCH_MS = 8_000;
/** Short fetch backoff after transport errors — does not by itself show the banner. */
const CIRCUIT_OPEN_MS = 12_000;
/** Consecutive hard failures before flipping `backendConnected` (banner). */
const UI_DOWN_STRIKES = 3;
/** Strikes older than this window are dropped (transient blips). */
const STRIKE_WINDOW_MS = 45_000;

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
let failStrikeTs: number[] = [];

function pruneStrikes(now: number): void {
  failStrikeTs = failStrikeTs.filter((t) => now - t < STRIKE_WINDOW_MS);
}

function noteFailureStrike(): void {
  const now = Date.now();
  pruneStrikes(now);
  failStrikeTs.push(now);
  circuitOpenUntil = now + CIRCUIT_OPEN_MS;
  if (failStrikeTs.length < UI_DOWN_STRIKES) return;
  const store = useAppStore.getState();
  if (store.backendConnected !== false) {
    store.setBackendConnected(false);
  }
}

function isBackendTransportError(err: unknown): boolean {
  // Only hard network failures (connection refused / DNS / CORS) count as transport.
  // AbortError = our own timeout on a slow endpoint — backend may be warming up.
  if (err instanceof BackendUnavailableError) return false;
  return err instanceof TypeError;
}

/** WS feed retry delay: back off hard while backend marked down (avoids reconnect churn during restart). */
export function backendWsRetryDelayMs(baseMs: number): number {
  return useAppStore.getState().backendConnected === false ? Math.max(baseMs, 10_000) : baseMs;
}

export function markBackendRecovered(): void {
  circuitOpenUntil = 0;
  failStrikeTs = [];
}

/** WS reconnected — clear transient WS/HTTP fail strikes so a blip cannot keep the banner armed. */
export function markBackendWsUp(): void {
  failStrikeTs = [];
  circuitOpenUntil = 0;
}

/**
 * WS close / refused. Counts toward UI-down only after several failures in a short window.
 * A single reconnect blip must not flash the red banner.
 */
export function markBackendDownFromWs(): void {
  noteFailureStrike();
}

/** HTTP health-probe / markets failure — same strike logic as WS. */
export function markBackendDownFromHttp(): void {
  noteFailureStrike();
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
      noteFailureStrike();
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}
