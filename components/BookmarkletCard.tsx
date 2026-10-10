'use client';

import { useEffect, useRef, useState } from 'react';
import Panel from './Panel';
import { buttonClassName } from './buttonStyles';
import { bookmarkletHref } from '@/lib/bookmarklet/href';
import { FINE_POINTER_QUERY, useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { BOOKMARKLET_SETTINGS_ID } from '@/lib/utils/tourSteps';

/**
 * Settings → Add from any store (WIS-367): the bookmarklet's install card,
 * desktop only (hidden below `sm`, and gone on a device with no mouse or
 * trackpad). The button is a draggable link whose `javascript:` address is set
 * through a ref after mount: React 19 refuses a `javascript:` URL in `href`.
 * The origin comes from `window.location.origin`, so the bookmark opens the
 * deployment it was installed from (production, staging, a local dev port).
 */
export default function BookmarkletCard() {
  const fine = useMediaQuery(FINE_POINTER_QUERY);
  const link = useRef<HTMLAnchorElement>(null);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    const href = bookmarkletHref(window.location.origin);
    if (href) link.current?.setAttribute('href', href);
  }, [fine]);

  // `null` (unknown: server, first render, jsdom) still renders; CSS hides it below `sm`.
  if (fine === false) return null;

  return (
    <Panel
      id={BOOKMARKLET_SETTINGS_ID}
      className="mb-6 hidden sm:block"
      title="Add from any store"
      description="Drag this button to your bookmarks bar. Then, on a product page, click it to add the item to one of your wishlists."
    >
      <a
        ref={link}
        href="#"
        draggable
        // Where the guided walkthrough's bookmarklet step points (WIS-436).
        data-tour="bookmarklet"
        className={buttonClassName({ variant: 'secondary' })}
        onClick={(e) => {
          // On this page it does nothing useful: it's meant to be dragged.
          e.preventDefault();
          setHint(true);
        }}
      >
        Add to wishlist
      </a>
      <p className="mt-3 text-xs text-muted-foreground" role={hint ? 'status' : undefined}>
        {hint
          ? 'Drag me to your bookmarks bar, don’t click.'
          : 'Bookmarks bar hidden? Press Ctrl+Shift+B (⌘+Shift+B on a Mac) to show it.'}
      </p>
    </Panel>
  );
}
