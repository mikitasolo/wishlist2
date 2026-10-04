/**
 * Which link clicks the unsaved-changes guard (`useLeaveGuard`) stops: the ones
 * that would take this tab to another page of the app, the way a Next `Link`
 * or a plain `<a>` does. A click that opens a new tab or window, downloads,
 * goes off-site or only moves to an anchor on this page leaves the edits where
 * they are, so it's let through.
 */

/** The parts of a click the guard looks at. */
export interface LeaveClick {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
}

/** Where to go: the path, query and hash of the app page the click would open, or `null` to let it through. */
export function guardedHref(click: LeaveClick, here: Location | URL): string | null {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  const target = click.target as Element | null;
  const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!anchor) return null;
  const opensElsewhere = anchor.target && anchor.target !== '_self';
  if (opensElsewhere || anchor.hasAttribute('download')) return null;

  let url: URL;
  try {
    url = new URL(anchor.getAttribute('href') ?? '', here.href);
  } catch {
    return null;
  }
  if (url.origin !== here.origin) return null;
  // Only the hash moves: the page, and the edits, stay.
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
