import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface HelpTooltipProps {
  text: string;
}

export function HelpTooltip({ text }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [sheetOffset, setSheetOffset] = useState(20);
  const [sheetDragging, setSheetDragging] = useState(false);
  const [sheetClosing, setSheetClosing] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const dragStartYRef = useRef<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!open || !isMobile) return;
    // Slide up on open (similar feel to sidebar sheet).
    setSheetClosing(false);
    setSheetOffset(24);
    const raf = requestAnimationFrame(() => setSheetOffset(0));
    return () => cancelAnimationFrame(raf);
  }, [open, isMobile]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    if (isMobile) return;
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
  }, [open, updatePos, isMobile]);

  const startSheetDrag = (clientY: number) => {
    dragStartYRef.current = clientY;
    setSheetDragging(true);
  };
  const moveSheetDrag = (clientY: number) => {
    if (!sheetDragging || dragStartYRef.current == null) return;
    setSheetOffset(Math.max(0, clientY - dragStartYRef.current));
  };
  const closeMobileSheet = () => {
    if (!open && !sheetClosing) return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setSheetClosing(true);
    setSheetDragging(false);
    dragStartYRef.current = null;
    setSheetOffset(window.innerHeight);
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      setSheetClosing(false);
      setSheetOffset(20);
    }, 220);
  };

  const endSheetDrag = () => {
    if (!sheetDragging) return;
    const shouldClose = sheetOffset > 90;
    setSheetDragging(false);
    dragStartYRef.current = null;
    if (shouldClose) closeMobileSheet();
    else setSheetOffset(0);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          if (isMobile && open) {
            closeMobileSheet();
            return;
          }
          setOpen((v) => !v);
        }}
        className="w-3 h-3 rounded-full border border-gray-500 text-gray-400 hover:text-white hover:border-gray-300 flex items-center justify-center text-[8px] font-bold leading-none transition cursor-pointer flex-shrink-0"
      >
        ?
      </button>
      {(open || (isMobile && sheetClosing)) && createPortal(
        isMobile ? (
          <>
            <button
              type="button"
              className="fixed inset-0 bg-black/50 backdrop-blur-[1px] z-[9998]"
              onClick={closeMobileSheet}
              aria-label="Close help"
            />
            <div
              ref={popupRef}
              className="fixed bottom-0 left-0 right-0 z-[9999] bg-gray-800 border border-gray-600 rounded-t-xl shadow-xl max-h-[70vh] overflow-hidden"
              style={{
                transform: `translateY(${sheetOffset}px)`,
                transition: sheetDragging ? 'none' : 'transform 220ms ease',
              }}
            >
              <div
                className="flex items-center justify-center h-6 touch-none"
                onTouchStart={(e) => startSheetDrag(e.touches[0].clientY)}
                onTouchMove={(e) => {
                  moveSheetDrag(e.touches[0].clientY);
                  if (sheetDragging) e.preventDefault();
                }}
                onTouchEnd={endSheetDrag}
                onMouseDown={(e) => startSheetDrag(e.clientY)}
                onMouseMove={(e) => moveSheetDrag(e.clientY)}
                onMouseUp={endSheetDrag}
                onMouseLeave={endSheetDrag}
              >
                <div className="w-10 h-1 rounded-full bg-gray-500" />
              </div>
              <div className="px-3 pb-3 overflow-y-auto max-h-[calc(70vh-24px)]">
                <div className="text-xs text-gray-200 leading-relaxed whitespace-pre-line">{text}</div>
              </div>
            </div>
          </>
        ) : (
          <div
            ref={popupRef}
            className="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 min-w-[260px] max-w-[360px] z-[9999]"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="text-xs text-gray-200 leading-relaxed whitespace-pre-line">{text}</div>
          </div>
        ),
        document.body
      )}
    </>
  );
}
