import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  isMobileScreenViewport,
  persistMobileScreenNoticeDismissed,
  readMobileScreenNoticeDismissed,
} from '../lib/mobileScreenNotice';

export function MobileScreenNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (readMobileScreenNoticeDismissed()) return;
    if (isMobileScreenViewport()) setOpen(true);
  }, []);

  if (!open || typeof document === 'undefined') return null;

  const dismiss = () => {
    persistMobileScreenNoticeDismissed();
    setOpen(false);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[65000] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-screen-notice-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="w-full max-w-sm rounded-lg border border-gray-600 bg-gray-800 p-4 shadow-xl text-gray-200">
        <h2 id="mobile-screen-notice-title" className="text-sm font-bold text-yellow-400 mb-2">
          Large screen recommended
        </h2>
        <p className="text-xs leading-relaxed text-gray-300">
          This platform was designed for large screens and is not optimized for mobile use. For the best
          experience, open it on a desktop or tablet in landscape with a wide display.
        </p>
        <button
          type="button"
          className="mt-4 w-full rounded-md bg-gray-600 px-3 py-2 text-xs font-bold text-white hover:bg-gray-500 transition"
          onClick={dismiss}
        >
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}
