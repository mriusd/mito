import { useLayoutEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  customButtonTitle,
  useCustomSidebarButtons,
  type CustomSidebarButton,
} from '../lib/sidebarCustomButtons';
import { dispatchCustomSidebarButtonClick } from '../lib/sidebarCustomButtonClick';

function readOrderAmount(): string {
  return localStorage.getItem('polymarket-order-amount') || '';
}

type Props = {
  /** Bar plot row — popup stays centered above this, not per-bar. */
  anchorRef: RefObject<HTMLElement | null>;
};

export function TempOddsCustomButtonsPopup({ anchorRef }: Props) {
  const buttons = useCustomSidebarButtons();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const orderAmount = readOrderAmount();

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || buttons.length === 0) {
      setRect(null);
      return;
    }
    const update = () => setRect(anchor.getBoundingClientRect());
    update();
    const ro = new ResizeObserver(update);
    ro.observe(anchor);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorRef, buttons.length]);

  if (!anchorRef.current || buttons.length === 0 || !rect || typeof document === 'undefined') return null;
  if (rect.width <= 0 || rect.height <= 0) return null;

  const compact = buttons.length > 4;

  return createPortal(
    <div
      className="no-drag fixed z-[99999] flex -translate-x-1/2 -translate-y-full flex-wrap items-center justify-center gap-1 rounded-md border border-gray-600/90 bg-gray-900/95 px-1.5 py-1 shadow-lg pointer-events-auto"
      style={{ top: Math.max(4, rect.top - 6), left: rect.left + rect.width / 2 }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {buttons.map((btn) => (
        <CustomButtonChip
          key={btn.id}
          btn={btn}
          compact={compact}
          orderAmount={orderAmount}
          onClick={() => dispatchCustomSidebarButtonClick(btn.id)}
        />
      ))}
    </div>,
    document.body,
  );
}

function CustomButtonChip({
  btn,
  compact,
  orderAmount,
  onClick,
}: {
  btn: CustomSidebarButton;
  compact: boolean;
  orderAmount: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`no-drag rounded font-extrabold text-white transition hover:brightness-110 ${
        compact ? 'h-4 min-w-[1.75rem] px-1 text-[11px] leading-none' : 'min-w-[2.25rem] px-1.5 py-1 text-[13px] leading-none'
      }`}
      style={{
        backgroundColor: btn.color,
        textShadow: '-1px 0 #000, 0 1px #000, 1px 0 #000, 0 -1px #000',
      }}
      title={customButtonTitle(btn, orderAmount)}
      onClick={onClick}
    >
      {btn.label}
    </button>
  );
}
