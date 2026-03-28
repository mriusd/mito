import type { Market } from '../types';

export type GridDir = 'up' | 'down' | 'left' | 'right';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return !!el.closest('input, textarea, select, [contenteditable="true"]');
}

function marketCellsInRow(tr: HTMLTableRowElement): HTMLTableCellElement[] {
  return Array.from(tr.querySelectorAll(':scope > td.market-cell')) as HTMLTableCellElement[];
}

function escapeAttrSelector(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function findMarketCellEl(marketId: string): HTMLTableCellElement | null {
  const selected = document.querySelectorAll('td.market-cell.selected');
  for (const n of selected) {
    const td = n as HTMLTableCellElement;
    if (td.dataset.marketId === marketId) return td;
  }
  if (selected.length === 1) return selected[0] as HTMLTableCellElement;
  return document.querySelector(
    `td.market-cell[data-market-id="${escapeAttrSelector(marketId)}"]`,
  ) as HTMLTableCellElement | null;
}

export function adjacentMarketCell(cell: HTMLTableCellElement, dir: GridDir): HTMLTableCellElement | null {
  const row = cell.parentElement;
  if (!row || row.tagName !== 'TR') return null;
  const tbody = row.parentElement;
  if (!tbody || tbody.tagName !== 'TBODY') return null;
  const rows = Array.from(tbody.querySelectorAll(':scope > tr')) as HTMLTableRowElement[];
  const rowIdx = rows.indexOf(row as HTMLTableRowElement);
  if (rowIdx === -1) return null;
  const cells = marketCellsInRow(row as HTMLTableRowElement);
  const colIdx = cells.indexOf(cell);
  if (colIdx === -1) return null;

  if (dir === 'left' && colIdx > 0) return cells[colIdx - 1];
  if (dir === 'right' && colIdx < cells.length - 1) return cells[colIdx + 1];

  if (dir === 'up') {
    for (let r = rowIdx - 1; r >= 0; r--) {
      const c = marketCellsInRow(rows[r])[colIdx];
      if (c) return c;
    }
  }
  if (dir === 'down') {
    for (let r = rowIdx + 1; r < rows.length; r++) {
      const c = marketCellsInRow(rows[r])[colIdx];
      if (c) return c;
    }
  }
  return null;
}

export function marketFromLookupById(lookup: Record<string, Market>, id: string): Market | null {
  for (const m of Object.values(lookup)) {
    if (m.id === id) return m;
  }
  return null;
}

export function gridDirFromKey(key: string): GridDir | null {
  if (key === 'ArrowUp' || key === 'w' || key === 'W') return 'up';
  if (key === 'ArrowDown' || key === 's' || key === 'S') return 'down';
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return 'left';
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'right';
  return null;
}

export function shouldIgnoreGridKeyEvent(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  if (isTypingTarget(e.target)) return true;
  return false;
}
