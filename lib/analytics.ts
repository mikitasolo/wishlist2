/**
 * Product analytics (WIS-329): page views and a few product events, counted in
 * Umami Cloud for the operator, and nothing else. Umami is cookie-less (a daily
 * salted hash stands in for a session), so there's no consent banner.
 *
 * The script is loaded only in production with `NEXT_PUBLIC_UMAMI_WEBSITE_ID`
 * set (`getUmamiWebsiteId` in `lib/env.ts`, rendered by `components/Analytics`),
 * with its own page views and click tracking off. Everything it sends goes
 * through here, and only as:
 *
 * - **a page view** (`trackPageView`), whose URL is the route's pattern, never
 *   the path itself: `/l/[token]`, `/wishlists/[id]`, `/users/[username]`. A
 *   share token is a credential, and an id or a username says who or which
 *   list. No query string, no hash, and the page title is the same pattern
 *   (a title names lists and people).
 * - **an event** (`track`) from `ANALYTICS_EVENTS`, fired only once its write
 *   has succeeded, with props that are coarse enums from the same table. An
 *   unknown event isn't sent; an unknown prop or value is dropped.
 *
 * The referrer is a pattern too: an earlier page of ours as its pattern, any
 * other site as its origin only. `scrubPayload` enforces all of it once more on
 * whatever the script is about to send (its `data-before-send` hook), so a
 * future call site that slips can't send a raw URL.
 *
 * Never send who reserved, joined or left what, and never fire a reservation
 * event from anything an owner sees (owners never learn about reservations,
 * and analytics answers to that too, though only the operator reads it).
 * No call site talks to `window.umami` directly.
 */

/** Umami Cloud's tracker, and the endpoint it posts to (also allowed by the CSP in next.config.js). */
export const UMAMI_SCRIPT_URL = 'https://cloud.umami.is/script.js';
export const UMAMI_HOST_URL = 'https://gateway.umami.is';
/** The global the tracker's `data-before-send` names. */
export const UMAMI_BEFORE_SEND = '__wishlistUmamiBeforeSend';

const VISIBILITY = ['everyone', 'friends', 'private'] as const;
const ROLE = ['owner', 'member'] as const;

/**
 * Every event, and the props each may carry: a closed set of values per prop,
 * never free text. A new event or prop goes here (and in the analytics note in
 * docs/agents/backend.md) and must say nothing about who or which list.
 */
export const ANALYTICS_EVENTS = {
  /** A new list: from New list, or Start a new list from an old one. */
  list_created: { visibility: VISIBILITY, source: ['new', 'copy'] },
  /** An item on a list: an owner's add, or a member's proposal. */
  item_added: { kind: ['own', 'proposal'] },
  /** A member reserved an item, on the list. */
  reserve: {},
  /** A member released a reservation: on the list or on Reserved. */
  release: { from: ['list', 'reserved_page'] },
  /** A reservation marked as given, on Reserved. */
  mark_given: {},
  /** An invite sent: to one person, or to a group. */
  invite_sent: { role: ROLE, to: ['person', 'group'] },
  invite_accepted: { role: ROLE },
  /** Ask to join, sent. */
  join_requested: {},
  /** Save to my list: a copy of someone's item saved to one's own list. */
  save_to_my_list: {},
  /** Coming up's Find a gift. */
  find_a_gift: {},
  /** A live share link opened (not an owner's Preview as visitor). */
  share_link_opened: { level: ['view', 'join'] },
  /** An owner shared their list: its link copied or shared, or a share link made. */
  list_shared: { method: ['copy', 'share_sheet', 'share_link'] },
  /** The guided walkthrough (WIS-371) began: on its own, from the offer, or from Settings. */
  tour_started: { source: ['auto', 'offer', 'settings'] },
  tour_finished: {},
  /** Skipped, at which step (`TourStep.key`, lib/utils/tourSteps.ts). */
  tour_skipped: {
    step: ['lists', 'items', 'sharing', 'friends', 'reserving', 'reserved', 'bookmarklet'],
  },
  /** The offer made after three months away, answered. */
  tour_offer_accepted: {},
  tour_offer_dismissed: {},
} as const satisfies Record<string, Record<string, readonly string[]>>;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsProps<E extends AnalyticsEvent> = {
  [
    K in keyof (typeof ANALYTICS_EVENTS)[E]
  ]?: (typeof ANALYTICS_EVENTS)[E][K] extends readonly (infer V)[] ? V : never;
};

export function isAnalyticsEvent(name: unknown): name is AnalyticsEvent {
  return typeof name === 'string' && Object.hasOwn(ANALYTICS_EVENTS, name);
}

/**
 * Only the props `event` allows, each only with an allowed value; anything else
 * is dropped. `undefined` when nothing is left (Umami then sends no data).
 */
export function sanitizeProps(
  event: AnalyticsEvent,
  props: unknown
): Record<string, string> | undefined {
  if (typeof props !== 'object' || props === null) return undefined;
  const allowed: Record<string, readonly string[]> = ANALYTICS_EVENTS[event];
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!Object.hasOwn(allowed, key)) continue;
    if (typeof value === 'string' && allowed[key].includes(value)) kept[key] = value;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Pages with no dynamic segment: sent as they are. */
const STATIC_PATHS = new Set([
  '/',
  '/auth/error',
  '/auth/signin',
  '/auth/verify-request',
  '/booked',
  '/invites',
  '/items',
  '/items/new',
  '/notifications',
  '/settings',
  '/unsubscribe',
  '/welcome',
  '/wishlists/mine',
  '/wishlists/shared',
]);

/** Pages with one: sent as their pattern, whatever the segment holds. */
const DYNAMIC_PATHS: readonly [RegExp, string][] = [
  [/^\/l\/[^/]+$/, '/l/[token]'],
  [/^\/users\/[^/]+$/, '/users/[username]'],
  [/^\/wishlists\/[^/]+$/, '/wishlists/[id]'],
];

/** Any other path (a 404, say): it could hold anything, so it's never sent. */
export const UNKNOWN_PATH = '/[unknown]';

/**
 * A path as its route's pattern: no query, no hash, no trailing slash, and every
 * dynamic segment (a share token, a list's id or slug, a username) replaced by
 * its name. Idempotent: a pattern maps to itself.
 */
export function normalizePath(path: string): string {
  let p = path.split(/[?#]/, 1)[0];
  if (!p.startsWith('/')) return UNKNOWN_PATH;
  if (p.length > 1) p = p.replace(/\/+$/, '') || '/';
  if (STATIC_PATHS.has(p)) return p;
  for (const [re, pattern] of DYNAMIC_PATHS) if (re.test(p)) return pattern;
  return UNKNOWN_PATH;
}

/**
 * A referrer fit to send: one of our pages as its pattern (absolute, on our
 * origin), another site as its origin alone, anything else (none, unparsable)
 * as none.
 */
export function scrubReferrer(referrer: unknown, origin: string): string {
  if (typeof referrer !== 'string' || referrer === '') return '';
  let url: URL;
  try {
    url = new URL(referrer, origin);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  return url.origin === origin ? `${origin}${normalizePath(url.pathname)}` : url.origin;
}

/** A URL or path as the pattern of its path (see `normalizePath`). */
function urlPattern(value: unknown, origin: string): string {
  if (typeof value !== 'string') return UNKNOWN_PATH;
  try {
    return normalizePath(new URL(value, origin).pathname);
  } catch {
    return UNKNOWN_PATH;
  }
}

type UmamiPayload = Record<string, unknown>;

/**
 * What may leave for Umami, rebuilt from scratch out of `payload`: the site's
 * own fields, the URL and title as a route pattern, a scrubbed referrer, and for
 * an event its name and allowed props. Anything else the tracker adds (an
 * `id`, a `tag`) is dropped. `null`, so nothing is sent, for an event that
 * isn't ours.
 */
export function scrubPayload(payload: unknown, origin: string): UmamiPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as UmamiPayload;
  const url = urlPattern(p.url, origin);
  const out: UmamiPayload = {
    website: p.website,
    hostname: p.hostname,
    screen: p.screen,
    language: p.language,
    url,
    title: url,
    referrer: scrubReferrer(p.referrer, origin),
  };
  if (p.name !== undefined) {
    if (!isAnalyticsEvent(p.name)) return null;
    out.name = p.name;
    const data = sanitizeProps(p.name, p.data);
    if (data) out.data = data;
  }
  return out;
}

interface Umami {
  track: (payload: (base: UmamiPayload) => UmamiPayload) => unknown;
}

declare global {
  interface Window {
    umami?: Umami;
    [UMAMI_BEFORE_SEND]?: (type: string, payload: unknown) => UmamiPayload | null;
  }
}

function tracker(): Umami | null {
  if (typeof window === 'undefined') return null;
  const umami = window.umami;
  return umami && typeof umami.track === 'function' ? umami : null;
}

/** The tracker's last-chance scrub (its `data-before-send`): see `scrubPayload`. */
export function installBeforeSend(): void {
  if (typeof window === 'undefined') return;
  window[UMAMI_BEFORE_SEND] = (_type, payload) => scrubPayload(payload, window.location.origin);
}

function send(payload: (base: UmamiPayload) => UmamiPayload): boolean {
  const umami = tracker();
  if (!umami) return false;
  try {
    umami.track(payload);
    return true;
  } catch {
    // Analytics never gets in the way of the app.
    return false;
  }
}

/** The pattern of the last page view sent: the next one's referrer. */
let lastPage: string | null = null;

/**
 * A page view of `pathname`, as its pattern. The referrer is the previous page
 * sent (in-app navigation), or for the first the document's own, scrubbed. A
 * no-op, returning false, while Umami isn't loaded.
 */
export function trackPageView(pathname: string): boolean {
  if (!tracker()) return false;
  const origin = window.location.origin;
  const url = normalizePath(pathname);
  const referrer =
    lastPage !== null ? `${origin}${lastPage}` : scrubReferrer(document.referrer, origin);
  const sent = send((base) => scrubPayload({ ...base, url, referrer }, origin) ?? {});
  if (sent) lastPage = url;
  return sent;
}

/**
 * A product event, on the page it happened on (as its pattern). Fire it only
 * once the write it counts has succeeded. A no-op, returning false, while
 * Umami isn't loaded.
 */
export function track<E extends AnalyticsEvent>(event: E, props?: AnalyticsProps<E>): boolean {
  if (!tracker() || !isAnalyticsEvent(event)) return false;
  const origin = window.location.origin;
  return send(
    (base) =>
      scrubPayload(
        { ...base, url: window.location.pathname, referrer: '', name: event, data: props },
        origin
      ) ?? {}
  );
}

/** Test seam: forget the last page view. */
export function resetAnalyticsForTests(): void {
  lastPage = null;
}
