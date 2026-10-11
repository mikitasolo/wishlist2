import type {
  GiftReminderNotificationType,
  GroupGiftNotificationType,
} from '@/lib/utils/notifications';
import type { OccasionKind } from '@/lib/utils/occasion';

/** The notification types that send an email of their own through `sendNotificationEmail`. */
export type EmailedNotificationType =
  | 'join_request'
  | 'link_join'
  | 'proposal'
  | 'role_changed'
  | 'removed_from_wishlist'
  | 'invite_accepted'
  | 'proposal_approved'
  | 'occasion_reminder'
  | 'birthday_reminder'
  | 'wishlist_ask'
  | 'asked_list_made'
  | GroupGiftNotificationType
  | GiftReminderNotificationType;

export interface NotificationEmailDetails {
  /** The recipient's account id, for the unsubscribe link (never shown). */
  recipientId: string;
  type: EmailedNotificationType;
  /**
   * Whoever did it, by username only, on the types whose in-app row names
   * them (`join_request`, `invite_accepted`, `link_join`), and whose birthday
   * it is on a `birthday_reminder`. Ignored on every other type.
   */
  actorUsername?: string | null;
  /** The list it's about: null on a `birthday_reminder` or `wishlist_ask`, which are about a person. */
  wishlistId: string | null;
  /** Free text: escaped in the HTML, isolated in the text part, never in the subject. */
  wishlistName: string | null;
  wishlistSlug?: string | null;
  /** `proposal_approved` and the group gift types: the item, as the in-app row names it. Free text. */
  itemName?: string | null;
  /** `occasion_reminder`, `gift_reminder` and `gift_nudge`. */
  occasionKind?: OccasionKind | null;
  /** Those three and `birthday_reminder`: the day it's about. */
  occasionDate?: string | null;
  /** `link_join` only: the share link's label, as its in-app row names it. Free text. */
  linkLabel?: string | null;
}

/**
 * Subject, heading and button of a notification email, and where the button
 * goes when not where the in-app row links. None carries free text: only the
 * actor's username, which `USERNAME_REGEX` bounds (see `invitationSubject`),
 * and fixed words.
 */
export interface NotificationEmailCopy {
  subject: string;
  heading: string;
  button: string;
  path?: string;
}

/**
 * One event's emails (WIS-375: a module per `NOTIFICATION_EVENTS` event): the
 * copy for each notification type it covers. `actor` is `@username`, or
 * "Someone" where the type doesn't name who did it.
 */
export type NotificationEmailCopies<T extends EmailedNotificationType> = {
  [K in T]: (details: NotificationEmailDetails, actor: string) => NotificationEmailCopy;
};
