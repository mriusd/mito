import type { PanelConfig } from '../types';
import type { PersistedGridLayouts } from '../stores/appStore';
import {
  MITO_LAYOUT_FILE_VERSION,
  MITO_LAYOUT_SCHEMA,
  type MitoLayoutExport,
  buildLayoutExport,
  parseLayoutImport,
} from './layoutExport';
import { LAYOUT_VERSION } from './layoutVersion';

const LIBRARY_KEY = 'polybot-layout-library';
const ACTIVE_ID_KEY = 'polybot-active-layout-id';

export type SavedLayout = {
  id: string;
  name: string;
  panels: PanelConfig[];
  layouts: PersistedGridLayouts | null;
  removedPanels: string[];
  updatedAt: string;
};

type LayoutLibrary = {
  layouts: SavedLayout[];
};

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readRemovedPanels(): string[] {
  try {
    const raw = localStorage.getItem('polybot-removed-panels');
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function readLibrary(): LayoutLibrary {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return { layouts: [] };
    const parsed = JSON.parse(raw) as LayoutLibrary;
    if (!parsed || !Array.isArray(parsed.layouts)) return { layouts: [] };
    const layouts = parsed.layouts.filter(
      (l): l is SavedLayout =>
        !!l &&
        typeof l.id === 'string' &&
        typeof l.name === 'string' &&
        Array.isArray(l.panels),
    );
    return { layouts };
  } catch {
    return { layouts: [] };
  }
}

function writeLibrary(lib: LayoutLibrary): void {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
}

export function listSavedLayouts(): SavedLayout[] {
  return readLibrary().layouts;
}

export function getActiveLayoutId(): string | null {
  const id = localStorage.getItem(ACTIVE_ID_KEY);
  if (!id) return null;
  if (!readLibrary().layouts.some((l) => l.id === id)) return null;
  return id;
}

export function captureCurrentLayout(): Omit<SavedLayout, 'id' | 'name'> {
  let panels: PanelConfig[] = [];
  let layouts: PersistedGridLayouts | null = null;
  try {
    const p = localStorage.getItem('polybot-react-panels');
    if (p) panels = JSON.parse(p) as PanelConfig[];
  } catch {
    /* ignore */
  }
  try {
    const l = localStorage.getItem('polybot-react-layouts');
    if (l) layouts = JSON.parse(l) as PersistedGridLayouts;
  } catch {
    /* ignore */
  }
  return {
    panels,
    layouts,
    removedPanels: readRemovedPanels(),
    updatedAt: new Date().toISOString(),
  };
}

/** Persist live grid into the active named layout (no-op if none active). */
export function snapshotActiveLayout(): void {
  const activeId = getActiveLayoutId();
  if (!activeId) return;
  const lib = readLibrary();
  const idx = lib.layouts.findIndex((l) => l.id === activeId);
  if (idx < 0) return;
  const snap = captureCurrentLayout();
  lib.layouts[idx] = { ...lib.layouts[idx], ...snap };
  writeLibrary(lib);
}

export function saveCurrentLayoutAs(name: string): SavedLayout {
  const trimmed = name.trim() || `Layout ${readLibrary().layouts.length + 1}`;
  const snap = captureCurrentLayout();
  const entry: SavedLayout = {
    id: newId(),
    name: trimmed,
    ...snap,
  };
  const lib = readLibrary();
  lib.layouts.push(entry);
  writeLibrary(lib);
  localStorage.setItem(ACTIVE_ID_KEY, entry.id);
  return entry;
}

export function renameSavedLayout(id: string, name: string): void {
  const next = name.trim();
  if (!next) return;
  const lib = readLibrary();
  const idx = lib.layouts.findIndex((l) => l.id === id);
  if (idx < 0) return;
  lib.layouts[idx] = { ...lib.layouts[idx], name: next };
  writeLibrary(lib);
}

export function deleteSavedLayout(id: string): void {
  const lib = readLibrary();
  lib.layouts = lib.layouts.filter((l) => l.id !== id);
  writeLibrary(lib);
  if (localStorage.getItem(ACTIVE_ID_KEY) === id) {
    localStorage.removeItem(ACTIVE_ID_KEY);
  }
}

function writeLiveLayout(entry: Pick<SavedLayout, 'panels' | 'layouts' | 'removedPanels'>): void {
  localStorage.setItem('polybot-react-panels', JSON.stringify(entry.panels));
  if (entry.layouts) {
    localStorage.setItem('polybot-react-layouts', JSON.stringify(entry.layouts));
  } else {
    localStorage.removeItem('polybot-react-layouts');
  }
  if (entry.removedPanels.length > 0) {
    localStorage.setItem('polybot-removed-panels', JSON.stringify(entry.removedPanels));
  } else {
    localStorage.removeItem('polybot-removed-panels');
  }
  localStorage.setItem('polybot-layout-version', String(LAYOUT_VERSION));
}

/** Switch to named layout (snapshots current into previous active first). Reloads. */
export function switchToSavedLayout(id: string): void {
  const lib = readLibrary();
  const entry = lib.layouts.find((l) => l.id === id);
  if (!entry) throw new Error('Layout not found');
  snapshotActiveLayout();
  writeLiveLayout(entry);
  localStorage.setItem(ACTIVE_ID_KEY, entry.id);
  window.location.reload();
}

/** Import file into library; optionally apply + reload. */
export function importLayoutToLibrary(
  raw: string,
  name: string,
  apply: boolean,
): SavedLayout {
  const file = parseLayoutImport(raw);
  const trimmed = name.trim() || `Imported ${new Date().toISOString().slice(0, 10)}`;
  const entry: SavedLayout = {
    id: newId(),
    name: trimmed,
    panels: file.panels,
    layouts: file.layouts,
    removedPanels: file.removedPanels,
    updatedAt: file.exportedAt || new Date().toISOString(),
  };
  const lib = readLibrary();
  lib.layouts.push(entry);
  writeLibrary(lib);
  if (apply) {
    snapshotActiveLayout();
    writeLiveLayout(entry);
    localStorage.setItem(ACTIVE_ID_KEY, entry.id);
    window.location.reload();
  }
  return entry;
}

export function exportSavedLayoutFile(entry: SavedLayout): MitoLayoutExport {
  return {
    schema: MITO_LAYOUT_SCHEMA,
    version: MITO_LAYOUT_FILE_VERSION,
    exportedAt: entry.updatedAt,
    panels: entry.panels,
    layouts: entry.layouts,
    removedPanels: entry.removedPanels,
  };
}

/** Keep live export helper used by Header download. */
export function downloadCurrentLayoutFile(
  panels: PanelConfig[],
  layouts: PersistedGridLayouts | null,
): void {
  const payload = buildLayoutExport(panels, layouts);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  const active = getActiveLayoutId();
  const named = active ? readLibrary().layouts.find((l) => l.id === active)?.name : null;
  const slug = (named || 'layout').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40);
  a.href = url;
  a.download = `mito-${slug}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
