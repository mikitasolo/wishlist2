'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** The sections of a list's page an owner moves between (D5). Everyone else only ever gets Items. */
export type ListTab = 'items' | 'people' | 'settings';

/** The URL's search parameter that names the tab: `?tab=people`, `?tab=settings`, none for Items. */
export const LIST_TAB_PARAM = 'tab';

/** The tab a `?tab=` value names: anything but People or Settings is Items. */
export function listTabFrom(value: string | null | undefined): ListTab {
  return value === 'people' || value === 'settings' ? value : 'items';
}

/**
 * `path` (a list's page) on the tab the URL is on now: for following a list to
 * its new URL (a new slug) without dropping the owner back on Items. Only the
 * tab carries over; the status chip puts itself back (`useListChip`).
 */
export function onCurrentListTab(path: string): string {
  const tab = listTabFrom(new URLSearchParams(window.location.search).get(LIST_TAB_PARAM));
  return tab === 'items' ? path : `${path}?${LIST_TAB_PARAM}=${tab}`;
}

/** Fired after this hook moves the URL to another tab, which `popstate` doesn't report. */
const TAB_CHANGE_EVENT = 'wishlist-tab-change';

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(TAB_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(TAB_CHANGE_EVENT, onChange);
  };
}

const readTab = (): ListTab =>
  listTabFrom(new URLSearchParams(window.location.search).get(LIST_TAB_PARAM));

/** A server render has no URL to read, and every list opens on Items there. */
const serverTab = (): ListTab => 'items';

/**
 * The tab of a list's page the URL is on (`?tab=`), and a way to move to
 * another. Moving pushes a history entry (`history.pushState`, which Next's
 * router picks up without a request to the server), so back, refresh and a
 * shared link all land on the tab, and back from People returns to Items.
 * Every other parameter (a status chip's `?show=`) stays as it is.
 *
 * The URL is read as it is, whoever's looking: it's the page's job to show
 * Items to anyone who isn't an owner, whatever the URL says, and to leave
 * their URL alone, so nothing hints that the tabs exist.
 */
export function useListTab(): [ListTab, (tab: ListTab) => void] {
  const tab = useSyncExternalStore(subscribe, readTab, serverTab);

  const choose = useCallback((next: ListTab) => {
    const url = new URL(window.location.href);
    if (next === 'items') url.searchParams.delete(LIST_TAB_PARAM);
    else url.searchParams.set(LIST_TAB_PARAM, next);
    if (url.href === window.location.href) return;
    window.history.pushState(null, '', url);
    window.dispatchEvent(new Event(TAB_CHANGE_EVENT));
  }, []);

  return [tab, choose];
}
