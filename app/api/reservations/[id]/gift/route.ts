import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';
import User from '@/models/User';
import { isObjectIdParam } from '@/lib/utils/objectId';
import { giftLogImage, serializeGiftLog } from '@/lib/utils/giftHistory';
import { inLiveGroupGift } from '@/lib/utils/groupGifts';

/** A contributor's own Mark as given on a live group gift they're in (WIS-363). */
const GROUP_GIFT_GIVEN_BY_ORGANIZER =
  'This is a group gift: its organizer marks it as given for everyone';

// POST /api/reservations/[id]/gift - mark a reservation as gifted. Writes a
// permanent GiftLog entry from the reservation's snapshot and removes the
// reservation. Deliberately does NOT touch the live item — completing it on the
// owner's list is the owner's decision, not the gifter's. The item stays booked
// by the gifter, and their own read of the list flags it as given (`givenByMe`),
// so the card shows "Given by you" rather than an Unbook.
//
// Answers 201 with the new entry, shaped as `GET /api/users/me/gifts` lists it,
// so the Booked page can add it to its gift history without re-reading the
// whole list (a re-read could land after a delete settling meanwhile and put
// the deleted entry back).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    await connectDB();

    // A contributor still in a live group gift gives it with everyone else,
    // when its organizer marks it as given (WIS-363): logging it alone here
    // would leave them in the gift, their share still counted, with no card
    // for it. That holds on an archived list too, where nobody can act on the
    // gift until it's unarchived. Once they're out of the gift (kicked, left the
    // list, the owner ended the item), it's theirs to log, with their share.
    const held = isObjectIdParam(id)
      ? await Reservation.findOne({ _id: id, gifter: session.user.id }).select('item').lean()
      : null;
    if (held && (await inLiveGroupGift(session.user.id, held.item))) {
      return NextResponse.json(
        { success: false, error: GROUP_GIFT_GIVEN_BY_ORGANIZER },
        { status: 409 }
      );
    }

    // Take the reservation in one atomic step, so that of a double submit, or of
    // this and a dismiss or release (which free its snapshot image), exactly one
    // gets it. The entry is then written from what was taken, image included.
    const reservation = isObjectIdParam(id)
      ? await Reservation.findOneAndDelete({ _id: id, gifter: session.user.id }).lean()
      : null;
    if (!reservation) {
      return NextResponse.json({ success: false, error: 'Reservation not found' }, { status: 404 });
    }

    let entry;
    try {
      // Snapshot the recipient's username at gift time (best-effort), and the
      // image the entry may keep: on a list the gifter can't open, never the
      // item's own blob (`giftLogImage`, WIS-359).
      const [recipient, itemImage] = await Promise.all([
        User.findById(reservation.owner).select('username'),
        giftLogImage(session.user.id, reservation),
      ]);

      entry = await GiftLog.create({
        gifter: session.user.id,
        giftedAt: new Date(),
        itemName: reservation.itemName,
        itemImage,
        // A group gift contributor's own share, never the whole price (WIS-363).
        itemPrice: reservation.pledge ?? reservation.itemPrice ?? null,
        recipient: reservation.owner,
        recipientUsername: recipient?.username ?? null,
        wishlistName: reservation.wishlistName,
        wishlist: reservation.wishlist,
        item: reservation.item,
      });
    } catch (error) {
      // Put the reservation back exactly as it was, so the gift can be retried.
      await Reservation.collection
        .insertOne(reservation)
        .catch((err) => console.error('Could not restore the reservation of a failed gift:', err));
      throw error;
    }

    return NextResponse.json(
      { success: true, data: serializeGiftLog(entry.toObject()) },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error logging gift:', error);
    return NextResponse.json({ success: false, error: 'Failed to log gift' }, { status: 500 });
  }
}
