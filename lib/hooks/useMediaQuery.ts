'use client';

import { useCallback, useSyncExternalStore } from 'react';

const hasMatchMedia = () => typeof window !== 'undefined' && !!window.matchMedia;

/**
 * Whether a CSS media query matches, kept current as it changes (a resize, a
 * rotation). `null` until it's known: in a server render, in the render that
 * hydrates it, and where there's no `matchMedia` (jsdom). So the server's HTML
 * and the first client render always agree (no hydration mismatch), and
 * whatever the first paint shows has to come from CSS: use this to drop from
 * the DOM what CSS already hides at that width, never to decide the layout.
 */
export function useMediaQuery(query: string): boolean | null {
  // Stable per query, or every render of every card would resubscribe.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => (hasMatchMedia() ? window.matchMedia(query).matches : null),
    () => null
  );
}

/**
 * Tailwind's `sm` breakpoint (40rem), as `sm:` utilities match it: true from
 * `sm` up, false below it, null until known (see `useMediaQuery`).
 */
export const SM_UP_QUERY = '(min-width: 40rem)';
