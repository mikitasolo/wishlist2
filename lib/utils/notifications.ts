import { plural } from '@/lib/utils/plural';
import type { IconName } from '@/components/Icon';
import { followersHref, profileHref } from '@/lib/utils/profileLinks';
import { formatBirthday } from '@/lib/utils/birthday';
import {
  formatOccasionDay,
  isCalendarDate,
  OCCASION_KINDS,
  type OccasionKind,
} from '@/lib/utils/occasion';

/**
 * The group gift notifications (WIS-364): to the gift's contributors who are
 * still plain members of its list, never its owners or anyone else, re-checked
 * when they're sent and again whenever the feed is read.
 */
export const GROUP_GIFT_NOTIFICATION_TYPES = [
  'group_gift_joined',
  'group_gift_funded',
  'group_gift_organizer',
  'group_gift_cancelled',
  'group_gift_converted',
  'group_gift_given',
] as const;

export type GroupGiftNotificationType = (typeof GROUP_GIFT_NOTIFICATION_TYPES)[number];

/** Whether `type` is about a group gift (`GROUP_GIFT_NOTIFICATION_TYPES`). */
export function isGroupGiftNotification(type: string): type is GroupGiftNotificationType {
  return (GROUP_GIFT_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

// The one list of notification types: the model's enum is built from it too.
export const NOTIFICATION_TYPES = [
  'follow',
  'wishlist_invite',
  'invite_accepted',
  'proposal',
  'proposal_approved',
  'role_changed',
  'removed_from_wishlist',
  'join_request',
  'occasion_reminder',
  'link_join',
  'birthday_reminder',
  'wishlist_ask',
  'asked_list_made',
  // WIS-364: to a group gift's contributors only (`lib/groupGiftNotifications.ts`).
  ...GROUP_GIFT_NOTIFICATION_TYPES,
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** How the recipient answered a `wishlist_invite`. The model's enum is built from it too. */
export const INVITE_ANSWERS = ['accepted', 'declined'] as const;

export type InviteAnswer = (typeof INVITE_ANSWERS)[number];

/** The role a `wishlist_invite` offers, recorded on its row. */
export const INVITE_ROLES = ['owner', 'member'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

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
  // A `wishlist_invite`: the role it offers. Null on every other type and on an
  // invite row written before it was recorded. Optional, like `count`.
  inviteRole?: InviteRole | null;
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
  // An `occasion_reminder`: the occasion's kind and the day it falls on (its
  // next occurrence, a real `YYYY-MM-DD`, never a yearly one's stored year).
  // A `birthday_reminder` carries the day too (the birthday's next one), and
  // no kind. Null on every other type. Optional, like `count`.
  occasionKind?: OccasionKind | null;
  occasionDate?: string | null;
  // A `link_join`: the label of the share link they joined through, as its
  // owners wrote it (free text), or null for a link without one. Null on every
  // other type. Optional, like `count`.
  linkLabel?: string | null;
  read: boolean;
  createdAt: string;
}

/**
 * The types whose row names who did it, so the feed shows that person's avatar
 * and the API looks them up (a join request: whoever asked, by their public
 * handle, which only the list's owners are sent). Never a proposal (anonymous to the owners), a
 * demotion or a removal (which never say which owner did it), or an approved
 * proposal (which carries no actor): those show their type's icon instead.
 */
const ACTOR_TYPES: ReadonlySet<NotificationType> = new Set([
  'follow',
  'wishlist_invite',
  'invite_accepted',
  'join_request',
  'link_join',
  // Whose birthday it is: a friend of the recipient's, who could see it.
  'birthday_reminder',
  // WIS-324: the friend who asked you for a wishlist, and the friend who made
  // the one you asked for.
  'wishlist_ask',
  'asked_list_made',
  // WIS-364: who joined a group gift, to its other contributors, who see each
  // other by name anyway. No other group gift row names anyone: an organizer
  // handover may follow a kick or a removal, which never says who did it.
  'group_gift_joined',
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
  if (n.inviteRole === 'owner') return [`${actor(n)} invited you to co-own `, list(n)];
  return [`${actor(n)} invited you to `, list(n)];
}

/**
 * A notification's line in pieces, so the feed can set list names apart. Never
 * assumes a non-null actor.
 */
export function notificationParts(
  n: NotificationView,
  { discreet = false }: { discreet?: boolean } = {}
): NotificationPart[] {
  // No spoiler mode (WIS-46): a group gift is a reservation, so its rows say
  // nothing about it on this device, not even which list or item.
  if (discreet && isGroupGiftNotification(n.type)) {
    return ['A group gift update, hidden by No spoiler mode'];
  }
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
    // To the list's owners only, naming the requester by their public handle.
    case 'join_request':
      return [`${actor(n)} asked to join `, list(n)];
    // To the list's owners only (WIS-337): who joined, by their public handle,
    // and through which of the list's links, by its label when it has one.
    case 'link_join':
      return n.linkLabel
        ? [`${actor(n)} joined `, list(n), ` through the link “${n.linkLabel}”`]
        : [`${actor(n)} joined `, list(n), ' through a link'];
    // To the list's members only, a week ahead (lib/utils/occasionReminders.ts).
    case 'occasion_reminder':
      return occasionReminderParts(n);
    // To the person's friends who may see their birthday, a week ahead
    // (lib/utils/birthdayReminders.ts): about the person, never a list.
    case 'birthday_reminder':
      return [birthdayReminderText(n)];
    // To the person asked only (WIS-324), naming the friend who asked.
    case 'wishlist_ask':
      return [`${actor(n)} wants to know what you’d like`];
    // To an asker only, and only while they could open the list (WIS-324).
    case 'asked_list_made':
      return [`${actor(n)} made a wishlist you asked for: `, list(n)];
    // To the gift's other contributors only (WIS-364): never an owner's.
    case 'group_gift_joined':
      return [`${actor(n)} joined `, ...groupGiftParts(n)];
    case 'group_gift_funded':
      return [...capitalized(groupGiftParts(n)), ' is fully funded'];
    // To the new organizer only, never naming who handed it on or why.
    case 'group_gift_organizer':
      return ['You’re now organizing ', ...groupGiftParts(n)];
    case 'group_gift_cancelled':
      return [...capitalized(groupGiftParts(n)), ' was cancelled'];
    case 'group_gift_converted':
      return [...capitalized(groupGiftParts(n)), ' is now the organizer’s own reservation'];
    case 'group_gift_given':
      return [...capitalized(groupGiftParts(n)), ' was marked as given'];
    default:
      return ['You have a new notification'];
  }
}

/** "the group gift for “Lego” on <list>", or "a group gift on <list>" with no item name. */
function groupGiftParts(n: NotificationView): NotificationPart[] {
  return n.itemName
    ? [`the group gift for “${n.itemName}” on `, list(n)]
    : ['a group gift on ', list(n)];
}

/** `parts` with its first letter capitalized, to start a line. */
function capitalized([first, ...rest]: NotificationPart[]): NotificationPart[] {
  if (typeof first !== 'string') return [first, ...rest];
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest];
}

/**
 * "Birthday coming up on Sat 17 Oct: " for an occasion reminder: the kind and the day,
 * formatted in the viewer's locale (never a countdown, which would go stale as
 * the row sits in the feed). Nothing about bookings or what's left to give.
 */
function occasionReminderParts(n: NotificationView): NotificationPart[] {
  const kind =
    n.occasionKind && (OCCASION_KINDS as readonly string[]).includes(n.occasionKind)
      ? OCCASION_REMINDER_KIND[n.occasionKind]
      : 'An occasion';
  const day =
    n.occasionDate && isCalendarDate(n.occasionDate) ? formatOccasionDay(n.occasionDate) : null;
  return day ? [`${kind} coming up on ${day}: `, list(n)] : [`${kind} coming up: `, list(n)];
}

/**
 * "@anna’s birthday is on March 14": whose and the day, with no year and no
 * countdown (which would go stale as the row sits in the feed). Nothing about
 * any list, item or booking, nor who else was reminded.
 */
function birthdayReminderText(n: NotificationView): string {
  const who = n.actorUsername ? `@${n.actorUsername}’s` : 'A friend’s';
  const day =
    n.occasionDate && isCalendarDate(n.occasionDate) ? formatBirthday(n.occasionDate) : '';
  return day ? `${who} birthday is on ${day}` : `${who} birthday is coming up`;
}

const OCCASION_REMINDER_KIND: Record<OccasionKind, string> = {
  birthday: 'Birthday',
  holiday: 'Holiday',
  wedding: 'Wedding',
  other: 'An occasion',
};

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
    case 'occasion_reminder':
    case 'asked_list_made':
    case 'group_gift_joined':
    case 'group_gift_funded':
    case 'group_gift_organizer':
    case 'group_gift_cancelled':
    case 'group_gift_converted':
    case 'group_gift_given':
      return listLink(n);
    case 'removed_from_wishlist':
      return null;
    // Their profile, not a list (an ask's Create a list is its own button).
    case 'birthday_reminder':
    case 'wishlist_ask':
      return n.actorUsername ? profileHref(n.actorUsername) : '/notifications';
    // The list's People tab: its Requests, and its members and share links.
    case 'join_request':
    case 'link_join':
      return n.wishlistSlug || n.wishlistId
        ? `/wishlists/${n.wishlistSlug ?? n.wishlistId}?tab=people`
        : '/notifications';
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
    case 'join_request':
      return 'user-plus';
    case 'link_join':
      return 'link';
    case 'occasion_reminder':
      return 'calendar';
    case 'birthday_reminder':
      return 'gift';
    case 'wishlist_ask':
    case 'asked_list_made':
      return 'list';
    case 'group_gift_joined':
    case 'group_gift_organizer':
      return 'users';
    case 'group_gift_funded':
    case 'group_gift_given':
      return 'check-circle';
    case 'group_gift_cancelled':
    case 'group_gift_converted':
      return 'gift';
    default:
      return 'bell';
  }
}
