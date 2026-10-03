import type { IconName } from '@/components/Icon';

/**
 * The app's four destinations (D3): Home, Reserved, Activity and Me. A phone
 * shows all four in the tab bar; from `sm` up the header links the first three
 * and Me is the avatar (its menu opens the profile). See `components/AppNav.tsx`.
 */
export type NavDestinationId = 'home' | 'reserved' | 'activity' | 'me';

export interface NavDestination {
  id: NavDestinationId;
  label: string;
  href: string;
  icon: IconName;
}

/**
 * Home's own pages: the dashboard, and the pages its "See all" and "All items"
 * links open. A list's page (`/wishlists/<id>`) isn't one: it may be yours or
 * someone else's, reached from a profile or a search as often as from Home, so
 * no destination is marked on it.
 */
const HOME_PATHS = ['/', '/wishlists/mine', '/wishlists/shared', '/items'];
const RESERVED_PATHS = ['/booked'];
/** `/invites` only redirects to Activity, but it's Activity while it does. */
const ACTIVITY_PATHS = ['/notifications', '/invites'];

/**
 * Where Me goes: your profile, or, for an account with no username yet (it
 * has no profile address), Settings, where the username is set.
 */
export function meHref(username: string | null | undefined): string {
  return username ? `/users/${encodeURIComponent(username)}` : '/settings';
}

export function navDestinations(username: string | null | undefined): NavDestination[] {
  return [
    { id: 'home', label: 'Home', href: '/', icon: 'home' },
    { id: 'reserved', label: 'Reserved', href: '/booked', icon: 'gift' },
    { id: 'activity', label: 'Activity', href: '/notifications', icon: 'bell' },
    { id: 'me', label: 'Me', href: meHref(username), icon: 'user' },
  ];
}

/** `/booked/` and `/booked` alike; the root stays `/`. */
function normalize(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * The destination the page at `pathname` belongs to, or null when it's none
 * of them (a list's page, someone else's profile, sign-in). Me is your own
 * profile only (usernames are lowercase, but an address typed in capitals
 * still opens it), or Settings while you have no username.
 */
export function activeDestination(
  pathname: string | null | undefined,
  username: string | null | undefined
): NavDestinationId | null {
  if (!pathname) return null;
  const path = normalize(pathname);
  if (HOME_PATHS.includes(path)) return 'home';
  if (RESERVED_PATHS.includes(path)) return 'reserved';
  if (ACTIVITY_PATHS.includes(path)) return 'activity';
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    /* a malformed escape: compare it as it is */
  }
  const me = username ? `/users/${username}` : '/settings';
  if (decoded.toLowerCase() === me.toLowerCase()) return 'me';
  return null;
}
