import { createMigration } from '@/lib/utils/migration';
import Notification from '@/models/Notification';
import WishlistInvite from '@/models/WishlistInvite';

/**
 * How long after its invite an invite's notification can have been written.
 * Issuing an invite writes its notification right after it (`issueWishlistInvite`),
 * so a row much newer than the invite it would be matched to was written for
 * another one: a later invite to the same list that has since been cancelled,
 * whose notification the cancel failed to delete (that's best-effort).
 */
const NOTIFICATION_WINDOW_MS = 10 * 60 * 1000;

/**
 * An invite answered this recently is left alone: an answer given now records
 * itself on its notification (`recordInviteAnswer`) once it has landed, and an
 * accept whose grant fails reopens its claim (back to `pending`) moments after
 * writing `accepted`. Labelling it here could say "You joined" over an invite
 * that's pending again. A row skipped for this is picked up by running this again.
 */
const SETTLED_AFTER_MS = 10 * 60 * 1000;

/**
 * POST /api/migrations/relabel-answered-invite-notifications (WIS-255)
 *
 * WIS-230 records an invitee's answer on their own `wishlist_invite` notification
 * (`inviteAnswer`, with `read: true`), so it reads "You joined …" or "You declined
 * the invite to …". Invites answered before that shipped kept a row that still
 * reads as an invite waiting for them. This writes the answer onto those rows.
 *
 * For each `wishlist_invite` notification with no `inviteAnswer`, its invite is the
 * invitee's newest invite to that list created at or before the row, as long as
 * the row was written within `NOTIFICATION_WINDOW_MS` of it and no later than the
 * invite's last change (its answer: the same bounds `recordInviteAnswer` uses). If
 * that invite is `accepted` or `declined`, and was answered more than
 * `SETTLED_AFTER_MS` ago, the row gets that answer and is marked read. A row whose
 * invite is still pending, or that matches no invite, is left as it is (a
 * cancelled or withdrawn invite is deleted, and its notifications with it).
 *
 * Only ever writes the invitee's own row, with the answer they gave themselves,
 * so it shows nobody anything about anyone else. It never reads or names the list
 * beyond the id the row already holds.
 *
 * Idempotent: each write is conditional on the row still having no answer, so a
 * re-run (or an answer recorded live in between) changes nothing, and a partial
 * run is finished by running it again.
 *
 * Deploy ordering: additive (it only sets `inviteAnswer` and `read` on existing
 * rows, both fields the deployed code already reads), so run it any time after
 * this endpoint is deployed, on staging and then on production. Delete it once it
 * has run everywhere.
 */
export const POST = createMigration(async () => {
  const rows = await Notification.find({
    type: 'wishlist_invite',
    inviteAnswer: null,
    wishlist: { $ne: null },
  })
    .select('_id user wishlist createdAt')
    .lean();

  const settledBefore = Date.now() - SETTLED_AFTER_MS;
  let relabelled = 0;
  let pending = 0;
  let recent = 0;
  let unmatched = 0;

  for (const row of rows) {
    const invite = await WishlistInvite.findOne({
      wishlist: row.wishlist,
      invitedUser: row.user,
      createdAt: { $lte: row.createdAt },
    })
      .sort({ createdAt: -1 })
      .select('status createdAt updatedAt')
      .lean();

    if (!invite || row.createdAt.getTime() - invite.createdAt.getTime() > NOTIFICATION_WINDOW_MS) {
      unmatched++;
      continue;
    }
    if (invite.status === 'pending') {
      pending++;
      continue;
    }
    // Written after the invite's answer: not this invite's row.
    if (row.createdAt > invite.updatedAt) {
      unmatched++;
      continue;
    }
    if (invite.updatedAt.getTime() > settledBefore) {
      recent++;
      continue;
    }

    const { modifiedCount } = await Notification.updateOne(
      { _id: row._id, inviteAnswer: null },
      { $set: { inviteAnswer: invite.status, read: true } }
    );
    relabelled += modifiedCount;
  }

  return { scanned: rows.length, relabelled, pending, recent, unmatched };
});
