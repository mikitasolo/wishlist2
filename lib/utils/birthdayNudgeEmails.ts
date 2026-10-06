import mongoose from 'mongoose';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import NotificationEmailClaim from '@/models/NotificationEmailClaim';
import { sendBirthdayNudgeEmail } from '@/lib/email';
import { claimBirthdayNudgeEmail, emailAllowed } from '@/lib/notificationEmails';
import { errorKind } from '@/lib/utils/errorKind';
import { notificationOptInFilter } from '@/lib/utils/notificationPrefs';
import { utcDateString } from '@/lib/utils/occasion';
import { reminderDayOffsets, storedDatesDue } from '@/lib/utils/occasionReminders';
import {
  BIRTHDAY_NUDGE_LEAD_DAYS,
  birthdayNudge,
  type BirthdayNudgeDue,
} from '@/lib/utils/birthdayNudge';

/**
 * The birthday nudge's email (WIS-344), sent by the daily birthday cron
 * (`GET /api/cron/birthdays`, its `nudges` task, lib/utils/birthdayCron.ts): "Your birthday is in 3 weeks. Make a list
 * so friends know what to get you."
 *
 * - **Who**: people with a profile birthday whose `birthday_nudge` email is on
 *   (missing = on), and who have no Birthday list coming (`birthdayNudge`:
 *   any unarchived list they own or co-own counts).
 * - **When**: `BIRTHDAY_NUDGE_LEAD_DAYS` (21) before the birthday, counted from
 *   the UTC date, with `BIRTHDAY_NUDGE_CATCH_UP_DAYS` of catch-up after a
 *   missed or capped run, as occasion reminders have.
 * - **Once a year**: a `NotificationEmailClaim` (`kind: 'birthday_nudge'`,
 *   `key`: the birthday's year) is taken first, under its unique index, so
 *   re-runs and overlapping runs send it once. Then the person is read again:
 *   the birthday moved or cleared, the email turned off, or a Birthday list made
 *   meanwhile gives the claim back and sends nothing. A failed or limited send
 *   gives it back too, for the next run.
 * - **Capped**: at most `BIRTHDAY_NUDGE_MAX_PER_RUN` a run, nearest birthday
 *   first, and none started past the task's `deadline` (its share of the
 *   cron's 60s); the rest carry over within the catch-up days.
 */

export const BIRTHDAY_NUDGE_CATCH_UP_DAYS = 2;
export const BIRTHDAY_NUDGE_MAX_PER_RUN = 50;

/** The days from `today` the email is due on, nearest first (19, 20, 21). */
export function birthdayEmailDayOffsets(): number[] {
  return reminderDayOffsets(BIRTHDAY_NUDGE_LEAD_DAYS, BIRTHDAY_NUDGE_CATCH_UP_DAYS);
}

type Id = mongoose.Types.ObjectId;

/**
 * The unarchived Birthday lists owned (alone or with others) by any of
 * `ownerIds`: what the "Birthday list coming" rule reads, both when the run
 * picks who's due and when it re-checks one person after their claim.
 */
function ownBirthdayLists(ownerIds: Id[]) {
  return Wishlist.find({
    owners: { $in: ownerIds },
    archived: { $ne: true },
    'occasion.kind': 'birthday',
  })
    .select('owners archived occasion')
    .lean();
}

/**
 * Whether `user` is due this year's email as of `today`, given `lists` (any
 * read of `ownBirthdayLists` that covers them), and about which birthday.
 */
function dueFor(
  user: { _id: Id; birthday?: string | null },
  lists: Awaited<ReturnType<typeof ownBirthdayLists>>,
  today: string
): BirthdayNudgeDue | null {
  const own = lists.filter((l) => l.owners.some((o) => String(o) === String(user._id)));
  const due = birthdayNudge(user.birthday, own, today);
  return due && birthdayEmailDayOffsets().includes(due.days) ? due : null;
}

export interface BirthdayNudgeRun {
  /** Emails sent. */
  emailed: number;
  /** The run stopped at the cap, or its deadline, with people left to email. */
  capped: boolean;
}

/** One daily run: email everyone due their birthday nudge, up to the cap. */
export async function sendBirthdayNudgeEmails(
  now: Date = new Date(),
  maxPerRun: number = BIRTHDAY_NUDGE_MAX_PER_RUN,
  /** `Date.now()` ms past which no new email is started. */
  deadline: number = Infinity
): Promise<BirthdayNudgeRun> {
  const today = utcDateString(now);
  const run: BirthdayNudgeRun = { emailed: 0, capped: false };
  const people = await User.find({
    birthday: { $in: storedDatesDue(today, birthdayEmailDayOffsets()) },
    ...notificationOptInFilter('birthday_nudge', 'email'),
  })
    .select('_id birthday')
    .lean();

  // Everyone's own Birthday lists in one read, co-owned ones under each owner.
  const lists = people.length ? await ownBirthdayLists(people.map((p) => p._id)) : [];
  const candidates: { user: (typeof people)[number]; due: BirthdayNudgeDue }[] = [];
  for (const user of people) {
    const due = dueFor(user, lists, today);
    if (due) candidates.push({ user, due });
  }
  candidates.sort(
    (a, b) => a.due.days - b.due.days || String(a.user._id).localeCompare(String(b.user._id))
  );

  const years = new Map(candidates.map((c) => [String(c.user._id), c.due.occurrence.slice(0, 4)]));
  const claimed = await NotificationEmailClaim.find({
    kind: 'birthday_nudge',
    user: { $in: candidates.map((c) => c.user._id) },
  })
    .select('user key')
    .lean();
  const done = new Set(
    claimed.filter((c) => years.get(String(c.user)) === c.key).map((c) => String(c.user))
  );

  for (const { user, due } of candidates) {
    if (done.has(String(user._id))) continue;
    if (run.emailed >= maxPerRun || Date.now() >= deadline) {
      run.capped = true;
      break;
    }
    if (await emailOne(user._id, due, today, now)) run.emailed += 1;
  }
  return run;
}

/**
 * Claim, re-check and send one person's email; returns whether it went out.
 * The re-check reads the person and their lists again after the claim, so a
 * birthday moved or cleared, an email turned off or a Birthday list made since
 * the candidates were read gives the claim back.
 */
async function emailOne(userId: Id, due: BirthdayNudgeDue, today: string, now: Date) {
  const claim = await claimBirthdayNudgeEmail(userId, due.occurrence, now);
  if (!claim) return false;
  try {
    const recipient = await User.findOne({
      _id: userId,
      ...notificationOptInFilter('birthday_nudge', 'email'),
    })
      .select('email birthday')
      .lean();
    const still = recipient
      ? dueFor(recipient, await ownBirthdayLists([recipient._id]), today)
      : null;
    if (!recipient?.email || !still || still.occurrence !== due.occurrence) {
      await claim.release();
      return false;
    }
    if (!(await emailAllowed('emailBirthdayNudge', String(userId)))) {
      await claim.release();
      return false;
    }
    await sendBirthdayNudgeEmail(recipient.email, {
      recipientId: String(userId),
      days: still.days,
    });
    return true;
  } catch (err) {
    // `deliver` has already reduced an SMTP failure to its codes: no recipient.
    console.error('Failed to send a birthday_nudge email:', errorKind(err));
    await claim.release();
    return false;
  }
}
