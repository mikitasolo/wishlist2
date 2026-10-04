'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Whether this render runs in the browser after hydration: `false` in a server
 * render and in the render that hydrates it, `true` from then on (and in any
 * render that isn't hydrating). For a component whose first paint can't be
 * worked out on the server (the dashboard's greeting reads the browser's
 * clock), so it paints a skeleton there instead, and the two never disagree.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
