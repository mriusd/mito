import { useRef, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const TPO_ROW_PX = 24;

/** Virtual scroll body for TPO tables — only mounts visible rows. */
export function TpoVirtualTableBody({
  count,
  colgroup,
  estimateSize = TPO_ROW_PX,
  overscan = 12,
  children,
}: {
  count: number;
  colgroup: ReactNode;
  estimateSize?: number;
  overscan?: number;
  children: (index: number) => ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });
  const items = virtualizer.getVirtualItems();

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto min-h-0">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {items.length > 0 ? (
          <table
            className="w-full text-[10px] table-fixed"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${items[0]?.start ?? 0}px)`,
            }}
          >
            {colgroup}
            <tbody>{items.map((item) => children(item.index))}</tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}
