import type { ComponentType, LazyExoticComponent } from 'react';
import { lazy } from 'react';

const STORAGE_KEY = 'mito.chunk-fail-reload';

function isChunkLoadError(e: unknown): boolean {
  if (!(e instanceof TypeError) && !(e instanceof Error)) return false;
  const m = String((e as Error).message || '');
  const n = (e as Error).name || '';
  return (
    n === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(m) ||
    /Importing a module script failed/i.test(m) ||
    /loading chunk \d+ failed/i.test(m)
  );
}

/** After a deploy, cached index may point at removed chunks — reload once to pull fresh index + assets. */
export async function importWithChunkReload<T>(importer: () => Promise<T>): Promise<T> {
  try {
    const mod = await importer();
    if (typeof window !== 'undefined') sessionStorage.removeItem(STORAGE_KEY);
    return mod;
  } catch (e) {
    if (typeof window === 'undefined') throw e;
    if (!isChunkLoadError(e)) throw e;
    if (!sessionStorage.getItem(STORAGE_KEY)) {
      sessionStorage.setItem(STORAGE_KEY, '1');
      window.location.reload();
      return new Promise(() => {}) as Promise<T>;
    }
    sessionStorage.removeItem(STORAGE_KEY);
    throw e;
  }
}

// Memo/lazy panel exports use concrete props; `any` keeps factories assignable without widening every panel.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithChunkReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => importWithChunkReload(factory));
}
