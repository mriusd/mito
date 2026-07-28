import type { PanelConfig } from '../types';
import type { PersistedGridLayouts } from '../stores/appStore';

export const MITO_LAYOUT_SCHEMA = 'mito-layout' as const;
/** Matches appStore LAYOUT_VERSION for future migrations. */
export const MITO_LAYOUT_FILE_VERSION = 9;

export type MitoLayoutExport = {
  schema: typeof MITO_LAYOUT_SCHEMA;
  version: number;
  exportedAt: string;
  panels: PanelConfig[];
  layouts: PersistedGridLayouts | null;
  removedPanels: string[];
};

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

export function buildLayoutExport(
  panels: PanelConfig[],
  layouts: PersistedGridLayouts | null,
): MitoLayoutExport {
  return {
    schema: MITO_LAYOUT_SCHEMA,
    version: MITO_LAYOUT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    panels,
    layouts,
    removedPanels: readRemovedPanels(),
  };
}

export function downloadLayoutFile(panels: PanelConfig[], layouts: PersistedGridLayouts | null): void {
  const payload = buildLayoutExport(panels, layouts);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `mito-layout-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function isPanelConfig(v: unknown): v is PanelConfig {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.type === 'string' && typeof o.title === 'string';
}

export function parseLayoutImport(raw: string): MitoLayoutExport {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON');
  }
  if (!data || typeof data !== 'object') throw new Error('Invalid layout file');
  const o = data as Record<string, unknown>;
  if (o.schema !== MITO_LAYOUT_SCHEMA) throw new Error('Not a mito layout file');
  if (!Array.isArray(o.panels) || !o.panels.every(isPanelConfig)) {
    throw new Error('Missing or invalid panels');
  }
  if (o.layouts != null && typeof o.layouts !== 'object') {
    throw new Error('Invalid layouts');
  }
  const removed = Array.isArray(o.removedPanels)
    ? o.removedPanels.filter((x): x is string => typeof x === 'string')
    : [];
  return {
    schema: MITO_LAYOUT_SCHEMA,
    version: typeof o.version === 'number' ? o.version : MITO_LAYOUT_FILE_VERSION,
    exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : new Date().toISOString(),
    panels: o.panels as PanelConfig[],
    layouts: (o.layouts as PersistedGridLayouts) ?? null,
    removedPanels: removed,
  };
}

/** Persist import and reload so DraggableCanvas picks removed-panels + layout. */
export function applyLayoutImport(file: MitoLayoutExport): void {
  localStorage.setItem('polybot-react-panels', JSON.stringify(file.panels));
  if (file.layouts) {
    localStorage.setItem('polybot-react-layouts', JSON.stringify(file.layouts));
  } else {
    localStorage.removeItem('polybot-react-layouts');
  }
  if (file.removedPanels.length > 0) {
    localStorage.setItem('polybot-removed-panels', JSON.stringify(file.removedPanels));
  } else {
    localStorage.removeItem('polybot-removed-panels');
  }
  localStorage.setItem('polybot-layout-version', String(MITO_LAYOUT_FILE_VERSION));
  window.location.reload();
}
