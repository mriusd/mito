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

interface PrivateKeyImportDialogProps {
  open: boolean;
  onDone: () => void;
  onCancel: () => void;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function PrivateKeyImportDialog({ open, onDone, onCancel }: PrivateKeyImportDialogProps) {
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
  };

  useEffect(() => {
    if (!open) return;
    refresh();
    setKeyInput('');
    setLabelInput('');
    setError('');
    setEditingId(null);
  }, [open]);

  if (!open) return null;

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
      className="fixed inset-0 bg-black/70 z-[60000] flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-gray-800 rounded-lg p-4 max-w-md w-full mx-4 shadow-xl border border-yellow-600/50">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-5 h-5 text-yellow-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" /><path d="M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span className="text-sm font-bold text-yellow-400">PK wallets</span>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto text-gray-400 hover:text-white text-xs px-1"
          >
            Esc
          </button>
        </div>

        {wallets.length === 0 && (
          <div className="text-xs text-gray-300 space-y-2 mb-3">
            <div className="bg-red-950/40 rounded p-2.5 border border-red-700/50">
              <p className="text-red-300 font-semibold mb-1">Security</p>
              <p>
                Keys stay in browser only. Do not use main wallet.
                Fresh trading wallets; withdraw profits often.
              </p>
            </div>
          </div>
        )}

        {wallets.length > 0 && (
          <ul className="space-y-1.5 mb-3 max-h-[240px] overflow-y-auto">
            {wallets.map((w) => {
              const isActive = w.id === activeId;
              return (
                <li
                  key={w.id}
                  className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                    isActive
                      ? 'border-yellow-500/70 bg-yellow-950/30'
                      : 'border-gray-600 bg-gray-900/50 hover:border-gray-500'
                  }`}
                >
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left"
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
                        className="w-full bg-gray-950 border border-yellow-600/50 rounded px-1.5 py-0.5 text-xs text-white"
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />}
                          <span className={`font-semibold truncate ${isActive ? 'text-yellow-200' : 'text-gray-200'}`}>
                            {w.label}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-gray-500 mt-0.5">{shortAddr(w.address)}</div>
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
                    className="text-gray-400 hover:text-cyan-300 px-1 flex-shrink-0"
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
                    className="text-gray-400 hover:text-red-400 px-1 flex-shrink-0 font-bold"
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
            onClick={() => { setShowAdd(true); setError(''); }}
            className="w-full mb-2 py-1.5 rounded border border-dashed border-yellow-600/50 text-yellow-400 hover:bg-yellow-950/30 text-xs font-bold transition"
          >
            + Add wallet
          </button>
        ) : (
          <div className="mb-2 space-y-2 border border-gray-600 rounded p-2.5 bg-gray-900/40">
            <input
              type="text"
              placeholder="Name / tag"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500"
              autoComplete="off"
            />
            <input
              type="password"
              placeholder="Paste private key (hex)"
              value={keyInput}
              onChange={(e) => { setKeyInput(e.target.value); setError(''); }}
              className="w-full bg-gray-900 border border-gray-600 rounded px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500"
              autoComplete="off"
            />
            {error && <p className="text-red-400 text-[10px]">{error}</p>}
            <div className="flex gap-2 justify-end">
              {wallets.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setShowAdd(false); setKeyInput(''); setError(''); }}
                  className="px-2.5 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={handleAdd}
                disabled={!keyInput.trim()}
                className={`px-2.5 py-1 bg-yellow-600 hover:bg-yellow-700 rounded text-xs font-bold ${!keyInput.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Add
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2 justify-between items-center pt-1">
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
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-xs font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
