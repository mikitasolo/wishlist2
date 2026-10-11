'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from '@/components/Icon';
import {
  activeDestination,
  badgeText,
  navAccessibleName,
  navBadgeCount,
  navDestinations,
  type NavDestination,
  type NavDestinationId,
} from '@/lib/utils/appNav';

/**
 * The app's navigation (D3): Home, Reserved, Activity and Me
 * (`lib/utils/appNav.ts`), for a signed-in visitor only. A phone gets the
 * `TabBar` at the bottom of the screen, all four with an icon and a label;
 * from `sm` up the header carries `HeaderNav`, Home · Reserved · Activity as
 * text links, and Me is the avatar (the account menu opens the profile). The
 * page you're on is marked `aria-current="page"`, wherever it shows.
 *
 * Activity carries the unread signal (WIS-302, WIS-415): a dot at the tab icon's
 * corner on a phone, the count (up to 9+) beside the header's link, hidden at 0, and the link's accessible name says
 * it ("Activity, 3 unread"). It's the one unread signal; there's no bell. Both
 * take the count as `unread` from `AppHeader`, which reads it once
 * (`useUnreadNotifications`).
 */

/** The destination to mark on this page, if any. */
function useActive(username: string | null | undefined, pending: boolean): NavDestinationId | null {
  const active = activeDestination(usePathname(), username);
  // Waiting on the session, the username isn't known yet, so Me can't be told
  // from Settings: only the destinations with a fixed address are marked.
  return pending && active === 'me' ? null : active;
}

/**
 * A destination's count, drawn (the header link's): a small accent pill with up
 * to "9+" in it, in a fixed 20px-wide box so "3" and "9+" take the same room
 * and the link never widens when the count changes. Accent, not `danger`:
 * unread is a call to look, not an error (ui.md keeps red for errors and
 * destructive actions); the dark accent is light, hence `text-background`.
 * Hidden from assistive tech, since the link's own name says the count.
 */
function Badge({ count }: { count: number }) {
  return (
    <span
      aria-hidden="true"
      data-badge=""
      className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-badge font-semibold leading-none tabular-nums text-background"
    >
      {badgeText(count)}
    </span>
  );
}

/**
 * The phone tab's unread signal: a dot, no number (the count is in the link's
 * name and on the Activity page), at the icon's top-right corner and clear of
 * the glyph. The ring keeps it apart from the icon on either surface.
 */
function Dot() {
  return (
    <span
      aria-hidden="true"
      data-dot=""
      className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface"
    />
  );
}

/**
 * The header's links, from `sm` up. Their addresses don't depend on who's
 * signed in, so they can be drawn while the session loads (`AppHeader` shows
 * them then only under the session hint, and with no count).
 */
export function HeaderNav({
  username,
  unread = 0,
  pending = false,
  className = '',
}: {
  username?: string | null;
  /** Unread notifications, for Activity's count (header) and dot (tab bar). */
  unread?: number;
  /** The session is still loading. */
  pending?: boolean;
  /** Its display, which `AppHeader` decides (hidden on a phone, and beside an open search). */
  className?: string;
}) {
  const active = useActive(username, pending);
  return (
    <nav aria-label="Main" className={`items-center gap-1 ${className}`}>
      {navDestinations(username)
        .filter((d) => d.id !== 'me')
        .map((d) => {
          const current = d.id === active;
          const count = navBadgeCount(d.id, unread);
          return (
            <Link
              key={d.id}
              href={d.href}
              aria-current={current ? 'page' : undefined}
              aria-label={navAccessibleName(d, unread)}
              data-tour={d.id === 'reserved' ? 'reserved' : undefined}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
                current
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {d.label}
              {count > 0 && <Badge count={count} />}
            </Link>
          );
        })}
    </nav>
  );
}

const TAB_CLASSES =
  'flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors';

function tabColor(current: boolean) {
  return current ? 'text-accent' : 'text-muted-foreground hover:text-foreground';
}

function TabContent({ destination, count = 0 }: { destination: NavDestination; count?: number }) {
  return (
    <>
      <span className="relative flex">
        <Icon name={destination.icon} size={18} />
        {count > 0 && <Dot />}
      </span>
      <span>{destination.label}</span>
    </>
  );
}

/**
 * The phone's tab bar, fixed to the bottom of the screen below `sm` (and clear
 * of an iPhone's home indicator). The page that holds it pads its bottom by
 * its height (globals.css, `[data-tab-bar]`), so nothing ends up behind it.
 *
 * `pending`: the session is still loading. Me's address isn't known yet, so
 * the bar is drawn with no links in it, as a placeholder that's shown (and
 * makes room) only where the session hint expects someone signed in, and is
 * hidden from assistive tech. The real bar replaces it in the same place. Its
 * Activity has no dot yet: the count is read once the session is known, and
 * the dot sits over the icon's corner, so it moves nothing when it comes.
 */
export function TabBar({
  username,
  unread = 0,
  pending = false,
}: {
  username?: string | null;
  /** Unread notifications, for Activity's count (header) and dot (tab bar). */
  unread?: number;
  pending?: boolean;
}) {
  const active = useActive(username, pending);
  const destinations = navDestinations(username);
  // Under the header (z-40), so what overflows the header (the phone search's
  // results, the account menu) is drawn over the bar, not under it.
  const frame =
    'glass fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]';

  if (pending) {
    return (
      <div
        data-tab-bar="pending"
        aria-hidden="true"
        className={`${frame} hidden max-sm:session-hint:grid`}
      >
        {destinations.map((d) => (
          <span key={d.id} className={`${TAB_CLASSES} ${tabColor(d.id === active)}`}>
            <TabContent destination={d} />
          </span>
        ))}
      </div>
    );
  }

  return (
    <nav aria-label="Main" data-tab-bar="shown" className={`${frame} sm:hidden`}>
      {destinations.map((d) => {
        const current = d.id === active;
        return (
          <Link
            key={d.id}
            href={d.href}
            aria-current={current ? 'page' : undefined}
            aria-label={navAccessibleName(d, unread)}
            // Where the guided walkthrough's Reserved step points (WIS-436).
            data-tour={d.id === 'reserved' ? 'reserved' : undefined}
            className={`${TAB_CLASSES} ${tabColor(current)}`}
          >
            <TabContent destination={d} count={navBadgeCount(d.id, unread)} />
          </Link>
        );
      })}
    </nav>
  );
}
