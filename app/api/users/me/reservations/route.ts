import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Reservation from '@/models/Reservation';
import User from '@/models/User';
import { errorKind } from '@/lib/utils/errorKind';
import { readReservationLiveState } from '@/lib/utils/reservationLiveState';
import { frozenImage } from '@/lib/utils/blob';
import type { ContributingGroupGift } from '@/lib/utils/groupGiftSummary';

// GET /api/users/me/reservations - the current user's active reservations
// (gifts they're holding), across all wishlists. Each carries a frozen snapshot
// and its item's id, plus, on a list they may still open, the live item's
// current status so the UI can hint when the owner has since completed /
// drafted / removed it, whether the gifter may still open the list
// (`listOpen`), and, only while they may, its live slug
// (for the card's link, which falls back to the id), occasion (which the page
// groups the gifts still to give by) and primary owner's username (which its
// headings name). While the item is still booked by the gifter on a list they
// may open, it also carries the live item's link (http(s) only) and notes,
// which they can read on the list anyway; once it isn't, those are `null`.
//
// A reservation on a list the gifter can't open, for whatever reason, is
// frozen instead (WIS-124, WIS-295): it comes back as its snapshot only, with
// no live item status, no `stillReserved` (both `null`), and no slug or
// occasion, until they may open the list again. One that only its archiving
// hides from them says so (`listArchived`); every other one looks the same,
// whether they left or were kicked, it was made private, a friendship ended or
// it was deleted (and archived on top of any of those). Its image is the
// snapshot's own copy, or an external URL; one that's still the item's own
// blob (booked before snapshots, or its copy failed) is left out, since
// whether it still loads would tell them what the owners did to the image.
//
// A card is active (Release) only while it's still reserved on a list they can
// open, since the list's own unbook refuses anyone the list is hidden from. A
// booking on a list they can't open (one made private since they left, say, or
// archived: leaving or being removed frees it) can be released by an owner
// alone, so the card needs their confirmation instead (`needsConfirmation`),
// and offers Dismiss, which leaves the item as it is anyway, out of their
// reach. The dashboard's "N reservations changed" (`./summary`) counts those
// cards, from the same live state (`readReservationLiveState`).
//
// A group gift (WIS-363): its item is booked by the organizer alone, yet every
// contributor in the live gift still holds it, so their card stays active and
// carries the gift (`groupGift`: target, progress, every contributor's display
// name and pledge) and their own share (`pledge`), which Mark as given logs.
/** The viewer's own pledge in a live gift they're in, as the gift has it. */
function livePledge(gift: ContributingGroupGift | null) {
  const mine = gift?.contributors.find((c) => c.you);
  return gift && mine ? { value: mine.pledged, currency: gift.target.currency } : null;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();

    const reservations = await Reservation.find({ gifter: session.user.id })
      .sort({ createdAt: -1 })
      .lean();

    // The live items and wishlists (either may be gone), each in a fixed number
    // of queries however many reservations there are.
    const liveState = await readReservationLiveState(session.user.id, reservations);

    // The usernames of the open lists' primary owners, which the page's
    // headings name, in one query however many lists there are.
    const states = reservations.map((r) => liveState(r));
    const ownerIds = Array.from(
      new Set(states.flatMap((s) => (s.wishlist?.ownerId ? [s.wishlist.ownerId] : [])))
    );
    const owners =
      ownerIds.length === 0
        ? []
        : await User.find({ _id: { $in: ownerIds } })
            .select('username')
            .lean();
    const usernames = new Map(owners.map((u) => [u._id.toString(), u.username]));

    const data = reservations.map((r, i) => {
      const {
        wishlist,
        itemStatus,
        stillReserved,
        listOpen,
        listArchived,
        itemLink,
        itemNotes,
        groupGift,
      } = states[i];
      return {
        _id: r._id.toString(),
        // The gifter's own record of which item they reserved: what Release sends
        // its unbook to.
        itemId: r.item.toString(),
        itemName: r.itemName,
        itemImage: listOpen ? (r.itemImage ?? null) : frozenImage(r.itemImage),
        itemPrice: r.itemPrice ?? null,
        // Their own share of a group gift (WIS-363): the live gift's while
        // they're in it, else as their Reservation records it (what Mark as
        // given logs). `null` for a solo booking.
        pledge: livePledge(groupGift) ?? r.pledge ?? null,
        wishlistName: r.wishlistName,
        wishlistId: r.wishlist.toString(),
        wishlistSlug: wishlist?.slug ?? null,
        wishlistOccasion: wishlist?.occasion ?? null,
        // A list the gifter may open: its primary owner, by username (null
        // for none). Nothing for a list out of their reach.
        wishlistOwnerUsername: (wishlist?.ownerId && usernames.get(wishlist.ownerId)) || null,
        // The live item's link and notes, only while it's still theirs on a
        // list they may open (see `readReservationLiveState`).
        itemLink,
        itemNotes,
        // The live group gift they're in on this item, while it's still theirs
        // on a list they may open (see `readReservationLiveState`): `null`
        // otherwise. Only ever a gift they're in, so other contributors' names
        // and pledges reach only them.
        groupGift,
        itemStatus,
        stillReserved,
        listOpen,
        listArchived,
      };
    });

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    // Its kind only: an error may quote the query, which is the user's id.
    console.error('Error fetching reservations:', errorKind(error));
    return NextResponse.json(
      { success: false, error: 'Failed to fetch reservations' },
      { status: 500 }
    );
  }
}
