import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface RangeEditDialogProps {
  open: boolean;
  asset: string;
  slotIndex: number;
  currentLow: number | null;
  currentHigh: number | null;
  livePrice: number;
  onConfirm: (low: number, high: number) => void;
  onClear: () => void;
  onClose: () => void;
}

const slotColors = ['text-cyan-300', 'text-pink-400'];
const slotBgs = ['bg-cyan-900', 'bg-pink-900'];

export function RangeEditDialog({
  open, asset, slotIndex, currentLow, currentHigh, livePrice, onConfirm, onClear, onClose,
}: RangeEditDialogProps) {
  const [lowVal, setLowVal] = useState('');
  const [highVal, setHighVal] = useState('');
  const lowRef = useRef<HTMLInputElement>(null);

  const hasCurrent = currentLow !== null && currentHigh !== null;

  // Pre-fill when dialog opens
  useEffect(() => {
    if (open) {
      setLowVal(currentLow !== null ? String(currentLow) : '');
      setHighVal(currentHigh !== null ? String(currentHigh) : '');
      setTimeout(() => {
        lowRef.current?.focus();
        lowRef.current?.select();
      }, 50);
    }
  }, [open, currentLow, currentHigh]);

  const lo = parseFloat(lowVal);
  const hi = parseFloat(highVal);
  const valid = !isNaN(lo) && !isNaN(hi) && lo > 0 && hi > 0 && hi >= lo;

  // Check if different from current
  let changed = true;
  if (hasCurrent && valid) {
    if (lo === currentLow && hi === currentHigh) changed = false;
  }
  const canConfirm = valid && changed;

  // Preview
  let previewText = '';
  if (valid && changed && livePrice > 0) {
    const pctLo = ((lo - livePrice) / livePrice * 100).toFixed(1);
    const pctHi = ((hi - livePrice) / livePrice * 100).toFixed(1);
    previewText = `New: ${lo} – ${hi} (${Number(pctLo) >= 0 ? '+' : ''}${pctLo}% / ${Number(pctHi) >= 0 ? '+' : ''}${pctHi}% from live)`;
  }

  // Warning for large changes
  let warningText = '';
  if (valid && hasCurrent) {
    const loPctChange = currentLow! > 0 ? Math.abs((lo - currentLow!) / currentLow! * 100) : 0;
    const hiPctChange = currentHigh! > 0 ? Math.abs((hi - currentHigh!) / currentHigh! * 100) : 0;
    if (loPctChange > 5 || hiPctChange > 5) {
      warningText = `⚠ Large change: low ${loPctChange.toFixed(1)}%, high ${hiPctChange.toFixed(1)}% from current`;
    }
  }

  const handleConfirm = useCallback(() => {
    if (canConfirm) onConfirm(lo, hi);
  }, [canConfirm, lo, hi, onConfirm]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canConfirm) handleConfirm();
    if (e.key === 'Escape') onClose();
  }, [canConfirm, handleConfirm, onClose]);

  if (!open) return null;

  const color = slotColors[slotIndex] || 'text-white';
  const bg = slotBgs[slotIndex] || 'bg-gray-700';

  return createPortal(
    <div
      className="fixed inset-0 bg-black/60 z-[10010] flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onMouseMoveCapture={(e) => e.stopPropagation()}
      onTouchStartCapture={(e) => e.stopPropagation()}
      onTouchMoveCapture={(e) => e.stopPropagation()}
    >
      <div
        className="bg-gray-800 rounded-lg p-5 max-w-sm mx-4 shadow-xl border border-gray-700"
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseMove={(e) => e.stopPropagation()}
      >
        {/* Title */}
        <div className="text-base font-bold mb-3 flex items-center gap-2">
          <span className={`${color} text-base font-bold`}>{asset} Range {slotIndex + 1}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${bg} ${color}`}>Slot {slotIndex + 1}</span>
        </div>

        {/* Current value */}
        <div className="text-sm text-gray-400 mb-3">
          {hasCurrent ? (
            <>Current: <span className="text-white font-bold">{currentLow}</span> – <span className="text-white font-bold">{currentHigh}</span></>
          ) : (
            'Current: not set (using live price)'
          )}
        </div>

        {/* Low input */}
        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm text-gray-400 w-10">Low:</label>
          <input
            ref={lowRef}
            type="text"
            value={lowVal}
            onChange={(e) => setLowVal(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 w-32 text-white text-sm font-bold font-mono outline-none focus:border-blue-500"
            placeholder="e.g. 85000"
          />
        </div>

        {/* High input */}
        <div className="flex items-center gap-2 mb-3">
          <label className="text-sm text-gray-400 w-10">High:</label>
          <input
            type="text"
            value={highVal}
            onChange={(e) => setHighVal(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1.5 w-32 text-white text-sm font-bold font-mono outline-none focus:border-blue-500"
            placeholder="e.g. 92000"
          />
        </div>

        {/* Preview */}
        {previewText && (
          <div className="text-xs text-gray-500 mb-3">{previewText}</div>
        )}

        {/* Warning */}
        {warningText && (
          <div className="text-xs text-yellow-400 mb-3">{warningText}</div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm font-medium transition"
          >
            Cancel
          </button>
          {hasCurrent && (
            <button
              onClick={onClear}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-medium transition"
            >
              Clear
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={`px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium transition ${!canConfirm ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
