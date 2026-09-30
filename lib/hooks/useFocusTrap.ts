'use client';

import { useEffect, useState, type RefObject } from 'react';

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
 *   somewhere outside the dialog on purpose.
 */

// The open dialogs, oldest first; only the last one handles Tab.
const openTraps: object[] = [];

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
      // Hidden elements can't take focus. (jsdom has no checkVisibility.)
      (typeof el.checkVisibility !== 'function' ||
        el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true }))
  );
}

/** Focuses the first candidate that takes focus; returns whether one did. */
function focusFirst(candidates: (HTMLElement | null | undefined)[]): boolean {
  for (const el of candidates) {
    if (!el) continue;
    el.focus();
    if (document.activeElement === el) return true;
  }
  return false;
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

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    const trap = {};
    openTraps.push(trap);

    if (!container.contains(document.activeElement)) {
      focusFirst([initialFocusRef?.current, ...tabbables(container), container]);
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

      // Focus that was inside the dialog has dropped to <body> with it.
      const current = document.activeElement;
      const focusWasOurs = !current || current === document.body || container.contains(current);
      if (
        focusWasOurs &&
        opener instanceof HTMLElement &&
        opener !== document.body &&
        opener.isConnected
      ) {
        // The page hasn't moved while the dialog was open (the scroll lock).
        opener.focus({ preventScroll: true });
      }
    };
  }, [active, containerRef, initialFocusRef, opener]);
}
