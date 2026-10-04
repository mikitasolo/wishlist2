'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { guardedHref } from '@/lib/utils/leaveGuard';

/**
 * Asks before leaving a page with edits that haven't been saved, while
 * `active`: closing or reloading the tab gets the browser's own prompt
 * (`beforeunload`), and a click on a link to another page of the app is held
 * (`guardedHref`) until the person answers the page's own dialog. `pending` is
 * where that click was going; `leave` goes there, and `stay` drops it.
 *
 * The click is caught on `document` in the capture phase, before React's own
 * listener (a Next `Link`'s navigation) sees it. The browser's back button
 * isn't held: the App Router gives no way to cancel it.
 */
export function useLeaveGuard(active: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Older browsers show the prompt only when this is set.
      e.returnValue = '';
    }
    function onClick(e: MouseEvent) {
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
    const href = pending;
    setPending(null);
    if (href !== null) router.push(href);
  }, [pending, router]);

  const stay = useCallback(() => setPending(null), []);

  return { pending, leave, stay };
}
