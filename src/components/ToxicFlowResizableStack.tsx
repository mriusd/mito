import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  clampAdjacentSplitPcts,
  persistToxicFlowSplitPcts,
  readToxicFlowSplitPcts,
  type ToxicFlowSplitLayoutKey,
} from '../lib/toxicFlowSplitPcts';

type ToxicFlowResizableStackProps = {
  layoutKey: ToxicFlowSplitLayoutKey;
  children: ReactNode[];
};

export function ToxicFlowResizableStack({ layoutKey, children }: ToxicFlowResizableStackProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pcts, setPcts] = useState<number[]>(() => readToxicFlowSplitPcts(layoutKey));
  const pctsRef = useRef(pcts);
  pctsRef.current = pcts;
  const dragRef = useRef<{ handleIndex: number; startY: number; startPcts: number[] } | null>(null);

  useEffect(() => {
    setPcts(readToxicFlowSplitPcts(layoutKey));
  }, [layoutKey]);

  const onPointerDown = useCallback(
    (handleIndex: number, e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { handleIndex, startY: e.clientY, startPcts: [...pctsRef.current] };
      e.currentTarget.setPointerCapture(e.pointerId);

      const onPointerMove = (ev: PointerEvent) => {
        const drag = dragRef.current;
        const el = containerRef.current;
        if (!drag || !el) return;
        const h = el.getBoundingClientRect().height;
        if (h <= 0) return;
        const deltaPct = ((ev.clientY - drag.startY) / h) * 100;
        setPcts(clampAdjacentSplitPcts(drag.startPcts, drag.handleIndex, deltaPct));
      };

      const onPointerUp = (ev: PointerEvent) => {
        dragRef.current = null;
        setPcts((current) => {
          persistToxicFlowSplitPcts(layoutKey, current);
          return current;
        });
        try {
          (ev.target as HTMLElement | null)?.releasePointerCapture?.(ev.pointerId);
        } catch {
          /* ignore */
        }
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    },
    [layoutKey],
  );

  return (
    <div ref={containerRef} className="flex flex-col flex-1 min-h-0 w-full">
      {children.map((child, i) => (
        <Fragment key={i}>
          <div
            className="flex min-h-0 flex-col overflow-hidden"
            style={{ flex: `0 0 ${pcts[i] ?? 0}%`, minHeight: 48 }}
          >
            {child}
          </div>
          {i < children.length - 1 && (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize panels"
              className="toxic-flow-panel-resize-handle group shrink-0"
              onPointerDown={(e) => onPointerDown(i, e)}
            >
              <span className="toxic-flow-panel-resize-handle-grip" />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
