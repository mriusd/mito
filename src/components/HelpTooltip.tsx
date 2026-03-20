import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface HelpTooltipProps {
  text: string;
}

export function HelpTooltip({ text }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popupWidth = popupRef.current?.offsetWidth || 300;
    let left = rect.left + rect.width / 2 - popupWidth / 2;
    // Clamp to viewport edges with 8px padding
    if (left < 8) left = 8;
    if (left + popupWidth > window.innerWidth - 8) left = window.innerWidth - 8 - popupWidth;
    setPos({
      top: rect.bottom + 6,
      left,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    // Re-position after popup renders so we can read its actual width
    const raf = requestAnimationFrame(updatePos);
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        btnRef.current && !btnRef.current.contains(target) &&
        popupRef.current && !popupRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="w-3 h-3 rounded-full border border-gray-500 text-gray-400 hover:text-white hover:border-gray-300 flex items-center justify-center text-[8px] font-bold leading-none transition cursor-pointer flex-shrink-0"
      >
        ?
      </button>
      {open && createPortal(
        <div
          ref={popupRef}
          className="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 min-w-[260px] max-w-[360px] z-[9999]"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="text-xs text-gray-200 leading-relaxed whitespace-pre-line">{text}</div>
        </div>,
        document.body
      )}
    </>
  );
}
