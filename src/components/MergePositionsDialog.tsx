import { useEffect, useState } from 'react';

interface MergePositionsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Max complementary pairs mergeable (min of YES and NO size) */
  maxShares: number;
  conditionId: string;
  /** Short market title for context */
  title: string;
  /** e.g. "UP / DOWN" or "YES / NO" */
  outcomePairLabel: string;
  onSubmit: (amount: number) => Promise<{ success: boolean; error?: string; txHash?: string }>;
}

export function MergePositionsDialog({
  open,
  onClose,
  maxShares,
  conditionId,
  title,
  outcomePairLabel,
  onSubmit,
}: MergePositionsDialogProps) {
  const [qtyStr, setQtyStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setQtyStr(maxShares > 0 ? String(Math.floor(maxShares * 100) / 100) : '');
    setError('');
    setBusy(false);
  }, [open, maxShares]);

  if (!open) return null;

  const parsed = parseFloat(qtyStr.replace(/,/g, ''));
  const qty = Number.isFinite(parsed) ? parsed : 0;
  const valid = qty > 0 && qty <= maxShares + 1e-9;

  const handleMerge = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    const res = await onSubmit(qty);
    setBusy(false);
    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Merge failed');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-[60000] flex items-center justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg p-4 max-w-sm w-full mx-4 shadow-xl border border-gray-600">
        <div className="text-sm font-bold text-white mb-1">Merge {outcomePairLabel}</div>
        <p className="text-[10px] text-gray-400 mb-2 line-clamp-3" title={title}>
          {title}
        </p>
        <p className="text-[10px] text-gray-500 mb-3">
          Burns equal amounts of both outcome tokens and returns USDC to your Polymarket wallet (same on-chain flow as{' '}
          <span className="text-gray-400">polybot</span> <code className="text-gray-500">mergePositions</code>). Max{' '}
          <span className="text-cyan-400 tabular-nums">{Math.floor(maxShares * 100) / 100}</span> pairs.
        </p>
        <label className="block text-[10px] text-gray-500 mb-1">Amount (shares)</label>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            inputMode="decimal"
            value={qtyStr}
            onChange={(e) => setQtyStr(e.target.value)}
            className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-white"
            disabled={busy}
          />
          <button
            type="button"
            disabled={busy || maxShares <= 0}
            onClick={() => setQtyStr(String(Math.floor(maxShares * 100) / 100))}
            className="text-[10px] px-2 py-1 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-40"
          >
            Max
          </button>
        </div>
        <div className="text-[9px] text-gray-600 font-mono break-all mb-3" title={conditionId}>
          condition: {conditionId.slice(0, 10)}…{conditionId.slice(-8)}
        </div>
        {error && <div className="text-[10px] text-red-400 mb-2">{error}</div>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-200 hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void handleMerge()}
            className="text-xs px-3 py-1.5 rounded bg-cyan-700 text-white hover:bg-cyan-600 disabled:opacity-40"
          >
            {busy ? 'Signing…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
