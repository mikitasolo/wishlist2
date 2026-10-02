'use client';

import { useSyncExternalStore } from 'react';
import { localDateString } from '@/lib/utils/occasion';

/**
 * Tell React to read the date again when it may have changed: at the next
 * local midnight, and when the tab comes back into view (a timer doesn't fire
 * while a laptop sleeps).
 */
function subscribe(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // A second past midnight, so the read lands on the new day.
    timer = setTimeout(
      () => {
        onChange();
        arm();
      },
      midnight.getTime() - now.getTime() + 1000
    );
  };
  arm();
  document.addEventListener('visibilitychange', onChange);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onChange);
  };
}

const getSnapshot = () => localDateString();
const getServerSnapshot = () => null;

/**
 * The viewer's local date (`YYYY-MM-DD`), or `null` while it isn't known yet:
 * in a server render, and in the client render that hydrates it. The server's
 * date can differ from the browser's, so anything worked out from "today" (an
 * occasion's countdown) waits for this to be set rather than render one date on
 * the server and another in the browser, which React would refuse as a
 * hydration mismatch. A component that first renders in the browser gets the
 * date straight away. It moves on by itself at local midnight.
 */
export function useLocalToday(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
