import type { ComponentType, LazyExoticComponent } from 'react';
import { lazy } from 'react';

const STORAGE_KEY = 'mito.chunk-fail-reload';

function isAbortLike(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: string; message?: string };
  const n = String(err.name || '');
  const m = String(err.message || '');
  return (
    n === 'AbortError' ||
    /aborted/i.test(m) ||
    /AbortError/i.test(m) ||
    /The operation was aborted/i.test(m)
  );
}

function isChunkLoadError(e: unknown): boolean {
  if (!(e instanceof TypeError) && !(e instanceof Error)) return false;
  if (isAbortLike(e)) return false;
  const m = String((e as Error).message || '');
  const n = (e as Error).name || '';
  return (
    n === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(m) ||
    /Importing a module script failed/i.test(m) ||
    /loading chunk \d+ failed/i.test(m)
  );
}

/** Clear stuck reload flag from a previous tab (avoids odd HMR/session states). */
export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * After a deploy, cached index may point at removed chunks — reload once to pull fresh assets.
 * Never return a hanging promise: that parks every React.lazy panel in Suspense forever
 * ("Loading …" / black canvas).
 */
export async function importWithChunkReload<T>(importer: () => Promise<T>): Promise<T> {
  try {
    const mod = await importer();
    if (typeof window !== 'undefined') clearChunkReloadFlag();
    return mod;
  } catch (e) {
    if (typeof window === 'undefined') throw e;
    if (isAbortLike(e) || !isChunkLoadError(e)) throw e;
    try {
      if (!sessionStorage.getItem(STORAGE_KEY)) {
        sessionStorage.setItem(STORAGE_KEY, '1');
        window.location.reload();
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
    throw e;
  }
}

type LazyFactory<T extends ComponentType<unknown>> = () => Promise<{ default: T }>;

const preloadFns = new Map<string, () => Promise<unknown>>();

/**
 * React.lazy wrapper with chunk-reload recovery.
 *
 * - **Production:** eager-kickoff at registration (avoids Suspense races after deploy).
 * - **Vite DEV:** do NOT eager-import every panel — that compiles the whole panel graph
 *   up front and freezes local UI while production (pre-built chunks) stays fine.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithChunkReload<T extends ComponentType<any>>(
  factory: LazyFactory<T>,
  preloadKey?: string,
): LazyExoticComponent<T> {
  let promise: Promise<{ default: T }> | null = null;
  const load = () => {
    if (!promise) promise = importWithChunkReload(factory);
    return promise;
  };
  if (preloadKey) {
    preloadFns.set(preloadKey, load);
  }
  // Only eager-load in production builds. Vite DEV pays transform cost per module.
  if (import.meta.env.PROD) {
    void load();
  }
  return lazy(() => load());
}

/** Preload a panel chunk by type key (used after layout is known). */
export function preloadPanelChunk(panelType: string): void {
  const fn = preloadFns.get(panelType);
  if (fn) void fn();
}

/** Preload several panel types (idle). */
export function preloadPanelChunks(panelTypes: readonly string[]): void {
  const unique = [...new Set(panelTypes.filter(Boolean))];
  const run = () => {
    for (const t of unique) preloadPanelChunk(t);
  };
  if (typeof window === 'undefined') return;
  // Prefer requestIdleCallback when present; avoid `in` narrowing that makes the
  // else branch `never` under DOM libs where the method is always typed on Window.
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => run(), { timeout: 2000 });
  } else {
    window.setTimeout(run, 0);
  }
}
