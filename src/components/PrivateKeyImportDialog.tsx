import { useState } from 'react';

const PK_STORAGE_KEY = 'polymarket-imported-pk';

export function getStoredPrivateKey(): string | null {
  return localStorage.getItem(PK_STORAGE_KEY);
}

export function clearStoredPrivateKey(): void {
  localStorage.removeItem(PK_STORAGE_KEY);
}

interface PrivateKeyImportDialogProps {
  open: boolean;
  onDone: () => void;
  onCancel: () => void;
}

export function PrivateKeyImportDialog({ open, onDone, onCancel }: PrivateKeyImportDialogProps) {
  const [keyInput, setKeyInput] = useState('');
  const [error, setError] = useState('');

  if (!open) return null;

  const handleImport = () => {
    let raw = keyInput.trim();
    if (raw.startsWith('0x')) raw = raw.slice(2);
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
      setError('Invalid private key — must be 64 hex characters');
      return;
    }
    localStorage.setItem(PK_STORAGE_KEY, '0x' + raw.toLowerCase());
    setKeyInput('');
    setError('');
    onDone();
  };

  const existing = getStoredPrivateKey();

  return (
    <div
      className="fixed inset-0 bg-black/70 z-[60000] flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-gray-800 rounded-lg p-5 max-w-md w-full mx-4 shadow-xl border border-yellow-600/50">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-5 h-5 text-yellow-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" /><path d="M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span className="text-sm font-bold text-yellow-400">Import Private Key</span>
        </div>

        <div className="text-xs text-gray-300 space-y-2 mb-4">
          <div className="bg-red-950/40 rounded p-2.5 border border-red-700/50">
            <p className="text-red-300 font-semibold mb-1.5">Security Warning</p>
            <p>
              The private key stays in your browser and is never sent out.
              Still, your browser might be hacked by malware — <span className="text-white font-semibold">do not use your main wallet</span>.
              Create a fresh wallet for trading and withdraw profits regularly to
              make sure there is no significant loss in case of hack or compromise.
            </p>
          </div>
          <div className="bg-gray-900/60 rounded p-2.5 border border-gray-700">
            <p className="text-cyan-300 font-semibold mb-1.5">When to use this</p>
            <p>
              Using a private key is an option for short Up or Down markets because it
              allows for quick order placement and edit, which can take several seconds
              in an external wallet because external wallets are slow.
              The only benefit is <span className="text-white font-semibold">execution speed</span>,
              which is important in 5m and 15m Up or Down markets.
              For all other markets, use an external wallet.
            </p>
          </div>
        </div>

        {existing && (
          <div className="flex items-center gap-2 mb-3 bg-green-950/30 rounded p-2 border border-green-700/40 text-xs">
            <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
            <span className="text-green-300">Private key already imported</span>
            <button
              type="button"
              onClick={() => {
                clearStoredPrivateKey();
                setKeyInput('');
                setError('');
              }}
              className="ml-auto text-red-400 hover:text-red-300 font-bold text-[10px]"
            >
              Remove
            </button>
          </div>
        )}

        <div className="mb-3">
          <input
            type="password"
            placeholder="Paste private key (hex)"
            value={keyInput}
            onChange={(e) => { setKeyInput(e.target.value); setError(''); }}
            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500"
            autoComplete="off"
          />
          {error && <p className="text-red-400 text-[10px] mt-1">{error}</p>}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-xs font-medium transition"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!keyInput.trim()}
            className={`px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 rounded text-xs font-bold transition ${!keyInput.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Import Key
          </button>
        </div>
      </div>
    </div>
  );
}
