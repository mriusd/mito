import { memo, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useSidebarUpDownEndPicker } from '../lib/sidebarUpDownTargetStore';

export const SidebarUpDownEndPicker = memo(function SidebarUpDownEndPicker({
  titleColor,
}: {
  titleColor: string;
}) {
  const endPicker = useSidebarUpDownEndPicker();
  const selectedMarketId = useAppStore((s) => s.selectedMarket?.id ?? '');
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  if (!endPicker) return null;

  if (endPicker.endPickerList.length > 1) {
    return (
      <details ref={detailsRef} className="relative shrink-0">
        <summary className={`inline-flex cursor-pointer select-none list-none items-center gap-0.5 rounded border border-gray-600/80 bg-gray-900/70 px-1 py-0.5 tabular-nums text-[11px] font-bold ${titleColor} [&::-webkit-details-marker]:hidden hover:border-gray-500`}>
          {endPicker.visibleEndLabel}
          <ChevronDown className="size-3 shrink-0 opacity-80" strokeWidth={2} aria-hidden />
        </summary>
        <ul
          className="absolute right-0 top-full z-[200] mt-0.5 max-h-[50vh] min-w-[5.5rem] overflow-y-auto rounded border border-gray-600 bg-neutral-950 py-0.5 text-left shadow-lg"
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {endPicker.endPickerList.map((m) => {
            const endMs = m.endDate ? new Date(m.endDate).getTime() : NaN;
            const expired = Number.isFinite(endMs) && endMs <= Date.now();
            const sel = m.id === selectedMarketId;
            const tone = sel ? (expired ? 'text-amber-500/85' : 'text-amber-300') : expired ? 'text-gray-500' : 'text-gray-100';
            return (
              <li key={m.id}>
                <button
                  type="button"
                  role="menuitem"
                  className={`w-full whitespace-nowrap px-2 py-1 text-left text-[11px] font-semibold tabular-nums hover:bg-neutral-800 ${tone}`}
                  title={expired ? `${m.endDate} (ended)` : m.endDate}
                  onClick={() => {
                    setSelectedMarket(m);
                    const dr = detailsRef.current;
                    if (dr) dr.open = false;
                  }}
                >
                  {new Date(m.endDate).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </button>
              </li>
            );
          })}
        </ul>
      </details>
    );
  }

  return (
    <span
      className="shrink-0 tabular-nums text-[11px] font-bold text-gray-400"
      title={endPicker.endIso}
    >
      {endPicker.visibleEndLabel}
    </span>
  );
});
