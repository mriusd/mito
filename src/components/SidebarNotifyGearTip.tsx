import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

type SidebarNotifyGearTipProps = {
  anchorRef: RefObject<HTMLButtonElement>;
  open: boolean;
  onDismiss: () => void;
};

export function SidebarNotifyGearTip({ anchorRef, open, onDismiss }: SidebarNotifyGearTipProps) {
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      top: rect.bottom + 10,
      left: rect.left + rect.width / 2,
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
        className="pointer-events-auto fixed z-[8991] max-w-[16rem] rounded-lg border border-yellow-500/50 bg-gray-800 px-3 py-2.5 shadow-xl shadow-black/50"
        style={{ top: pos.top, left: pos.left, transform: 'translate(-50%, 0)' }}
      >
        <span
          className="pointer-events-none absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 -translate-y-full border-x-[7px] border-b-[9px] border-x-transparent border-b-yellow-500/50"
          aria-hidden
        />
        <span
          className="pointer-events-none absolute left-1/2 top-px h-0 w-0 -translate-x-1/2 -translate-y-full border-x-[6px] border-b-[8px] border-x-transparent border-b-gray-800"
          aria-hidden
        />
        <p className="text-[11px] leading-relaxed text-gray-200">
          Tap the gear to set up{' '}
          <span className="font-semibold text-yellow-400">notification types</span>
          {' '}— tilt alerts, whale sounds, bell thresholds, volume spikes, and more.
        </p>
        <button
          type="button"
          className="mt-2 rounded bg-gray-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-gray-500"
          onClick={onDismiss}
        >
          Got it
        </button>
      </div>
    </>,
    document.body,
  );
}
