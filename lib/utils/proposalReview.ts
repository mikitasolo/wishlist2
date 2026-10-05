/**
 * The review dialog's requests (WIS-199). An owner's review of a proposal is
 * decided on the proposal as the dialog opened on it, so its approve
 * (`PATCH /api/items/[id]`) and Decline (`DELETE /api/items/[id]`) say they
 * expect the item to still be a proposal: the PATCH in its body, the DELETE in
 * its query string. The route answers 409 `PROPOSAL_REVIEWED_ERROR` whenever it
 * isn't one any more, on its first read and as a condition on its write, so a
 * dialog left open while a co-owner approved the proposal can't overwrite that
 * approval or delete the live item (possibly reserved, which an owner can't
 * see). Every other owner edit or delete goes on as before.
 */

/**
 * An approve also says which version of the proposal the dialog shows: its
 * `updatedAt` as the dialog was filled (WIS-320). A proposer's edit landing
 * while the dialog is open leaves the item a proposal, so the status check
 * alone would let the owner approve fields they never saw. The route answers
 * 409 `PROPOSAL_EDITED_ERROR` with the proposal as it is now, and the dialog
 * refills from it.
 */
export const EXPECTED_VERSION_PARAM = 'expectedUpdatedAt';

/** The 409 (and the dialog's notice) when the proposal changed under review. */
export const PROPOSAL_EDITED_ERROR =
  'This proposal was edited while you were reviewing it. Check the changes, then add it again.';

/**
 * Is `next` a later version of an item than `current` (by `updatedAt`)? A poll
 * can answer with an older read than the one the dialog holds, which must
 * never replace it.
 */
export function isNewerVersion(next: string | undefined, current: string | undefined): boolean {
  const a = Date.parse(next ?? '');
  const b = Date.parse(current ?? '');
  return Number.isFinite(a) && (!Number.isFinite(b) || a > b);
}

/** The status a review request expects the item to have. */
export const EXPECTED_PROPOSAL = 'proposed' as const;

/** The body field (PATCH) and query parameter (DELETE) that carry it. */
export const EXPECTED_STATUS_PARAM = 'expectedStatus';

/**
 * The 409 for a review request whose item is no longer a proposal. The same
 * whatever the item has become, so it never tells an owner it's reserved.
 */
export const PROPOSAL_REVIEWED_ERROR = 'This proposal has already been reviewed';

/** The toast when the item under review was deleted or withdrawn meanwhile. */
export const PROPOSAL_REMOVED_NOTE = 'This proposal is no longer on the list';

/**
 * Where the proposal under review stands in the list as last read: still a
 * proposal, reviewed (any other status, booked included, which an owner's list
 * already reads as available), or gone from the list.
 */
export function proposalReviewState(
  items: ReadonlyArray<{ _id: string; status: string }>,
  itemId: string
): 'proposed' | 'reviewed' | 'gone' {
  const item = items.find((candidate) => candidate._id === itemId);
  if (!item) return 'gone';
  return item.status === 'proposed' ? 'proposed' : 'reviewed';
}
