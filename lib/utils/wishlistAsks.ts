import mongoose from 'mongoose';
import WishlistAsk from '@/models/WishlistAsk';
import Wishlist, { type IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Notification from '@/models/Notification';
import { createNotifications } from '@/lib/notifications';
import { getFriendIds } from '@/lib/utils/friends';
import { getWishlistViewAccess, viewableWishlistsFilter } from '@/lib/utils/wishlistAccess';
import { ownedByFilter } from '@/lib/utils/wishlistOwners';
import { isDuplicateKeyError } from '@/lib/utils/mongoErrors';
import { errorKind } from '@/lib/utils/errorKind';

/**
 * Asking a friend to make a wishlist (WIS-324, the operator's decision of
 * 2026-10-07). Only a friend (mutual follow) who can open none of the
 * person's lists may ask; one ask per asker per person per
 * `WISHLIST_ASK_WINDOW_MS`, which then quietly expires (no decline). When the
 * person makes a list, each asker with a live ask who can open it
 * (`getWishlistViewAccess`) is told, once; an asker who can't is told nothing,
 * and their ask stays live for a later list.
 */

type Id = string | mongoose.Types.ObjectId;

/** How long an ask stays live (and holds its asker off asking again). */
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

/** Whether `asker` has a live ask to `person`. */
export async function hasLiveAsk(asker: Id, person: Id): Promise<boolean> {
  return !!(await WishlistAsk.exists({
    asker: oid(asker),
    person: oid(person),
    ...liveAskFilter(),
  }));
}

/**
 * Whether `viewerId` can open any of `personId`'s lists (owned alone or with
 * others), by the same rule as opening one (`viewableWishlistsFilter`, pinned
 * to `getWishlistViewAccess`): an archived one never counts.
 */
export async function canOpenAnyListOf(viewerId: Id, personId: Id): Promise<boolean> {
  const viewer = viewerId.toString();
  const [memberOf, friendIds] = await Promise.all([
    WishlistMember.distinct('wishlist', { user: oid(viewer) }),
    getFriendIds(viewer),
  ]);
  return !!(await Wishlist.exists({
    $and: [
      ownedByFilter(personId.toString()),
      viewableWishlistsFilter({ id: viewer, memberOf, friendIds }),
    ],
  }));
}

/**
 * Record `asker`'s ask to `person`, in one conditional write: a new row, or
 * the existing one moved forward when it has expired or was answered. A live
 * ask already there makes the upsert insert a second row, which the unique
 * index refuses: `'already'`, and nothing changes. So of two asks at once,
 * exactly one lands.
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
        $or: [{ askedAt: { $lte: askCutoff(now) } }, { answeredAt: { $ne: null } }],
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
 * re-check after the write refuses it. Never one a later ask moved forward.
 */
export async function takeBackAsk(asker: Id, person: Id, askedAt: Date): Promise<void> {
  await WishlistAsk.deleteOne({
    asker: oid(asker),
    person: oid(person),
    askedAt,
    answeredAt: null,
  });
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
    for (const ask of asks) {
      const askerId = ask.asker.toString();
      try {
        if (!(await canOpen(list, askerId))) continue;
        const answeredAt = new Date();
        const claimed = await WishlistAsk.updateOne(
          { _id: ask._id, ...liveAskFilter(answeredAt) },
          { $set: { answeredAt } }
        );
        if (claimed.modifiedCount === 0) continue;

        // Re-checked once the row is written, before any email, and again for
        // the row (the result is kept, so both see the same answer).
        let holds: boolean | undefined;
        const stillHolds = async () =>
          (holds ??= await canOpen(await rereadList(list._id), askerId));
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
  } catch (err) {
    console.error('Failed to read the asks for a new list:', errorKind(err));
  }
}
