import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

type ToxicFlowRowActionsTipProps = {
  anchorRef: RefObject<HTMLTableCellElement>;
  open: boolean;
  onDismiss: () => void;
};

export function ToxicFlowRowActionsTip({ anchorRef, open, onDismiss }: ToxicFlowRowActionsTipProps) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      top: rect.top + rect.height / 2,
      left: rect.right + 10,
    });
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [open, updatePos]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div className="pointer-events-none fixed inset-0 z-[8990] bg-black/25" aria-hidden />
      <div
        role="tooltip"
        className="pointer-events-auto fixed z-[8991] max-w-[17rem] rounded-lg border border-yellow-500/50 bg-gray-800 px-3 py-2.5 shadow-xl shadow-black/50"
        style={{ top: pos.top, left: pos.left, transform: 'translate(0, -50%)' }}
      >
        <p className="text-[11px] leading-relaxed text-gray-200">
          <span className="font-semibold text-yellow-400">★ Star</span> — mark favourites; they appear in the{' '}
          <span className="font-semibold text-yellow-400/90">Favourites</span> tab.
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-200">
          <span className="font-semibold text-amber-300">Bell</span> — alert sound when that wallet opens a position in
          this market.
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-200">
          <span className="font-semibold text-red-400">X</span> — mute all notifications for that wallet.
        </p>
        <button
          type="button"
          className="mt-2 rounded bg-gray-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-gray-500"
          onClick={onDismiss}
        >
          Got it
        </button>
        <span
          className="pointer-events-none absolute left-0 top-1/2 h-0 w-0 -translate-x-full -translate-y-1/2 border-y-[7px] border-r-[9px] border-y-transparent border-r-yellow-500/50"
          aria-hidden
        />
        <span
          className="pointer-events-none absolute left-px top-1/2 h-0 w-0 -translate-x-full -translate-y-1/2 border-y-[6px] border-r-[8px] border-y-transparent border-r-gray-800"
          aria-hidden
        />
      </div>
    </>,
    document.body,
  );
}
