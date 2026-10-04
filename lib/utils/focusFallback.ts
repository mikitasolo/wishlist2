/**
 * Somewhere sensible for keyboard focus to go when the element that had it (or
 * that it should return to) has been removed, so it never drops to <body> and
 * sends a keyboard or screen-reader user back to the top of the page.
 *
 * The target is the element marked `data-focus-fallback`, else the page's
 * first `h1` in `main`, else `main`. It's made focusable (`tabindex="-1"`)
 * when it isn't, and its outline is left off: it's a place to continue from,
 * not a control.
 */
export function focusPageFallback(): boolean {
  const target =
    document.querySelector<HTMLElement>('[data-focus-fallback]') ??
    document.querySelector<HTMLElement>('main h1') ??
    document.querySelector<HTMLElement>('main');
  if (!target) return false;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.style.outline = 'none';
  target.focus({ preventScroll: true });
  return document.activeElement === target;
}
