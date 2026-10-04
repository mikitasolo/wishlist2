'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { guardedHref } from '@/lib/utils/leaveGuard';

/**
 * Asks before leaving a page with edits that haven't been saved, while
 * `active`: closing or reloading the tab gets the browser's own prompt
 * (`beforeunload`), and a click on a link to another page of the app is held
 * (`guardedHref`) until the person answers the page's own dialog. `pending` is
 * where that click was going, or an action of the page's own held the same way
 * (`hold`, e.g. Sign out); `leave` goes there or runs it, with the guard off
 * from then on, and `stay` drops it.
 *
 * The click is caught on `document` in the capture phase, before React's own
 * listener (a Next `Link`'s navigation) sees it. The browser's back button
 * isn't held: the App Router gives no way to cancel it.
 */
export function useLeaveGuard(active: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<string | (() => void) | null>(null);
  // Once the person has chosen to leave, nothing asks them again on the way out.
  const left = useRef(false);

  useEffect(() => {
    if (!active) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (left.current) return;
      e.preventDefault();
      // Older browsers show the prompt only when this is set.
      e.returnValue = '';
    }
    function onClick(e: MouseEvent) {
      if (left.current) return;
      const href = guardedHref(e, window.location);
      if (href === null) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(href);
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active]);

  const leave = useCallback(() => {
    const to = pending;
    setPending(null);
    if (to === null) return;
    left.current = true;
    if (typeof to === 'string') router.push(to);
    else to();
  }, [pending, router]);

  const stay = useCallback(() => setPending(null), []);
  // A function in state is called as an updater, so it's wrapped.
  const hold = useCallback((action: () => void) => setPending(() => action), []);

  return { pending, leave, stay, hold };
}
