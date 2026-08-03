import { useEffect, useState } from 'react';

import {
  addPkWallet,
  clearAllPkWallets,
  getActivePkWallet,
  getStoredPrivateKey,
  listPkWallets,
  removePkWallet,
  renamePkWallet,
  setActivePkWallet,
  type PkWallet,
} from '../lib/pkWallets';

export {
  clearStoredPrivateKey,
  getStoredPrivateKey,
} from '../lib/pkWallets';

export const OPEN_PK_MANAGER_EVENT = 'polybot-open-pk-manager';

export function openPkWalletManager(): void {
  window.dispatchEvent(new Event(OPEN_PK_MANAGER_EVENT));
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export interface PrivateKeyWalletMenuProps {
  /** Called after select/add succeeds (switch to PK mode). */
  onDone: () => void;
  /** Called when user closes without an active key, or clears all. */
  onCancel: () => void;
  /** Bump parent label / hasPk when list changes without leaving PK mode. */
  onListChange?: () => void;
}

/**
 * Compact PK wallet picker for header hover/click dropdown (not a modal).
 */
export function PrivateKeyWalletMenu({ onDone, onCancel, onListChange }: PrivateKeyWalletMenuProps) {
  const [wallets, setWallets] = useState<PkWallet[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  const refresh = () => {
    const list = listPkWallets();
    setWallets(list);
    setActiveId(getActivePkWallet()?.id ?? null);
    setShowAdd(list.length === 0);
    onListChange?.();
  };

  useEffect(() => {
    refresh();
    setKeyInput('');
    setLabelInput('');
    setError('');
    setEditingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const handleSelect = (id: string) => {
    setActivePkWallet(id);
    refresh();
    onDone();
  };

  const handleAdd = () => {
    const result = addPkWallet(keyInput, labelInput);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setKeyInput('');
    setLabelInput('');
    setError('');
    setShowAdd(false);
    refresh();
    onDone();
  };

  const handleDelete = (id: string) => {
    removePkWallet(id);
    refresh();
    if (!getStoredPrivateKey()) onCancel();
  };

  const handleRenameCommit = (id: string) => {
    renamePkWallet(id, editLabel);
    setEditingId(null);
    refresh();
  };

  return (
    <div
      className="w-[min(300px,calc(100vw-16px))] rounded-lg border border-yellow-600/50 bg-gray-800 p-3 shadow-xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2">
        <svg
          className="h-4 w-4 flex-shrink-0 text-yellow-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <span className="text-xs font-bold text-yellow-400">PK wallets</span>
      </div>

      {wallets.length === 0 && (
        <div className="mb-2 space-y-1.5 text-[10px] text-gray-300">
          <div className="rounded border border-red-700/50 bg-red-950/40 p-2">
            <p className="mb-0.5 font-semibold text-red-300">Security</p>
            <p>Keys stay in this browser only. Prefer fresh trading wallets.</p>
          </div>
        </div>
      )}

      {wallets.length > 0 && (
        <ul className="mb-2 max-h-[220px] space-y-1 overflow-y-auto">
          {wallets.map((w) => {
            const isActive = w.id === activeId;
            return (
              <li
                key={w.id}
                className={`flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs ${
                  isActive
                    ? 'border-yellow-500/70 bg-yellow-950/30'
                    : 'border-gray-600 bg-gray-900/50 hover:border-gray-500'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => handleSelect(w.id)}
                >
                  {editingId === w.id ? (
                    <input
                      autoFocus
                      value={editLabel}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') handleRenameCommit(w.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => handleRenameCommit(w.id)}
                      className="w-full rounded border border-yellow-600/50 bg-gray-950 px-1.5 py-0.5 text-xs text-white"
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        {isActive && (
                          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-green-400" />
                        )}
                        <span
                          className={`truncate font-semibold ${isActive ? 'text-yellow-200' : 'text-gray-200'}`}
                        >
                          {w.label}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-gray-500">
                        {shortAddr(w.address)}
                      </div>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(w.id);
                    setEditLabel(w.label);
                  }}
                  className="flex-shrink-0 px-1 text-gray-400 hover:text-cyan-300"
                >
                  ✎
                </button>
                <button
                  type="button"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(w.id);
                  }}
                  className="flex-shrink-0 px-1 font-bold text-gray-400 hover:text-red-400"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!showAdd ? (
        <button
          type="button"
          onClick={() => {
            setShowAdd(true);
            setError('');
          }}
          className="mb-1.5 w-full rounded border border-dashed border-yellow-600/50 py-1.5 text-xs font-bold text-yellow-400 transition hover:bg-yellow-950/30"
        >
          + Add wallet
        </button>
      ) : (
        <div className="mb-1.5 space-y-1.5 rounded border border-gray-600 bg-gray-900/40 p-2">
          <input
            type="text"
            placeholder="Name / tag"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:border-yellow-500 focus:outline-none"
            autoComplete="off"
          />
          <input
            type="password"
            placeholder="Paste private key (hex)"
            value={keyInput}
            onChange={(e) => {
              setKeyInput(e.target.value);
              setError('');
            }}
            className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-xs text-white placeholder-gray-500 focus:border-yellow-500 focus:outline-none"
            autoComplete="off"
          />
          {error && <p className="text-[10px] text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            {wallets.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false);
                  setKeyInput('');
                  setError('');
                }}
                className="rounded bg-gray-600 px-2 py-1 text-xs hover:bg-gray-500"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleAdd}
              disabled={!keyInput.trim()}
              className={`rounded bg-yellow-600 px-2 py-1 text-xs font-bold hover:bg-yellow-700 ${
                !keyInput.trim() ? 'cursor-not-allowed opacity-50' : ''
              }`}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {wallets.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            clearAllPkWallets();
            refresh();
            onCancel();
          }}
          className="text-[10px] text-red-400/80 hover:text-red-300"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}

/** @deprecated Use PrivateKeyWalletMenu — kept for import path stability. */
export const PrivateKeyImportDialog = PrivateKeyWalletMenu;
