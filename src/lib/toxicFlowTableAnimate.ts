import type { AutoAnimationPlugin } from '@formkit/auto-animate';

const TOXIC_TABLE_ANIM_MS = 280;

/** FLIP slide only — default auto-animate also tweens height and stretches table rows. */
export const toxicFlowTableAutoAnimatePlugin: AutoAnimationPlugin = (
  el,
  action,
  newCoords,
  oldCoords,
) => {
  if (action === 'remain' && oldCoords && newCoords) {
    let deltaLeft = oldCoords.left - newCoords.left;
    let deltaTop = oldCoords.top - newCoords.top;
    const deltaRight = oldCoords.left + oldCoords.width - (newCoords.left + newCoords.width);
    const deltaBottom = oldCoords.top + oldCoords.height - (newCoords.top + newCoords.height);
    if (deltaBottom === 0) deltaTop = 0;
    if (deltaRight === 0) deltaLeft = 0;
    return new KeyframeEffect(
      el,
      [
        { transform: `translate(${deltaLeft}px, ${deltaTop}px)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration: TOXIC_TABLE_ANIM_MS, easing: 'ease-in-out' },
    );
  }
  if (action === 'add' && newCoords) {
    return new KeyframeEffect(
      el,
      [
        { opacity: 0 },
        { opacity: 1 },
      ],
      { duration: TOXIC_TABLE_ANIM_MS * 0.85, easing: 'ease-out' },
    );
  }
  if (action === 'remove' && oldCoords) {
    return new KeyframeEffect(
      el,
      [
        { opacity: 1 },
        { opacity: 0 },
      ],
      { duration: TOXIC_TABLE_ANIM_MS * 0.65, easing: 'ease-in' },
    );
  }
  return new KeyframeEffect(el, [{ opacity: 1 }, { opacity: 1 }], { duration: 0 });
};

/** Lock toxic table row height so rank/content updates do not change layout. */
export const TOXIC_TABLE_ROW_CLS = 'h-[23px] max-h-[23px] box-border';
