import { useEffect, useState } from 'react';

interface SplitPositionsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Max USDC splittable (wallet cash). */
  maxUsd: number;
  conditionId: string;
  title: string;
  outcomePairLabel: string;
  onSubmit: (amountUsd: number) => Promise<{ success: boolean; error?: string; txHash?: string }>;
}

export function SplitPositionsDialog({
  open,
  onClose,
  maxUsd,
  conditionId,
  title,
  outcomePairLabel,
  onSubmit,
}: SplitPositionsDialogProps) {
  const [qtyStr, setQtyStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setQtyStr(maxUsd > 0 ? String(Math.floor(maxUsd * 100) / 100) : '');
    setError('');
    setBusy(false);
  }, [open, maxUsd]);

  if (!open) return null;

  const parsed = parseFloat(qtyStr.replace(/,/g, ''));
  const qty = Number.isFinite(parsed) ? parsed : 0;
  const valid = qty > 0 && qty <= maxUsd + 1e-9;

  const handleSplit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    const res = await onSubmit(qty);
    setBusy(false);
    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Split failed');
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
        <div className="text-sm font-bold text-white mb-1">Split {outcomePairLabel}</div>
        <p className="text-[10px] text-gray-400 mb-2 line-clamp-3" title={title}>
          {title}
        </p>
        <p className="text-[10px] text-gray-500 mb-3">
          Converts USDC into equal amounts of both outcome tokens (1 USDC → 1 YES + 1 NO share). Max{' '}
          <span className="text-cyan-400 tabular-nums">${Math.floor(maxUsd * 100) / 100}</span>.
        </p>
        <label className="block text-[10px] text-gray-500 mb-1">Amount (USDC)</label>
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
            disabled={busy || maxUsd <= 0}
            onClick={() => setQtyStr(String(Math.floor(maxUsd * 100) / 100))}
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
            onClick={() => void handleSplit()}
            className="text-xs px-3 py-1.5 rounded bg-cyan-700 text-white hover:bg-cyan-600 disabled:opacity-40"
          >
            {busy ? 'Signing…' : 'Split'}
          </button>
        </div>
      </div>
    </div>
  );
}
