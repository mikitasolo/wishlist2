import mongoose, { type FilterQuery } from 'mongoose';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import Notification from '@/models/Notification';
import { createOccasionReminders } from '@/lib/notifications';
import NotificationEmailClaim from '@/models/NotificationEmailClaim';
import { claimOccasionReminderEmail, sendOne } from '@/lib/notificationEmails';
import { notificationOptInFilter } from '@/lib/utils/notificationPrefs';
import {
  addDays,
  daysBetween,
  nextOccurrence,
  utcDateString,
  YEARLY_PLACEHOLDER_YEAR,
  type Occasion,
} from '@/lib/utils/occasion';

/**
 * Occasion reminders (WIS-193): a week before a list's occasion, each of its
 * members gets one `occasion_reminder` in Activity. The daily cron
 * (`GET /api/cron/occasion-reminders`) runs `sendOccasionReminders`.
 *
 * - **Who**: the list's members (`WishlistMember`) as they are when it runs,
 *   never its owners, and never friends who could merely see it. Not on an
 *   archived list. Not to anyone who turned occasion reminders off in Settings
 *   (`notificationPrefs.occasion_reminder.inApp`).
 * - **When**: `OCCASION_REMINDER_LEAD_DAYS` (7) before the next occurrence,
 *   counted from the server's UTC date. Vercel Cron on Hobby runs once a day
 *   with loose timing and never retries, so a list still reminds its members up
 *   to `OCCASION_REMINDER_CATCH_UP_DAYS` later than that: after a missed run, or
 *   for those a capped run didn't reach. The reminder names the day itself, so
 *   it reads right whichever day it lands.
 * - **Once**: per person, list and occurrence (a unique index on the reminder,
 *   `createOccasionReminders`), so re-runs and overlapping runs send nothing new.
 * - **Capped**: at most `OCCASION_REMINDER_MAX_PER_RUN` new reminders a run,
 *   nearest occasion first, so the lists closest to their last day go first and
 *   the rest carry over to the next run.
 * - **Email** (WIS-321): the same people, the same once-per-occurrence and the
 *   same window, but its own setting (`notificationPrefs.occasion_reminder.email`,
 *   on by default) and its own record of what was sent (`NotificationEmailClaim`),
 *   so turning the in-app reminder off doesn't stop the email, nor the other way
 *   round. Capped at `OCCASION_EMAIL_MAX_PER_RUN` a run (`sendReminderEmails`).
 */

export const OCCASION_REMINDER_LEAD_DAYS = 7;
export const OCCASION_REMINDER_CATCH_UP_DAYS = 2;
export const OCCASION_REMINDER_MAX_PER_RUN = 500;
/**
 * At most this many reminder emails a run (WIS-321): each is an SMTP send
 * inside the cron's 60s, so far fewer than the in-app rows. Like those, the
 * rest carry over to the next run, within the catch-up window.
 */
export const OCCASION_EMAIL_MAX_PER_RUN = 50;

/**
 * The days counted from `today` that a reminder is due on, nearest first: from
 * `lead - catchUp` to `lead`. The occasion reminders' own by default; the
 * birthday nudge's email passes its own lead and catch-up.
 */
export function reminderDayOffsets(
  lead: number = OCCASION_REMINDER_LEAD_DAYS,
  catchUp: number = OCCASION_REMINDER_CATCH_UP_DAYS
): number[] {
  const offsets: number[] = [];
  for (let d = lead - catchUp; d <= lead; d++) offsets.push(d);
  return offsets;
}

/**
 * The stored `occasion.date` values whose next occurrence is `target`: the
 * one-off on that day, and the yearly one on its month and day (stored on the
 * placeholder year). On Feb 28 of a year with no Feb 29, a yearly Feb 29 one
 * falls then too (`nextOccurrence`).
 */
export function storedDatesFor(target: string): string[] {
  const [, month, day] = target.split('-');
  if (!month || !day) return [];
  const dates = [target, `${YEARLY_PLACEHOLDER_YEAR}-${month}-${day}`];
  if (month === '02' && day === '28' && addDays(target, 1)?.endsWith('-03-01')) {
    dates.push(`${YEARLY_PLACEHOLDER_YEAR}-02-29`);
  }
  // A one-off stored on 2000 itself matches too: long past, so
  // `listsDueForReminder` drops it once it works out the next occurrence.
  return dates;
}

export interface DueList {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug?: string | null;
  owners: mongoose.Types.ObjectId[];
  occasion: Occasion;
  /** Its next occurrence, which the reminder is about. */
  occasionDate: string;
  /** Days from today until then. */
  days: number;
}

/**
 * The stored dates (`storedDatesFor`) whose next occurrence may fall on one of
 * `offsets` days from `today`: what a query for due occasions (or birthdays)
 * matches before the exact day is worked out.
 */
export function storedDatesDue(today: string, offsets: number[] = reminderDayOffsets()): string[] {
  return Array.from(new Set(offsets.flatMap((d) => storedDatesFor(addDays(today, d) ?? ''))));
}

/**
 * The unarchived lists whose occasion next falls within the reminder window
 * from `today`, nearest first. `filter` narrows the lists read (the birthday
 * reminders read one person's Birthday lists through it); it can't widen the
 * rule: archived lists and dates outside the window stay out.
 */
export async function listsDueForReminder(
  today: string,
  filter: FilterQuery<IWishlist> = {}
): Promise<DueList[]> {
  const offsets = reminderDayOffsets();
  const lists = await Wishlist.find({
    ...filter,
    archived: { $ne: true },
    'occasion.date': { $in: storedDatesDue(today, offsets) },
  })
    .select('name slug owners occasion')
    .lean();

  const due: DueList[] = [];
  for (const list of lists) {
    const occasion = list.occasion;
    if (!occasion) continue;
    const next = nextOccurrence(occasion.date, occasion.recurrence ?? null, today);
    const days = next === null ? null : daysBetween(today, next);
    if (next === null || days === null || !offsets.includes(days)) continue;
    due.push({ ...list, occasion, occasionDate: next, days });
  }
  return due.sort((a, b) => a.days - b.days || String(a._id).localeCompare(String(b._id)));
}

/**
 * Who of a list's members still needs this occurrence's reminder: members (not
 * owners) who get occasion reminders and haven't had this one.
 */
async function pendingRecipients(list: DueList): Promise<mongoose.Types.ObjectId[]> {
  const members = await WishlistMember.find({ wishlist: list._id }).select('user').lean();
  const owners = new Set(list.owners.map(String));
  const ids = members.map((m) => m.user).filter((id) => !owners.has(String(id)));
  if (ids.length === 0) return [];
  const [wanting, reminded] = await Promise.all([
    User.find({ _id: { $in: ids }, ...notificationOptInFilter('occasion_reminder', 'inApp') })
      .select('_id')
      .lean(),
    Notification.find({
      type: 'occasion_reminder',
      wishlist: list._id,
      occasionDate: list.occasionDate,
      user: { $in: ids },
    })
      .select('user')
      .lean(),
  ]);
  const done = new Set(reminded.map((n) => String(n.user)));
  return wanting
    .map((u) => u._id)
    .filter((id) => !done.has(String(id)))
    .sort((a, b) => String(a).localeCompare(String(b)));
}

export interface OccasionReminderRun {
  /** Lists that had someone to remind. */
  lists: number;
  /** New reminders written (and still standing after their re-check). */
  sent: number;
  /** The run stopped at the cap with reminders left to send. */
  capped: boolean;
  /** Reminder emails sent. */
  emailed: number;
}

/**
 * Who of a list's members still needs this occurrence's reminder email:
 * members (not owners) whose reminder email is on and who haven't had it.
 */
async function pendingEmailRecipients(list: DueList): Promise<mongoose.Types.ObjectId[]> {
  const members = await WishlistMember.find({ wishlist: list._id }).select('user').lean();
  const owners = new Set(list.owners.map(String));
  const ids = members.map((m) => m.user).filter((id) => !owners.has(String(id)));
  if (ids.length === 0) return [];
  const [wanting, emailed] = await Promise.all([
    User.find({ _id: { $in: ids }, ...notificationOptInFilter('occasion_reminder', 'email') })
      .select('_id')
      .lean(),
    NotificationEmailClaim.find({
      kind: 'occasion_reminder',
      wishlist: list._id,
      key: list.occasionDate,
      user: { $in: ids },
    })
      .select('user')
      .lean(),
  ]);
  const done = new Set(emailed.map((c) => String(c.user)));
  return wanting
    .map((u) => u._id)
    .filter((id) => !done.has(String(id)))
    .sort((a, b) => String(a).localeCompare(String(b)));
}

/**
 * Email up to `budget` of a due list's members their reminder, and return how
 * many went out. Each is claimed first (once per person, list and occurrence,
 * under the claim's unique index, so overlapping runs send it once), then the
 * list and the person are read again: a list archived, deleted or moved to
 * another day since, or a person who left, became an owner or turned the email
 * off, gives the claim back and gets nothing.
 */
async function sendReminderEmails(
  list: DueList,
  users: mongoose.Types.ObjectId[]
): Promise<number> {
  let emailed = 0;
  for (const user of users) {
    const claim = await claimOccasionReminderEmail(user, list._id, list.occasionDate);
    if (!claim) continue;
    const [now, member, recipient] = await Promise.all([
      Wishlist.findById(list._id).select('name slug owners archived occasion').lean(),
      WishlistMember.exists({ wishlist: list._id, user }),
      User.findOne({ _id: user, ...notificationOptInFilter('occasion_reminder', 'email') })
        .select('email')
        .lean(),
    ]);
    const occasion = now?.occasion;
    const stillDue =
      !!now &&
      !now.archived &&
      !!occasion &&
      nextOccurrence(occasion.date, occasion.recurrence ?? null, list.occasionDate) ===
        list.occasionDate &&
      !now.owners.some((o) => String(o) === String(user));
    if (!stillDue || !member || !recipient?.email) {
      await claim.release();
      continue;
    }
    const sent = await sendOne(
      recipient.email,
      {
        recipientId: String(user),
        type: 'occasion_reminder',
        wishlistId: String(list._id),
        wishlistName: now.name,
        wishlistSlug: now.slug ?? null,
        occasionKind: occasion.kind,
        occasionDate: list.occasionDate,
      },
      async () => claim
    );
    if (sent) emailed += 1;
  }
  return emailed;
}

/** One daily run: remind every due list's members, up to the cap (see the top of this file). */
export async function sendOccasionReminders(
  now: Date = new Date(),
  maxPerRun: number = OCCASION_REMINDER_MAX_PER_RUN,
  maxEmailsPerRun: number = OCCASION_EMAIL_MAX_PER_RUN
): Promise<OccasionReminderRun> {
  const today = utcDateString(now);
  const run: OccasionReminderRun = { lists: 0, sent: 0, capped: false, emailed: 0 };
  const due = await listsDueForReminder(today);
  for (const list of due) {
    const pending = await pendingRecipients(list);
    if (pending.length === 0) continue;
    const room = maxPerRun - run.sent;
    if (room <= 0) {
      run.capped = true;
      break;
    }
    if (pending.length > room) run.capped = true;
    run.lists += 1;
    run.sent += await createOccasionReminders({
      wishlist: list,
      occasion: list.occasion,
      occasionDate: list.occasionDate,
      users: pending.slice(0, room),
    });
    if (run.capped) break;
  }
  // Emails after every in-app row, with their own cap, nearest occasion first.
  for (const list of due) {
    const room = maxEmailsPerRun - run.emailed;
    if (room <= 0) break;
    const pending = await pendingEmailRecipients(list);
    if (pending.length === 0) continue;
    run.emailed += await sendReminderEmails(list, pending.slice(0, room));
  }
  return run;
}
