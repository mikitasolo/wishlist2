import { plural } from '@/lib/utils/plural';
import type { IconName } from '@/components/Icon';
import { followersHref, profileHref } from '@/lib/utils/profileLinks';

// The one list of notification types: the model's enum is built from it too.
export const NOTIFICATION_TYPES = [
  'follow',
  'wishlist_invite',
  'invite_accepted',
  'proposal',
  'proposal_approved',
  'role_changed',
  'removed_from_wishlist',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** How the recipient answered a `wishlist_invite`. The model's enum is built from it too. */
export const INVITE_ANSWERS = ['accepted', 'declined'] as const;

export type InviteAnswer = (typeof INVITE_ANSWERS)[number];

// The client-facing shape (ids stringified) returned by /api/notifications.
export interface NotificationView {
  _id: string;
  type: NotificationType;
  // The latest actor (null when hidden, e.g. on a proposal).
  actorUsername: string | null;
  // How many events this row stands for; above 1 it's a coalesced burst.
  // Optional, like `actorUsernames`: a response from a server older than
  // coalescing has neither, and each of its rows is one event.
  count?: number;
  // Coalesced follows: the latest few actors, oldest first. Empty otherwise.
  actorUsernames?: string[];
  wishlistName: string | null;
  wishlistSlug: string | null;
  wishlistId: string | null;
  itemName: string | null;
  // A `wishlist_invite` its recipient has answered: how. Null while it's still
  // pending, and on every other type. Optional, like `count`: a response from a
  // server older than it has none.
  inviteAnswer?: InviteAnswer | null;
  // The actor as they are now, looked up by the account the row recorded (never
  // by `actorUsername`, which can change hands) when the feed is read with
  // `?actors=1`, on the types that show one (`showsActor`): their id (for
  // Follow back) and photo. Null when the type never shows an actor, the row is
  // from before rows recorded the account, or that account is gone. Optional,
  // like `count`.
  actorId?: string | null;
  actorImage?: string | null;
  // A `follow` row from one person: whether the recipient follows them now
  // (null on every other row), so the row offers Follow back only when not.
  followingActor?: boolean | null;
  read: boolean;
  createdAt: string;
}

/**
 * The types whose row names who did it, so the feed shows that person's avatar
 * and the API looks them up. Never a proposal (anonymous to the owners), a
 * demotion or a removal (which never say which owner did it), or an approved
 * proposal (which carries no actor): those show their type's icon instead.
 */
const ACTOR_TYPES: ReadonlySet<NotificationType> = new Set([
  'follow',
  'wishlist_invite',
  'invite_accepted',
]);

/** Whether a notification of `type` may show its actor (see `ACTOR_TYPES`). */
export function showsActor(type: NotificationType): boolean {
  return ACTOR_TYPES.has(type);
}

/**
 * A follow row that stands for several people (or one it can't name): the feed
 * opens the recipient's followers list for it, rather than one profile.
 */
export function isGroupFollow(n: NotificationView): boolean {
  return n.type === 'follow' && (countOf(n) > 1 || !n.actorUsername);
}

/**
 * The person a follow row offers Follow back to: its one follower, when the
 * recipient doesn't follow them yet. Null on every other row, and on one whose
 * follower isn't known by account (see `actorId`).
 */
export function followBackTarget(n: NotificationView): string | null {
  if (n.type !== 'follow' || isGroupFollow(n) || !n.actorId) return null;
  return n.followingActor === false ? n.actorId : null;
}

/** An invite answered on the page: its list, how, and when the invite was issued. */
export interface RecordedInviteAnswer {
  wishlistId: string;
  answer: InviteAnswer;
  /** The invite's `createdAt`, when known: its notification is no older. */
  since?: string | null;
}

/**
 * `rows` with each answered invite's notification reading as the answer, as
 * `recordInviteAnswer` writes it on the server: the recipient's unanswered
 * `wishlist_invite` rows for that list, written no earlier than the invite, now
 * answered and read. For a feed read that may predate the answer.
 */
export function withInviteAnswers(
  rows: NotificationView[],
  answers: RecordedInviteAnswer[]
): NotificationView[] {
  if (answers.length === 0) return rows;
  return rows.map((n) => {
    if (n.type !== 'wishlist_invite' || n.inviteAnswer) return n;
    const a = answers.find(
      (x) =>
        x.wishlistId === n.wishlistId &&
        (!x.since || new Date(n.createdAt).getTime() >= new Date(x.since).getTime())
    );
    return a ? { ...n, inviteAnswer: a.answer, read: true } : n;
  });
}

/**
 * One piece of a notification's line: plain text, or a list's name, which the
 * feed sets in semibold. A list's name is never quoted, whatever the type.
 */
export type NotificationPart = string | { listName: string };

const actor = (n: NotificationView) => (n.actorUsername ? `@${n.actorUsername}` : 'Someone');
// A row that recorded no name reads "a wishlist", as plain text.
const list = (n: NotificationView): NotificationPart =>
  n.wishlistName ? { listName: n.wishlistName } : 'a wishlist';
const countOf = (n: NotificationView) => Math.max(1, n.count ?? 1);

/** "@alice followed you" / "@bob and @alice followed you" / "@bob and 3 others followed you". */
function followText(n: NotificationView): string {
  const count = countOf(n);
  // Latest first; a row from before coalescing only has its single actor.
  const names = (n.actorUsernames?.length ? [...n.actorUsernames].reverse() : [n.actorUsername])
    .filter((name): name is string => !!name)
    .map((name) => `@${name}`);
  const [latest, previous] = names;
  if (!latest) return count === 1 ? 'Someone followed you' : `${count} people followed you`;
  if (count === 1) return `${latest} followed you`;
  if (count === 2 && previous) return `${latest} and ${previous} followed you`;
  const others = count - 1;
  return `${latest} and ${plural(others, 'other')} followed you`;
}

/**
 * An invite reads as one until its recipient answers it, and from then on as
 * their answer, which is recorded on the row when they give it
 * (`recordInviteAnswer` in lib/notifications.ts).
 */
function inviteParts(n: NotificationView): NotificationPart[] {
  if (n.inviteAnswer === 'accepted') return ['You joined ', list(n)];
  if (n.inviteAnswer === 'declined') return ['You declined the invite to ', list(n)];
  return [`${actor(n)} invited you to `, list(n)];
}

/**
 * A notification's line in pieces, so the feed can set list names apart. Never
 * assumes a non-null actor.
 */
export function notificationParts(n: NotificationView): NotificationPart[] {
  switch (n.type) {
    case 'follow':
      return [followText(n)];
    case 'wishlist_invite':
      return inviteParts(n);
    case 'invite_accepted':
      return [`${actor(n)} accepted your invitation to `, list(n)];
    case 'proposal':
      // Deliberately anonymous — owners must never learn who proposed an item,
      // so neither form reads an actor field.
      if (countOf(n) > 1) return [`${countOf(n)} new proposals on `, list(n)];
      return ['Someone proposed an item for ', list(n)];
    case 'proposal_approved':
      return n.itemName
        ? [`Your proposed item “${n.itemName}” was accepted in `, list(n)]
        : ['Your proposed item was accepted in ', list(n)];
    // Neither names who made the change (neutral, so it can't set co-owners
    // against each other; members can't see the members list anyway), and
    // neither mentions bookings: a released-booking count only ever goes back to
    // the gifter on their own actions.
    case 'role_changed':
      return ['You’re now a member of ', list(n)];
    case 'removed_from_wishlist':
      return ['You were removed from ', list(n)];
    default:
      return ['You have a new notification'];
  }
}

/** Human-readable line for a notification, as plain text. */
export function notificationText(n: NotificationView): string {
  return notificationParts(n)
    .map((part) => (typeof part === 'string' ? part : part.listName))
    .join('');
}

const listLink = (n: NotificationView) =>
  n.wishlistSlug || n.wishlistId
    ? `/wishlists/${n.wishlistSlug ?? n.wishlistId}`
    : '/notifications';

/**
 * Where clicking a notification should take the user, or null when it shouldn't
 * link anywhere: after a removal, or a declined invite, the list may not be
 * visible to them, and a pending invite is answered on Activity itself.
 *
 * `viewerUsername` is the recipient's own: a follow from several people links
 * to their followers, which live on their profile.
 */
export function notificationLink(
  n: NotificationView,
  viewerUsername?: string | null
): string | null {
  switch (n.type) {
    case 'follow':
      // One follower: their profile. Several, or one with no name to link to:
      // your own profile, with its followers list open.
      if (countOf(n) === 1 && n.actorUsername) return profileHref(n.actorUsername);
      return viewerUsername ? followersHref(viewerUsername) : '/notifications';
    case 'wishlist_invite':
      // Accepted: the list they joined. Pending: no link, since it's answered
      // on its card pinned above the feed (and the list may not be open to
      // them yet). Declined: no link either.
      if (n.inviteAnswer === 'accepted') return listLink(n);
      return null;
    case 'invite_accepted':
    case 'proposal':
    case 'proposal_approved':
    case 'role_changed':
      return listLink(n);
    case 'removed_from_wishlist':
      return null;
    default:
      return '/notifications';
  }
}

/** Icon that best represents the notification type. */
export function notificationIcon(n: NotificationView): IconName {
  switch (n.type) {
    case 'follow':
      return 'user';
    case 'wishlist_invite':
      return 'inbox';
    case 'invite_accepted':
      return 'check-circle';
    case 'proposal':
      return 'sparkles';
    case 'proposal_approved':
      return 'check-circle';
    case 'role_changed':
      return 'users';
    case 'removed_from_wishlist':
      return 'logout';
    default:
      return 'bell';
  }
}
