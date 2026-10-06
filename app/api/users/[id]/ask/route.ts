import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkRateLimit, enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { createNotification } from '@/lib/notifications';
import { areFriends } from '@/lib/utils/friends';
import { isObjectIdParam } from '@/lib/utils/objectId';
import { errorKind } from '@/lib/utils/errorKind';
import {
  askForWishlist,
  canOpenAnyListOf,
  hasLiveAsk,
  takeBackAsk,
} from '@/lib/utils/wishlistAsks';

/**
 * Asking a friend to make a wishlist (WIS-324). `GET` answers whether the
 * caller has a live ask to this person (the profile's "Asked"); `POST` asks.
 * Only the caller's own ask is ever read: nothing here says whether anyone
 * else asked, or anything about the person's lists beyond what the caller
 * could open anyway.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const userNotFound = () =>
  NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
const notFriends = () =>
  NextResponse.json(
    { success: false, error: 'You can only ask friends for a wishlist' },
    { status: 403 }
  );
const hasList = () =>
  NextResponse.json(
    { success: false, error: 'They already have a wishlist you can open' },
    { status: 409 }
  );

// GET /api/users/[id]/ask - whether you've asked this person for a wishlist
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    if (!isObjectIdParam(id)) return userNotFound();
    await connectDB();
    const asked = id === session.user.id ? false : await hasLiveAsk(session.user.id, id);
    return NextResponse.json({ success: true, data: { asked } }, { headers: NO_STORE });
  } catch (error) {
    console.error('Error reading a wishlist ask:', errorKind(error));
    return NextResponse.json(
      { success: false, error: 'Failed to load your request' },
      { status: 500 }
    );
  }
}

// POST /api/users/[id]/ask - ask a friend to make a wishlist
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const askerId = session.user.id;
    const { id: personId } = await params;
    if (personId === askerId) {
      return NextResponse.json(
        { success: false, error: 'You can’t ask yourself for a wishlist' },
        { status: 400 }
      );
    }
    if (!isObjectIdParam(personId)) return userNotFound();

    await connectDB();
    if (!(await User.exists({ _id: personId }))) return userNotFound();
    if (!(await areFriends(askerId, personId))) return notFriends();
    if (await canOpenAnyListOf(askerId, personId)) return hasList();

    // Spent only once the caller may ask, like a request to join.
    const limited = await enforce('wishlistAsk', userKey(askerId), {
      newAccount: session.user.newAccount,
    });
    if (limited) return limited;

    const ask = await askForWishlist(askerId, personId);
    // Already asked within the window: the same answer, and nobody told twice.
    if (ask.result === 'already') {
      return NextResponse.json({ success: true, data: { asked: true } }, { headers: NO_STORE });
    }

    // Re-checked once the ask stands: a list made, or a friendship ended, while
    // it was written takes it back (a list made after this is told about it).
    if (!(await areFriends(askerId, personId))) {
      await takeBackAsk(askerId, personId, ask.askedAt);
      return notFriends();
    }
    if (await canOpenAnyListOf(askerId, personId)) {
      await takeBackAsk(askerId, personId, ask.askedAt);
      return hasList();
    }

    // The person's own budget holds back only the notification: the ask
    // stands either way, so the asker learns nothing about anyone else's.
    if (await checkRateLimit('wishlistAskReceived', userKey(personId))) {
      await createNotification({
        user: personId,
        type: 'wishlist_ask',
        actorUsername: session.user.username ?? null,
        actor: askerId,
      });
    }

    return NextResponse.json(
      { success: true, data: { asked: true } },
      { status: 201, headers: NO_STORE }
    );
  } catch (error) {
    console.error('Error asking for a wishlist:', errorKind(error));
    return NextResponse.json(
      { success: false, error: 'Failed to send your request' },
      { status: 500 }
    );
  }
}
