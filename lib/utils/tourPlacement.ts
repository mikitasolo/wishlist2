/**
 * Where a walkthrough popover goes next to the UI it points at (WIS-371):
 * below it when it fits, else above, else on whichever side has more room,
 * and always inside the viewport with a `margin` gutter (a 390px phone
 * included).
 */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Placement {
  top: number;
  left: number;
  side: 'below' | 'above';
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export function placeTourPopover(
  target: Box,
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  { margin = 16, gap = 12 }: { margin?: number; gap?: number } = {}
): Placement {
  const below = target.top + target.height + gap;
  const above = target.top - gap - popover.height;
  const roomBelow = viewport.height - margin - below;
  const roomAbove = target.top - gap - margin;

  const side: Placement['side'] =
    popover.height <= roomBelow
      ? 'below'
      : popover.height <= roomAbove
        ? 'above'
        : roomBelow >= roomAbove
          ? 'below'
          : 'above';

  const top = clamp(
    side === 'below' ? below : above,
    margin,
    Math.max(margin, viewport.height - margin - popover.height)
  );
  const left = clamp(
    target.left + target.width / 2 - popover.width / 2,
    margin,
    Math.max(margin, viewport.width - margin - popover.width)
  );
  return { top, left, side };
}
