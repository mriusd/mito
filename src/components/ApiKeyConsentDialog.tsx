import { useState } from 'react';

interface ApiKeyConsentDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ApiKeyConsentDialog({ open, onConfirm, onCancel }: ApiKeyConsentDialogProps) {
  const [confirming, setConfirming] = useState(false);

  if (!open) return null;

  const handleConfirm = async () => {
    setConfirming(true);
    onConfirm();
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[60000] flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bg-gray-800 rounded-lg p-5 max-w-sm w-full mx-4 shadow-xl border border-yellow-600/50">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-5 h-5 text-yellow-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" /><path d="M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span className="text-sm font-bold text-yellow-400">Delegate API Keys</span>
        </div>

        <div className="text-xs text-gray-300 space-y-2 mb-4">
          <p>
            Smart orders require the backend server to place and cancel orders on your behalf in order to follow the smart order conditions.
          </p>
          <p>
            To enable this, your <span className="text-white font-semibold">API credentials</span> will be derived from a wallet signature and sent to the backend.
          </p>
          <div className="bg-gray-900/60 rounded p-2 border border-gray-700">
            <p className="text-green-400 font-semibold mb-1">These API keys can ONLY:</p>
            <ul className="list-disc list-inside text-gray-400 space-y-0.5">
              <li>Place orders</li>
              <li>Cancel orders</li>
              <li>Read order & position data</li>
            </ul>
            <p className="text-red-400 font-semibold mt-2 mb-1">They CANNOT:</p>
            <ul className="list-disc list-inside text-gray-400 space-y-0.5">
              <li>Withdraw funds</li>
              <li>Transfer assets</li>
              <li>Access your private key</li>
            </ul>
          </div>
          <p className="text-gray-500 text-[10px]">
            Credentials are stored on the backend server database to enable smart order execution even when you are offline or disconnected. You can revoke your API keys at any time via the Polymarket CLOB API (<span className="text-gray-400">deleteApiKey</span>), which will immediately invalidate them everywhere.
          </p>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 rounded text-xs font-medium transition">
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={confirming}
            className={`px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 rounded text-xs font-bold transition ${confirming ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {confirming ? 'Signing...' : 'Approve & Sign'}
          </button>
        </div>
      </div>
    </div>
  );
}
