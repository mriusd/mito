/** Bump when sidebar OB top-of-book changes — ref store avoids full Sidebar re-render. */
let digest = 0;
const listeners = new Set<() => void>();

export function bumpSidebarTopOfBookDigest(): void {
  digest += 1;
  for (const fn of listeners) fn();
}

export function subscribeSidebarTopOfBookDigest(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function getSidebarTopOfBookDigest(): number {
  return digest;
}
