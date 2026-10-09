/**
 * The guided walkthrough (WIS-371): whether someone is due the tour, or an
 * offer of it, and what each answer writes. The state lives on the account
 * (`User.walkthrough`), so it follows people across devices; it's read and
 * written only through `/api/users/me`, for one's own account.
 *
 * - **The tour** is due until it's been finished or skipped at the current
 *   `TOUR_VERSION`. Skipping counts as done. Bumping the version shows a later
 *   tour to people who finished this one.
 * - **The offer** ("Want a quick look around?") is due when someone comes back
 *   after `RETURN_GAP_DAYS` or more without using the app. The visit that
 *   finds the gap stamps `offeredAt` in the same conditional write that bumps
 *   `lastActiveAt` (`activityBump`), so the decision is taken before the bump
 *   and survives a second read racing it. Any answer (accept or dismiss)
 *   stamps `offerAnsweredAt`, which silences it until the next gap.
 */

/** The tour's version: raise it to show a new tour to people who finished this one. */
export const TOUR_VERSION = 1;

/** Days away after which coming back offers the tour again. */
export const RETURN_GAP_DAYS = 90;

/** `lastActiveAt` moves at most once per this window. */
export const ACTIVITY_BUMP_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type WalkthroughDue = 'tour' | 'offer' | null;

/** `User.walkthrough`: absent fields read as never. */
export interface WalkthroughState {
  version?: number | null;
  completedAt?: Date | null;
  skippedAt?: Date | null;
  offeredAt?: Date | null;
  offerAnsweredAt?: Date | null;
}

/** What `GET /api/users/me` answers about the tour: never the raw state. */
export interface WalkthroughStatus {
  due: WalkthroughDue;
  /** Whether they own or co-own a list (archived included): without one, the tour ends on Create a list. */
  ownsList: boolean;
}

/** Whether the current tour has been finished or skipped. */
export function tourDone(state: WalkthroughState | null | undefined): boolean {
  if (!state) return false;
  return !!(state.completedAt || state.skippedAt) && (state.version ?? 0) >= TOUR_VERSION;
}

/** The tour itself, the offer of it, or nothing. */
export function walkthroughDue(state: WalkthroughState | null | undefined): WalkthroughDue {
  if (!tourDone(state)) return 'tour';
  const offeredAt = state?.offeredAt;
  if (!offeredAt) return null;
  const answeredAt = state?.offerAnsweredAt;
  return !answeredAt || answeredAt.getTime() < offeredAt.getTime() ? 'offer' : null;
}

/** Whether `lastActiveAt` is at least `RETURN_GAP_DAYS` before `now` (never, for none). */
export function isReturnAfterGap(lastActiveAt: Date | null | undefined, now: Date): boolean {
  if (!lastActiveAt) return false;
  return now.getTime() - lastActiveAt.getTime() >= RETURN_GAP_DAYS * DAY_MS;
}

/**
 * The one conditional write that records a visit: it matches only when
 * `lastActiveAt` wasn't bumped in the last day (or never was), and bumps it;
 * when the value it replaces is `RETURN_GAP_DAYS` or more old, the same write
 * offers the tour (`walkthrough.offeredAt`). So the decision is taken against
 * the value the bump replaces, and of two visits at once only the first
 * matches. An account with no `lastActiveAt` yet (new, or older than the
 * field) just gets one: it was never away. An update pipeline, so the offer
 * can depend on the old value.
 */
export function activityBump(now: Date) {
  const gapCutoff = new Date(now.getTime() - RETURN_GAP_DAYS * DAY_MS);
  const dayCutoff = new Date(now.getTime() - ACTIVITY_BUMP_MS);
  const backAfterGap = {
    $and: [{ $eq: [{ $type: '$lastActiveAt' }, 'date'] }, { $lte: ['$lastActiveAt', gapCutoff] }],
  };
  return {
    filter: { $or: [{ lastActiveAt: null }, { lastActiveAt: { $lte: dayCutoff } }] },
    update: [
      {
        $set: {
          'walkthrough.offeredAt': {
            $cond: [backAfterGap, now, '$walkthrough.offeredAt'],
          },
        },
      },
      { $set: { lastActiveAt: now } },
    ],
  };
}

/** What the tour's controls send (`PATCH /api/users/me`, `walkthrough`). */
export const WALKTHROUGH_ACTIONS = [
  'completed',
  'skipped',
  'restart',
  'offer_accepted',
  'offer_dismissed',
] as const;
export type WalkthroughAction = (typeof WALKTHROUGH_ACTIONS)[number];

/**
 * The write for an answer, stamped with the server's clock. Finishing or
 * skipping marks this version done and answers any pending offer; restarting
 * clears done, so the tour is due again until it's finished or skipped (a tab
 * closed halfway shows it again); accepting or dismissing the offer answers it.
 */
export function walkthroughWrite(action: WalkthroughAction, now: Date) {
  switch (action) {
    case 'completed':
      return {
        $set: {
          'walkthrough.completedAt': now,
          'walkthrough.version': TOUR_VERSION,
          'walkthrough.offerAnsweredAt': now,
        },
      };
    case 'skipped':
      return {
        $set: {
          'walkthrough.skippedAt': now,
          'walkthrough.version': TOUR_VERSION,
          'walkthrough.offerAnsweredAt': now,
        },
      };
    case 'restart':
      return {
        $set: { 'walkthrough.offerAnsweredAt': now },
        $unset: { 'walkthrough.completedAt': '', 'walkthrough.skippedAt': '' },
      };
    case 'offer_accepted':
    case 'offer_dismissed':
      return { $set: { 'walkthrough.offerAnsweredAt': now } };
  }
}
