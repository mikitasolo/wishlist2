import { createHmac, timingSafeEqual } from 'crypto';
import {
  NOTIFICATION_EVENT_KEYS,
  offersChannel,
  type NotificationEvent,
} from '@/lib/utils/notificationPrefs';

/**
 * One-click unsubscribe links for notification emails (WIS-321).
 *
 * A link turns off one event's email for one account, and nothing else: it's
 * signed over the purpose, the account id and the event, so it can't be
 * replayed for another event, another account, or as any other kind of token.
 * It works signed out (an inbox is often on another device than the session),
 * so the signature is the whole authorization. It carries the account's id and
 * the event, never the email, and the page and endpoint it opens say nothing
 * about the account either.
 *
 * Links don't expire: RFC 8058 one-click unsubscribe is expected to keep
 * working for as long as the mail sits in an inbox, and the worst a leaked one
 * can do is what it says, turn that email off (Settings turns it back on).
 *
 * The key is derived from `NEXTAUTH_SECRET` with its own label, so there's no
 * new secret to configure, and an unsubscribe signature can't stand in for
 * anything Auth.js signs. Rotating that secret retires every link sent before;
 * the page then says so and points to Settings.
 */

const PURPOSE = 'unsubscribe';
const KEY_LABEL = 'wishlist:unsubscribe-link:v1';
const OBJECT_ID = /^[a-f0-9]{24}$/;

export interface UnsubscribeTarget {
  userId: string;
  event: NotificationEvent;
}

function signingKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set');
  return createHmac('sha256', secret).update(KEY_LABEL).digest();
}

function sign({ userId, event }: UnsubscribeTarget): string {
  return createHmac('sha256', signingKey())
    .update(`${PURPOSE}\n${userId}\n${event}`)
    .digest('base64url');
}

/** The query string of a link for `target`: `u`, `e` and `t` (the signature). */
export function unsubscribeQuery(target: UnsubscribeTarget): string {
  const params = new URLSearchParams({ u: target.userId, e: target.event, t: sign(target) });
  return params.toString();
}

/**
 * The two URLs an email for `target` carries: `page`, the link in its footer
 * (a page with one button, so a mail scanner opening links never unsubscribes
 * anyone), and `oneClick`, the `List-Unsubscribe` header's, which a mail
 * client POSTs to (RFC 8058).
 */
export function unsubscribeUrls(
  baseUrl: string,
  target: UnsubscribeTarget
): { page: string; oneClick: string } {
  const query = unsubscribeQuery(target);
  return {
    page: `${baseUrl}/unsubscribe?${query}`,
    oneClick: `${baseUrl}/api/unsubscribe?${query}`,
  };
}

/**
 * The target of a link's query, if it's one we signed for an event that has
 * email; `null` for anything else (a missing or tampered part, an event with no
 * email, a signature from another key).
 */
export function verifyUnsubscribe(params: {
  u?: string | null;
  e?: string | null;
  t?: string | null;
}): UnsubscribeTarget | null {
  const { u, e, t } = params;
  if (typeof u !== 'string' || typeof e !== 'string' || typeof t !== 'string') return null;
  if (!OBJECT_ID.test(u)) return null;
  const event = NOTIFICATION_EVENT_KEYS.find((k) => k === e);
  if (!event || !offersChannel(event, 'email')) return null;
  const expected = Buffer.from(sign({ userId: u, event }));
  const given = Buffer.from(t);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { userId: u, event };
}
