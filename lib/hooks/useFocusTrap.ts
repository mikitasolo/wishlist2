'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Keyboard focus for a modal dialog (`ConfirmDialog`, `BaseModal`), while
 * `active`:
 *
 * - On open, focus moves into `containerRef`: to `initialFocusRef` if it can
 *   take focus, else the first tabbable element, else the container itself
 *   (give it `tabIndex={-1}`). An `autoFocus` inside the dialog wins: if focus
 *   is already inside, it stays put.
 * - Tab / Shift+Tab wrap around inside the **topmost** open dialog, so they
 *   never reach the page, or a dialog underneath, behind its backdrop. Dialogs
 *   stack in the order they open: a confirmation opened over a modal traps
 *   focus until it closes, then the modal does again.
 * - On close, focus goes back to the element that had it when the dialog
 *   opened, if that's still in the document and focus hasn't since been moved
 *   somewhere outside the dialog on purpose. If the dialog's action disabled
 *   that element, focus goes back once it's re-enabled.
 *
 * Tab order is taken to be DOM order, which holds without positive
 * `tabIndex`es. A radio group would count as one stop per radio; no dialog
 * has one.
 */

// The open dialogs, oldest first; only the last one handles Tab.
const openTraps: object[] = [];

// Watches the one opener waiting to be re-enabled to take focus back (see
// returnFocus).
let openerWatch: MutationObserver | null = null;

function stopWaiting() {
  openerWatch?.disconnect();
  openerWatch = null;
}

/** Focus has nowhere to be: it dropped to <body> with whatever held it. */
const focusIsLost = () => !document.activeElement || document.activeElement === document.body;

const TABBABLE = [
  'a[href]',
  'area[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'iframe',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** The container's tabbable elements, in document (i.e. Tab) order. */
function tabbables(container: HTMLElement): HTMLElement[] {
  // Not querySelectorAll(TABBABLE): jsdom returns a selector list's matches
  // grouped by selector rather than in document order.
  return Array.from(container.querySelectorAll<HTMLElement>('*')).filter(
    (el) =>
      el.matches(TABBABLE) &&
      el.tabIndex >= 0 &&
      !el.closest('[inert]') &&
      // Hidden elements can't take focus. (jsdom has no checkVisibility, and
      // browsers before `visibilityProperty` spell it `checkVisibilityCSS`.)
      (typeof el.checkVisibility !== 'function' ||
        el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true }))
  );
}

/** Focuses `el`; returns whether it took focus. */
function tryFocus(el: HTMLElement | null | undefined): boolean {
  el?.focus();
  return !!el && document.activeElement === el;
}

/**
 * Focuses the dialog's opener, or, if the action the dialog just started has
 * disabled it (a card's buttons while its request runs), focuses it once it's
 * re-enabled, provided focus is still lost by then.
 */
function returnFocus(opener: HTMLElement) {
  stopWaiting();
  // The page hasn't moved while the dialog was open (the scroll lock).
  opener.focus({ preventScroll: true });
  if (document.activeElement === opener || !opener.matches(':disabled')) return;

  const observer = new MutationObserver(() => {
    if (opener.matches(':disabled')) return;
    stopWaiting();
    if (opener.isConnected && focusIsLost()) opener.focus({ preventScroll: true });
  });
  observer.observe(opener, { attributes: true, attributeFilter: ['disabled'] });
  openerWatch = observer;
}

export function useFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>
) {
  // Where focus was when the dialog opened. Read while rendering the open,
  // because by the time an effect runs an `autoFocus` inside the dialog has
  // already taken focus from it.
  const [openedFrom, setOpenedFrom] = useState<{ active: boolean; opener: Element | null }>({
    active: false,
    opener: null,
  });
  if (openedFrom.active !== active) {
    setOpenedFrom({ active, opener: active ? document.activeElement : null });
  }
  const { opener } = openedFrom;

  // The focus return a close scheduled, until it runs.
  const pendingReturn = useRef<{ cancelled: boolean } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    // StrictMode (dev) runs the cleanup below and this effect back to back on
    // mount. Cancelling the return that cleanup scheduled keeps focus where it
    // was (e.g. on an autoFocus field) instead of bouncing it to the opener.
    if (pendingReturn.current) pendingReturn.current.cancelled = true;
    pendingReturn.current = null;
    // A new dialog means the user has moved on from the last one's opener.
    stopWaiting();

    const trap = {};
    openTraps.push(trap);

    if (!container.contains(document.activeElement) && !tryFocus(initialFocusRef?.current)) {
      if (!tabbables(container).some(tryFocus)) container.focus();
    }

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
      if (openTraps[openTraps.length - 1] !== trap) return;

      const items = tabbables(container);
      const current = document.activeElement;
      const first = items[0];
      const last = items[items.length - 1];
      const outside = !current || current === container || !container.contains(current);

      if (!first) {
        // Nothing to tab to (e.g. every button disabled while an action runs).
        e.preventDefault();
        container.focus();
      } else if (outside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
      // Otherwise the browser moves focus to the next element inside.
    };
    document.addEventListener('keydown', handleTab);

    return () => {
      document.removeEventListener('keydown', handleTab);
      openTraps.splice(openTraps.indexOf(trap), 1);

      const pending = { cancelled: false };
      pendingReturn.current = pending;
      queueMicrotask(() => {
        if (pending.cancelled) return;
        if (pendingReturn.current === pending) pendingReturn.current = null;
        // Focus that was inside the dialog has dropped to <body> with it; if
        // it's anywhere else now, something put it there on purpose.
        const focusWasOurs = focusIsLost() || container.contains(document.activeElement);
        if (
          focusWasOurs &&
          opener instanceof HTMLElement &&
          opener !== document.body &&
          opener.isConnected
        ) {
          returnFocus(opener);
        }
      });
    };
  }, [active, containerRef, initialFocusRef, opener]);
}
