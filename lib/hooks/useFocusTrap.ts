'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Keyboard focus for a modal dialog (`ConfirmDialog`, `BaseModal`,
 * `CreateWishlistModal`, `FollowListModal`, `ImageCropModal`), while `active`:
 *
 * - On open, focus moves into `containerRef`: to `initialFocusRef` if it can
 *   take focus, else the first tabbable element, else the container itself
 *   (give it `tabIndex={-1}`). An `autoFocus` inside the dialog wins: if focus
 *   is already inside, it stays put.
 * - Tab / Shift+Tab wrap around inside the **topmost** open dialog, so they
 *   never reach the page, or a dialog underneath, behind its backdrop. Dialogs
 *   stack in the order they open: a confirmation opened over a modal traps
 *   focus until it closes, then the modal does again. A dialog rendered inside
 *   another one's container (the crop dialog in an item modal's form) stacks
 *   the same way.
 * - Only Tab stops inside the container count. A popup that a control in it
 *   renders elsewhere (the `Select` menu, portalled to <body>) has to keep
 *   focus on that control while it's open, and have no Tab stops of its own,
 *   as `Select` does.
 * - While `busy` (its form is saving, its controls disabled), focus is held on
 *   the container if the control inside that had it was disabled, so it
 *   doesn't drop to <body> with it. When `busy` ends with the dialog still
 *   open, focus goes back to that control if it can take focus again, else
 *   stays on the container. Focus on a control that stays enabled is left
 *   alone, and so is focus in a dialog stacked over this one (that's its own).
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
  initialFocusRef?: RefObject<HTMLElement | null>,
  { busy = false }: { busy?: boolean } = {}
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
      const at = current instanceof HTMLElement ? items.indexOf(current) : -1;

      if (!items.length) {
        // Nothing to tab to (e.g. every button disabled while an action runs).
        e.preventDefault();
        container.focus();
        return;
      }
      if (at === -1) {
        // On something inside that isn't a Tab stop: the browser moves on from
        // it. On the panel, or outside the dialog: back to an end of it.
        if (current && current !== container && container.contains(current)) return;
        e.preventDefault();
        items[e.shiftKey ? items.length - 1 : 0].focus();
        return;
      }

      // Between two stops inside, the browser moves focus itself; wrapping
      // around an end is the trap's.
      if (at !== (e.shiftKey ? 0 : items.length - 1)) return;
      e.preventDefault();
      items[e.shiftKey ? items.length - 1 : 0].focus();
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

  // Where focus was when `busy` began in the open dialog. Read while rendering
  // it, like `opener`: by the time an effect runs, the commit has disabled the
  // control that had it, and focus may have dropped to <body> with it.
  const holding = active && busy;
  const [busyFrom, setBusyFrom] = useState<{ holding: boolean; focused: Element | null }>({
    holding: false,
    focused: null,
  });
  if (busyFrom.holding !== holding) {
    setBusyFrom({ holding, focused: holding ? document.activeElement : null });
  }
  const heldFrom = busyFrom.focused;

  useEffect(() => {
    const container = containerRef.current;
    if (
      !container ||
      !(heldFrom instanceof HTMLElement) ||
      heldFrom === container ||
      !container.contains(heldFrom)
    ) {
      return;
    }

    // Only if that control was disabled: focus has dropped with it, or will
    // when the browser fixes it up. The trap's Tab handling then keeps it on
    // the container while every control is disabled.
    const focused = document.activeElement;
    const dropped =
      focusIsLost() || (!!focused && container.contains(focused) && focused.matches(':disabled'));
    if (!dropped) return;
    container.focus({ preventScroll: true });

    return () => {
      // `busy` has ended. If the dialog closed with it, it's gone from the
      // document and the close returns focus to the opener instead. If focus
      // has left the container, it went somewhere on purpose.
      if (!container.isConnected) return;
      if (document.activeElement !== container && !focusIsLost()) return;
      if (heldFrom.isConnected) heldFrom.focus();
    };
  }, [containerRef, heldFrom]);
}
