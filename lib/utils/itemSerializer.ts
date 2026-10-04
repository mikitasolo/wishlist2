import type { Types } from 'mongoose';
import type { IItem } from '@/models/Item';
import { itemPriceInUsdCents } from '@/lib/utils/itemPrice';
import { itemsGivenBy } from '@/lib/utils/giftHistory';

/**
 * Who an item response is built for, which decides what of the item they get.
 * The route works the role out from its own access check:
 *
 * - `owner`: any co-owner. Booking-blind and proposer-blind.
 * - `member`: a member who isn't an owner. Sees which items are booked, but
 *   only their own id in `bookedBy` / `proposedBy`, plus `givenByMe` on the
 *   gifts they hold the booking of: `givenByViewer` is the ids of those they've
 *   marked as given (`readGivenByViewer`).
 * - `proposer`: a non-member writing their own proposal (`PATCH /api/items/[id]`
 *   lets them edit it). Sees what a visitor does, plus their own `proposedBy`.
 * - `visitor`: anyone else, signed out or not, reading a list they can open.
 */
export type ItemViewer =
  | { role: 'owner' }
  | { role: 'member'; id: string; givenByViewer: ReadonlySet<string> }
  | { role: 'proposer'; id: string }
  | { role: 'visitor' };

/** An item as every item response carries it (see `ApiItem` for the client's view). */
export type SerializedItem = Omit<IItem, 'bookedBy' | 'proposedBy'> & {
  bookedBy?: string;
  proposedBy?: string;
  priceInUsdCents: number | null;
  givenByMe?: boolean;
};

type ItemSource = IItem & { toObject?: () => unknown };

/**
 * The one shape of an item in an API response: `GET /api/wishlists/[id]/items`,
 * the `POST` that creates one and the `PATCH /api/items/[id]` answer all build
 * theirs here, so a write's answer can never show what the list read hides, and
 * an enriched field is added once (WIS-95 was the price sort's `priceInUsdCents`
 * missing from the write answers).
 *
 * Privacy, by `viewer.role`:
 * - Anyone but a member gets a booked item as `available`, and never `bookedBy`:
 *   owners never see booking status, nor does anyone outside the list.
 * - Nobody gets anyone else's id: a member only their own booking's and
 *   proposal's, a proposer only their own proposal's, and an owner neither
 *   (proposals are anonymous to the owners).
 * - `givenByMe` is only ever on a member's answer, and only true on an item
 *   they hold the booking of.
 *
 * Which items a viewer may see at all (drafts, others' proposals) is the
 * route's to decide; this only shapes the ones it returns.
 */
export function serializeItem(
  item: ItemSource,
  viewer: ItemViewer,
  rates: Map<string, number>
): SerializedItem {
  const raw = (typeof item.toObject === 'function' ? item.toObject() : { ...item }) as IItem;
  const base = { ...raw, priceInUsdCents: itemPriceInUsdCents(raw.price, rates) };
  const isViewers = (id: Types.ObjectId | null | undefined) =>
    viewer.role !== 'owner' && viewer.role !== 'visitor' && id?.toString() === viewer.id;

  if (viewer.role === 'member') {
    const bookedByMe = isViewers(raw.bookedBy);
    return {
      ...base,
      // Members see which items are booked, so the status stays as it is.
      bookedBy: bookedByMe ? viewer.id : undefined,
      proposedBy: isViewers(raw.proposedBy) ? viewer.id : undefined,
      givenByMe: bookedByMe && viewer.givenByViewer.has(raw._id.toString()),
    };
  }

  return {
    ...base,
    status: raw.status === 'booked' ? 'available' : raw.status,
    bookedBy: undefined,
    proposedBy: viewer.role === 'proposer' && isViewers(raw.proposedBy) ? viewer.id : undefined,
  };
}

/**
 * The `givenByViewer` of a member's `ItemViewer`: of `items`, the ones
 * `memberId` holds the booking of and has marked as given. Reads only their own
 * gift history and reservations (`itemsGivenBy`), and nothing when they hold no
 * booking among them. Only a `booked` item counts, so a stray `bookedBy` left
 * on an item in another status never reads as a gift. Never call it for an
 * owner: owners are booking-blind.
 */
export function readGivenByViewer(
  memberId: string,
  items: Pick<IItem, '_id' | 'status' | 'bookedBy'>[]
): Promise<Set<string>> {
  return itemsGivenBy(
    memberId,
    items
      .filter((item) => item.status === 'booked' && item.bookedBy?.toString() === memberId)
      .map((item) => item._id)
  );
}
