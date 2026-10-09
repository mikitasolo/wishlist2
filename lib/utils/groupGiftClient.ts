/**
 * The group gift's client side (WIS-362): the requests the item card sends to
 * `/api/items/[id]/group-gift/*` (WIS-361), and what each shows at once while
 * it's in flight (`applyGroupGiftAction`, for `updateItemOptimistically`).
 * The server's answer then replaces it (`withServerGroupGift`).
 *
 * A member only ever reads a summary of the gift (`ApiItem.groupGift`): the
 * whole split if they are in it, only the percent funded otherwise. What an
 * action shows is therefore only what the summary already lets the viewer know.
 */
import type { ApiItem } from '@/types/api';
import {
  isFunded,
  percentFunded,
  type GroupGiftContributorView,
  type GroupGiftSummary,
} from '@/lib/utils/groupGiftSummary';

export type GroupGiftAction =
  | { type: 'start'; pledged: number; target?: { value: number; currency: string } }
  | { type: 'join'; pledged: number }
  | { type: 'pledge'; pledged: number }
  | { type: 'leave' }
  | { type: 'cancel' }
  | { type: 'convert' }
  | { type: 'give' };

/** The request an action sends. The ones that start or end a gift take an `Idempotency-Key`. */
export function groupGiftRequest(
  itemId: string,
  action: GroupGiftAction
): { method: 'POST' | 'PUT' | 'DELETE'; url: string; body?: unknown; idempotent: boolean } {
  const base = `/api/items/${itemId}/group-gift`;
  switch (action.type) {
    case 'start':
      return {
        method: 'POST',
        url: base,
        body: { pledged: action.pledged, ...(action.target && { target: action.target }) },
        idempotent: true,
      };
    case 'join':
    case 'pledge':
      return {
        method: 'PUT',
        url: `${base}/me`,
        body: { pledged: action.pledged },
        idempotent: false,
      };
    case 'leave':
      return { method: 'DELETE', url: `${base}/me`, idempotent: false };
    case 'cancel':
      return { method: 'POST', url: `${base}/cancel`, idempotent: true };
    case 'convert':
      return { method: 'POST', url: `${base}/convert`, idempotent: true };
    case 'give':
      return { method: 'POST', url: `${base}/given`, idempotent: true };
  }
}

/** The summary of a gift the viewer is in, with `contributors` as they now stand. */
function contributingSummary(
  target: { value: number; currency: string },
  organizer: boolean,
  contributors: GroupGiftContributorView[]
): GroupGiftSummary {
  const total = contributors.reduce((sum, c) => sum + c.pledged, 0);
  return {
    contributing: true,
    organizer,
    status: isFunded(total, target.value) ? 'funded' : 'open',
    target,
    pledgedTotal: total,
    percentFunded: percentFunded(total, target.value),
    contributors,
  };
}

/** What the viewer's own entry is called until the server's answer names it. */
export const YOU_NAME = 'You';

/**
 * The item as it shows while `action` is in flight. Joining shows nothing new:
 * a member who isn't in the gift can't see who is, so there's nothing honest to
 * draw before the answer.
 */
export function applyGroupGiftAction(
  item: ApiItem,
  action: GroupGiftAction,
  viewerId: string
): ApiItem {
  const gift = item.groupGift;
  switch (action.type) {
    case 'start': {
      const target = action.target ?? item.price;
      if (!target) return item;
      return {
        ...item,
        status: 'booked',
        bookedBy: viewerId,
        groupGift: contributingSummary(target, true, [
          { name: YOU_NAME, pledged: action.pledged, organizer: true, you: true },
        ]),
      };
    }
    case 'join':
      return item;
    case 'pledge': {
      if (!gift?.contributing) return item;
      return {
        ...item,
        groupGift: contributingSummary(
          gift.target,
          gift.organizer,
          gift.contributors.map((c) => (c.you ? { ...c, pledged: action.pledged } : c))
        ),
      };
    }
    case 'leave': {
      if (!gift?.contributing) return item;
      const others = gift.contributors.filter((c) => !c.you);
      if (others.length === 0) {
        return { ...item, status: 'available', bookedBy: null, groupGift: undefined };
      }
      const left = others.reduce((sum, c) => sum + c.pledged, 0);
      return {
        ...item,
        bookedBy: null,
        groupGift: { contributing: false, percentFunded: percentFunded(left, gift.target.value) },
      };
    }
    case 'cancel':
      return { ...item, status: 'available', bookedBy: null, groupGift: undefined };
    case 'convert':
      return { ...item, groupGift: undefined };
    case 'give':
      return { ...item, groupGift: undefined, givenByMe: true };
  }
}

/**
 * A server answer as it's merged into the list. The server leaves out what the
 * viewer no longer has (a gift that ended, or the organizer's `bookedBy` after
 * handing it on), and a merge keeps what an answer doesn't mention, so those
 * are cleared here.
 */
export function withServerGroupGift(answer: ApiItem): ApiItem {
  return { groupGift: undefined, bookedBy: null, givenByMe: undefined, ...answer };
}
