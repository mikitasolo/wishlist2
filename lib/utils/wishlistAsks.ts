import mongoose from 'mongoose';
import WishlistAsk from '@/models/WishlistAsk';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import Notification from '@/models/Notification';
import { createNotifications } from '@/lib/notifications';
import { getWishlistViewAccess } from '@/lib/utils/wishlistAccess';
import { ownedByFilter } from '@/lib/utils/wishlistOwners';
import { isDuplicateKeyError } from '@/lib/utils/mongoErrors';
import { errorKind } from '@/lib/utils/errorKind';

/**
 * Asking a friend to make a wishlist (WIS-324, the operator's decision of
 * 2026-10-07). Only a friend (mutual follow) who can open none of the
 * person's lists may ask; one ask per asker per person per
 * `WISHLIST_ASK_WINDOW_MS` from when it was made, answered or not, which then
 * quietly expires (no decline). When the person makes a list, each asker with
 * a live ask who can open it (`getWishlistViewAccess`) is told, once; an asker
 * who can't is told nothing, and their ask stays live for a later list.
 */

type Id = string | mongoose.Types.ObjectId;

/** How long an ask stays live, and holds its asker off asking again (answered or not). */
export const WISHLIST_ASK_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The oldest `askedAt` that is still live as of `now`. */
export function askCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - WISHLIST_ASK_WINDOW_MS);
}

/** A live ask: asked within the window, and not yet answered by a list. */
function liveAskFilter(now: Date = new Date()) {
  return { askedAt: { $gt: askCutoff(now) }, answeredAt: null };
}

const oid = (id: Id) => new mongoose.Types.ObjectId(id.toString());

/**
 * Whether `asker` asked `person` within the window, answered or not: what the
 * profile reads as Asked, and what holds them off asking again.
 */
export async function hasAskedRecently(asker: Id, person: Id): Promise<boolean> {
  return !!(await WishlistAsk.exists({
    asker: oid(asker),
    person: oid(person),
    askedAt: { $gt: askCutoff() },
  }));
}

type ViewedList = Pick<IWishlist, '_id' | 'owners' | 'visibility' | 'archived'>;

/**
 * Whether `viewerId` can open any of `personId`'s lists (owned alone or with
 * others), each checked by `getWishlistViewAccess` itself: an archived one
 * counts only for a co-owner, a private one only for a member.
 */
export async function canOpenAnyListOf(viewerId: Id, personId: Id): Promise<boolean> {
  const viewer = viewerId.toString();
  const lists = await Wishlist.find(ownedByFilter(personId.toString()))
    .select('owners visibility archived')
    .lean<ViewedList[]>();
  const access = await Promise.all(lists.map((list) => getWishlistViewAccess(list, viewer)));
  return access.some((a) => a.allowed);
}

/**
 * Record `asker`'s ask to `person`, in one conditional write: a new row, or
 * the existing one moved forward once its window is over. One within the
 * window, answered or not, makes the upsert insert a second row, which the
 * unique index refuses: `'already'`, and nothing changes. So of two asks at
 * once exactly one lands, and an answered ask can't be renewed by hiding the
 * list it was answered with.
 */
export async function askForWishlist(
  asker: Id,
  person: Id,
  now: Date = new Date()
): Promise<{ result: 'asked'; askedAt: Date } | { result: 'already' }> {
  try {
    await WishlistAsk.updateOne(
      {
        asker: oid(asker),
        person: oid(person),
        askedAt: { $lte: askCutoff(now) },
      },
      { $set: { askedAt: now, answeredAt: null } },
      { upsert: true }
    );
    return { result: 'asked', askedAt: now };
  } catch (err) {
    if (isDuplicateKeyError(err)) return { result: 'already' };
    throw err;
  }
}

/**
 * Take back the ask this request just wrote (its `askedAt` marks it), when a
 * re-check after the write refuses it. Never one a later ask moved forward,
 * nor one a new list has already answered (then false: the asker was told).
 */
export async function takeBackAsk(asker: Id, person: Id, askedAt: Date): Promise<boolean> {
  const { deletedCount } = await WishlistAsk.deleteOne({
    asker: oid(asker),
    person: oid(person),
    askedAt,
    answeredAt: null,
  });
  return deletedCount > 0;
}

/** The most askers one new list tells: asks are rate-limited, so this is a backstop. */
export const MAX_ASKERS_TOLD = 100;

type NewList = Pick<IWishlist, '_id' | 'name' | 'slug' | 'owners' | 'visibility' | 'archived'>;

/** The list as it is now, read for a re-check, or null once it's gone. */
async function rereadList(id: mongoose.Types.ObjectId): Promise<NewList | null> {
  return Wishlist.findById(id).select('name slug owners visibility archived').lean<NewList>();
}

async function canOpen(list: NewList | null, viewerId: string): Promise<boolean> {
  if (!list) return false;
  return (await getWishlistViewAccess(list, viewerId)).allowed;
}

/**
 * Tell the people who asked `owner` for a wishlist that they made one, called
 * once a new list (`list`) stands. Only askers with a live ask whom
 * `getWishlistViewAccess` lets open the list are told; each one's ask is
 * claimed first (one conditional write), so a retry or a second list never
 * tells anyone twice. The rows (and an email, for those who turned it on) go
 * out through `createNotifications`; then the list is re-read and each
 * asker's access re-checked, and an asker who can no longer open it (the list
 * made private meanwhile, a friendship ended) has the row taken back, gets no
 * email, and keeps their ask for a later list. Nothing about one asker ever
 * reaches another, and the owner learns nothing from it.
 *
 * Best-effort, like every notification: errors are logged by kind and never
 * fail the list's creation.
 */
export async function notifyAskersOfNewList(
  list: NewList,
  owner: Id,
  ownerUsername: string | null
): Promise<void> {
  try {
    const asks = await WishlistAsk.find({ person: oid(owner), ...liveAskFilter() })
      .sort({ askedAt: 1 })
      .limit(MAX_ASKERS_TOLD)
      .select('_id asker')
      .lean();
    // Each asker on their own, side by side: nothing one does touches another's.
    await Promise.all(asks.map((ask) => tellAsker(list, ask, owner, ownerUsername)));
  } catch (err) {
    console.error('Failed to read the asks for a new list:', errorKind(err));
  }
}

/** One asker's part of `notifyAskersOfNewList`. Never throws. */
async function tellAsker(
  list: NewList,
  ask: { _id: mongoose.Types.ObjectId; asker: mongoose.Types.ObjectId },
  owner: Id,
  ownerUsername: string | null
): Promise<void> {
  const askerId = ask.asker.toString();
  try {
    if (!(await canOpen(list, askerId))) return;
    const answeredAt = new Date();
    const claimed = await WishlistAsk.updateOne(
      { _id: ask._id, ...liveAskFilter(answeredAt) },
      { $set: { answeredAt } }
    );
    if (claimed.modifiedCount === 0) return;

    // Re-checked once the row is written, before any email, and again for
    // the row (the result is kept, so both see the same answer).
    let holds: boolean | undefined;
    const stillHolds = async () => (holds ??= await canOpen(await rereadList(list._id), askerId));
    const ids = await createNotifications(
      [askerId],
      {
        type: 'asked_list_made',
        actorUsername: ownerUsername,
        actor: owner,
        wishlist: list._id,
        wishlistName: list.name,
        wishlistSlug: list.slug ?? null,
      },
      { stillHolds }
    );
    if (!(await stillHolds())) {
      if (ids.length > 0) await Notification.deleteMany({ _id: { $in: ids } });
      // Their ask stands again, for a list they can open.
      await WishlistAsk.updateOne({ _id: ask._id, answeredAt }, { $set: { answeredAt: null } });
    }
  } catch (err) {
    console.error('Failed to tell an asker about a new list:', errorKind(err));
  }
}
