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

/**
 * React.lazy wrapper that **starts** the import as soon as the panel module is registered
 * (DraggableCanvas load), not when Suspense first renders. Avoids stuck "Loading…" when
 * first paint races Vite / circular graphs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithChunkReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  let promise: Promise<{ default: T }> | null = null;
  const load = () => {
    if (!promise) promise = importWithChunkReload(factory);
    return promise;
  };
  // Eager kickoff at registration time.
  void load();
  return lazy(() => load());
}
