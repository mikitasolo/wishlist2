/**
 * Browsers drop focus to <body> when the focused element is disabled (the HTML
 * "focus fixup rule"); jsdom leaves it on the disabled element, which hides
 * any bug where a disabled control takes focus with it. Call this (e.g. in a
 * `beforeEach`, returning its result) to make jsdom behave like a browser.
 * Like a browser, it fixes focus up after the change rather than inside it.
 */
export function emulateFocusFixup(): () => void {
  const observer = new MutationObserver(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !focused.matches(':disabled')) return;
    // jsdom won't blur an element it can't focus, so lift `disabled` (the
    // control's own, or a fieldset's) for the blur.
    const holder = focused.hasAttribute('disabled')
      ? focused
      : focused.closest<HTMLElement>('fieldset[disabled]');
    if (!holder) return;
    holder.removeAttribute('disabled');
    focused.blur();
    holder.setAttribute('disabled', '');
  });
  observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['disabled'] });
  return () => observer.disconnect();
}
