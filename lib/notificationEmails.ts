import mongoose from 'mongoose';
import User from '@/models/User';
import NotificationEmailClaim from '@/models/NotificationEmailClaim';
import {
  sendNotificationEmail,
  type EmailedNotificationType,
  type NotificationEmailDetails,
} from '@/lib/email';
import { checkRateLimit, userKey, type LimiterName } from '@/lib/rateLimit';
import { errorKind } from '@/lib/utils/errorKind';
import { isDuplicateKeyError } from '@/lib/utils/mongoErrors';
import type { NotificationType } from '@/lib/utils/notifications';
import { notificationEventOf, notificationOptInFilter } from '@/lib/utils/notificationPrefs';

/**
 * Notification emails (WIS-321, the operator's decision of 2026-10-05), sent
 * beside the in-app rows by `createNotifications` (and, for occasion
 * reminders, by the daily cron through `sendOccasionReminderEmail`):
 *
 * - **Who**: each recipient whose email setting for the event is on
 *   (`recipientsWanting`, read at send time; `NOTIFICATION_EVENTS` has the
 *   defaults). Independent of the in-app setting.
 * - **What**: `sendNotificationEmail`, the in-app row's own line, so an email
 *   never says more than the notification.
 * - **Not**: `follow` (no email at all), and `wishlist_invite`, whose email
 *   `issueWishlistInvite` sends itself once the invite is known to stand.
 * - **Proposals** and **link joins** are coalesced: at most one email per list
 *   per owner a day each (`claimDailyListEmail`), however many arrive.
 * - **Limited** per recipient and kind (`EMAIL_LIMITERS`, fail-closed).
 * - **Best-effort**: called only once the action has landed, never for a list
 *   that's gone by then; a failure is logged by its kind, never with the
 *   recipient, and never fails the action.
 */

type Id = string | mongoose.Types.ObjectId;

/** Each emailed type's rate limit, keyed on the recipient. */
type EmailLimiterName = Extract<LimiterName, `email${string}`>;

export const EMAIL_LIMITERS: Record<EmailedNotificationType, EmailLimiterName> = {
  join_request: 'emailJoinRequest',
  link_join: 'emailLinkJoin',
  proposal: 'emailProposal',
  role_changed: 'emailAccessChanged',
  removed_from_wishlist: 'emailAccessChanged',
  invite_accepted: 'emailInviteAccepted',
  proposal_approved: 'emailProposalApproved',
  occasion_reminder: 'emailOccasionReminder',
  birthday_reminder: 'emailBirthdayReminder',
  wishlist_ask: 'emailWishlistAsk',
  asked_list_made: 'emailAskedListMade',
};

/**
 * The types whose email names who did it, as their in-app row does. Kept here
 * as well as in lib/email (which applies it again), so an anonymous type's
 * actor never reaches the sender at all.
 */
const NAMES_ACTOR: ReadonlySet<EmailedNotificationType> = new Set([
  'join_request',
  'invite_accepted',
  'link_join',
  'wishlist_ask',
  'asked_list_made',
]);

/**
 * How long a proposal (or link join) email holds off the next one of its kind
 * for the same list and owner.
 */
export const PROPOSAL_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The types emailed at most once per list per owner a day, by their claim. */
const DAILY_PER_LIST: ReadonlySet<EmailedNotificationType> = new Set(['proposal', 'link_join']);

/** The types `createNotifications` emails about (occasion and birthday reminders go through the cron). */
export function emailedByNotifications(type: NotificationType): type is EmailedNotificationType {
  return (
    type !== 'follow' &&
    type !== 'wishlist_invite' &&
    type !== 'occasion_reminder' &&
    type !== 'birthday_reminder'
  );
}

export interface NotificationEmailArgs {
  type: NotificationType;
  actorUsername?: string | null;
  wishlist?: Id | null;
  wishlistName?: string | null;
  wishlistSlug?: string | null;
  itemName?: string | null;
  linkLabel?: string | null;
}

/** The emailed types that are about a person, not a list (WIS-324's ask). */
const ABOUT_A_PERSON: ReadonlySet<EmailedNotificationType> = new Set(['wishlist_ask']);

/**
 * Email `recipients` (already narrowed to those who want this event's email,
 * see `recipientsWanting`) about a notification just written. Every email here
 * is about a list, but for an ask (`ABOUT_A_PERSON`): one with none is skipped. The caller has re-checked the
 * list after the rows were written (`createNotifications`' `dropIfWishlistGone`),
 * so none goes out about a list deleted meanwhile.
 */
export async function emailNotification(
  recipients: string[],
  args: NotificationEmailArgs
): Promise<void> {
  if (recipients.length === 0 || !emailedByNotifications(args.type)) return;
  const type = args.type;
  if (!args.wishlist && !ABOUT_A_PERSON.has(type)) return;
  try {
    // The setting again, as a second guard: only those who still want it.
    const users = await User.find({
      _id: { $in: recipients },
      ...notificationOptInFilter(notificationEventOf(type), 'email'),
    })
      .select('email')
      .lean();
    await Promise.all(
      users.map(async (user) => {
        if (!user.email) return;
        const recipientId = String(user._id);
        const wishlistId = args.wishlist ? String(args.wishlist) : null;
        await sendOne(
          user.email,
          {
            recipientId,
            type,
            // Anonymous types never carry one past here (`sendNotificationEmail`
            // drops it too): a proposal's proposer, a role change's owner.
            actorUsername: NAMES_ACTOR.has(type) ? (args.actorUsername ?? null) : null,
            wishlistId,
            wishlistName: args.wishlistName ?? null,
            wishlistSlug: args.wishlistSlug ?? null,
            itemName: args.itemName ?? null,
            linkLabel: type === 'link_join' ? (args.linkLabel ?? null) : null,
          },
          DAILY_PER_LIST.has(type)
            ? () =>
                claimDailyListEmail(type as DailyListEmailKind, recipientId, String(args.wishlist))
            : null
        );
      })
    );
  } catch (err) {
    console.error('Failed to send notification emails:', errorKind(err));
  }
}

/**
 * Send one notification email, if its claim (when it has one) is taken and the
 * recipient's limit for its kind allows it. A failed send gives the claim
 * back, so a later event (or the next cron run) can try again. Returns whether
 * it went out.
 */
export async function sendOne(
  email: string,
  details: NotificationEmailDetails,
  claim: (() => Promise<Claim | null>) | null
): Promise<boolean> {
  const taken = claim ? await claim() : null;
  if (claim && !taken) return false;
  try {
    if (!(await emailAllowed(EMAIL_LIMITERS[details.type], details.recipientId))) {
      await taken?.release();
      return false;
    }
    await sendNotificationEmail(email, details);
    return true;
  } catch (err) {
    // `deliver` has already reduced an SMTP failure to its codes: no recipient.
    console.error(`Failed to send a ${details.type} email:`, errorKind(err));
    await taken?.release();
    return false;
  }
}

/**
 * Whether the recipient's limit for this kind of email has room. Every email
 * limiter is keyed on the recipient's user id (`keyKind: 'user'`), which the
 * key type can't check across a union of limiter names, hence the one cast.
 */
export function emailAllowed(limiter: EmailLimiterName, recipientId: string): Promise<boolean> {
  return checkRateLimit(limiter as 'emailProposal', userKey(recipientId));
}

/** A claim on one email (`NotificationEmailClaim`), and how to give it back. */
export interface Claim {
  release(): Promise<void>;
}

function claimOf(id: mongoose.Types.ObjectId, sentAt: Date): Claim {
  return {
    async release() {
      try {
        // Only this claim: one taken again since (a day later) stays.
        await NotificationEmailClaim.deleteOne({ _id: id, sentAt });
      } catch (err) {
        console.error('Failed to release a notification email claim:', errorKind(err));
      }
    },
  };
}

/** The kinds of email claimed once per list per owner a day. */
export type DailyListEmailKind = 'proposal' | 'link_join';

/**
 * Claim the day's email of `kind` (a proposal to review, or someone joining
 * through a link) for one owner and list: taken when none of that kind was
 * sent in the last `PROPOSAL_EMAIL_WINDOW_MS`, and by one caller only. One
 * conditional upsert under the claim's unique index: a row from within the
 * window doesn't match, so the upsert's insert collides with it; two callers
 * racing past an old (or no) row both try, and the index lets one through.
 * Either collision reads as "already claimed".
 */
export async function claimDailyListEmail(
  kind: DailyListEmailKind,
  userId: string,
  wishlistId: string,
  now: Date = new Date()
): Promise<Claim | null> {
  const since = new Date(now.getTime() - PROPOSAL_EMAIL_WINDOW_MS);
  try {
    const row = await NotificationEmailClaim.findOneAndUpdate(
      { user: userId, kind, wishlist: wishlistId, key: '', sentAt: { $lte: since } },
      { $set: { sentAt: now } },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 }, lean: true }
    );
    return row ? claimOf(row._id, now) : null;
  } catch (err) {
    if (isDuplicateKeyError(err)) return null;
    console.error(`Failed to claim a ${kind} email:`, errorKind(err));
    return null;
  }
}

/** The proposal email's claim (`claimDailyListEmail`). */
export function claimProposalEmail(
  userId: string,
  wishlistId: string,
  now: Date = new Date()
): Promise<Claim | null> {
  return claimDailyListEmail('proposal', userId, wishlistId, now);
}

/**
 * Claim the occasion reminder email for one person, list and occurrence: taken
 * once, ever (until the row expires, long after the occurrence's reminder
 * window has passed).
 */
export async function claimOccasionReminderEmail(
  userId: Id,
  wishlistId: Id,
  occasionDate: string,
  now: Date = new Date()
): Promise<Claim | null> {
  try {
    const row = await NotificationEmailClaim.create({
      user: userId,
      kind: 'occasion_reminder',
      wishlist: wishlistId,
      key: occasionDate,
      sentAt: now,
    });
    return claimOf(row._id, now);
  } catch (err) {
    if (!isDuplicateKeyError(err)) {
      console.error('Failed to claim an occasion reminder email:', errorKind(err));
    }
    return null;
  }
}

/**
 * Claim a friend's birthday reminder email (WIS-345) for one friend, person
 * and occurrence: taken once, ever (until the row expires, long after the
 * reminder window has passed). The key carries whose birthday it is, so two
 * friends' birthdays on the same day are two claims.
 */
export async function claimBirthdayReminderEmail(
  userId: Id,
  personId: Id,
  occasionDate: string,
  now: Date = new Date()
): Promise<Claim | null> {
  try {
    const row = await NotificationEmailClaim.create({
      user: userId,
      kind: 'birthday_reminder',
      about: personId,
      key: birthdayClaimKey(personId, occasionDate),
      sentAt: now,
    });
    return claimOf(row._id, now);
  } catch (err) {
    if (!isDuplicateKeyError(err)) {
      console.error('Failed to claim a birthday reminder email:', errorKind(err));
    }
    return null;
  }
}

/** The claim key of a birthday reminder email: whose birthday, and which day. */
export function birthdayClaimKey(personId: Id, occasionDate: string): string {
  return `${String(personId)}:${occasionDate}`;
}

/**
 * Claim the birthday nudge email (WIS-344) for one person and the birthday on
 * `occurrence`: taken once per person and year (the occurrence's year), by one
 * caller only. No list.
 */
export async function claimBirthdayNudgeEmail(
  userId: Id,
  occurrence: string,
  now: Date = new Date()
): Promise<Claim | null> {
  try {
    const row = await NotificationEmailClaim.create({
      user: userId,
      kind: 'birthday_nudge',
      key: occurrence.slice(0, 4),
      sentAt: now,
    });
    return claimOf(row._id, now);
  } catch (err) {
    if (!isDuplicateKeyError(err)) {
      console.error('Failed to claim a birthday nudge email:', errorKind(err));
    }
    return null;
  }
}
