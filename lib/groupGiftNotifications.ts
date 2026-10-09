import mongoose, { type Types } from 'mongoose';
import GroupGift, { type IGroupGift } from '@/models/GroupGift';
import Item from '@/models/Item';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { createNotifications } from '@/lib/notifications';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import { errorKind } from '@/lib/utils/errorKind';
import type { GroupGiftNotificationType } from '@/lib/utils/notifications';

/**
 * Group gift notifications (WIS-364): to the gift's contributors, and nobody
 * else. Never to an owner of the list (who must never learn the item is held,
 * let alone split), never to a member who isn't in the gift, never to whoever
 * did it.
 *
 *  - **joined**: someone joined, to the others in it, naming them (contributors
 *    see each other by name). Emails at most one a day per gift per contributor.
 *  - **funded**: the pledges reached the target, to everyone in it but whoever's
 *    pledge did it; once per gift (`fundedNotifiedAt`, claimed conditionally).
 *  - **organizer**: the organizer role passed to someone, to them alone, never
 *    saying from whom or why (it may follow a kick or a removal).
 *  - **cancelled** / **converted** / **given**: the organizer ended it, to the
 *    others who were in it when it ended.
 *
 * Each recipient is checked twice: before the rows are written and again once
 * they are (`createNotifications`' `recheck`), so a role change landing in
 * between takes the row back and sends no email. What's checked: still in the
 * gift (for a live one), and still a plain member of the list, i.e. a member,
 * not an owner, on a list that isn't archived. The feed applies the last part
 * again whenever it's read (`hiddenGroupGiftWishlists`), for a role change that
 * lands after both.
 *
 * Best-effort, like every notification: a failure is logged by its kind only,
 * and never fails the action that caused it.
 */

type Id = string | Types.ObjectId;

const oid = (id: Id) => (typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id);

/**
 * Of `users`, those who are plain members of the list now: a membership row,
 * not an owner, and the list neither archived nor gone.
 */
export async function plainMembersOf(wishlistId: Id, users: string[]): Promise<string[]> {
  if (users.length === 0) return [];
  // The membership first, as `lostMemberReason` reads it: a list deleted
  // meanwhile is gone before its memberships are.
  const rows = await WishlistMember.find({ wishlist: wishlistId, user: { $in: users } })
    .select('user')
    .lean();
  const wishlist = await Wishlist.findById(wishlistId).select('owners archived').lean();
  const members = new Set(rows.map((r) => String(r.user)));
  return users.filter((u) => isPlainMember(wishlist, u, members.has(u)));
}

/**
 * The one rule both directions use (`plainMembersOf` at send,
 * `hiddenGroupGiftWishlists` at feed read): the list is there and not
 * archived, `userId` holds a membership of it, and isn't one of its owners.
 */
function isPlainMember(
  wishlist: { owners: Types.ObjectId[]; archived?: boolean } | null,
  userId: string,
  hasMembership: boolean
): boolean {
  return !!wishlist && !wishlist.archived && hasMembership && !isWishlistOwner(wishlist, userId);
}

type GiftRead = Pick<
  IGroupGift,
  '_id' | 'item' | 'wishlist' | 'organizer' | 'contributors' | 'active' | 'status'
>;

const GIFT_FIELDS = 'item wishlist organizer contributors active status';

const readGift = (giftId: Id) => GroupGift.findById(giftId).select(GIFT_FIELDS).lean<GiftRead>();

const contributorIds = (gift: Pick<IGroupGift, 'contributors'>) =>
  gift.contributors.map((c) => String(c.user));

/**
 * Write the rows (and emails) of one group gift event to `candidates`, minus
 * `actor`, keeping only the plain members of the list, before the write and
 * again after it (with `stillHolds`, the event's own re-check per recipient,
 * on the gift read once more after the write).
 */
async function send(
  gift: GiftRead,
  type: GroupGiftNotificationType,
  candidates: string[],
  {
    actor,
    namedActor,
    stillHolds,
  }: {
    actor: string | null;
    /** `group_gift_joined` only: who joined, named to the others. */
    namedActor?: { id: string; username: string | null };
    stillHolds?: (gift: GiftRead | null, recipient: string) => boolean;
  }
): Promise<void> {
  const others = Array.from(new Set(candidates)).filter((u) => u !== actor);
  const recipients = await plainMembersOf(gift.wishlist, others);
  if (recipients.length === 0) return;

  const [wishlist, item] = await Promise.all([
    Wishlist.findById(gift.wishlist).select('name slug').lean(),
    Item.findById(gift.item).select('name').lean(),
  ]);
  if (!wishlist) return;

  await createNotifications(
    recipients,
    {
      type,
      ...(namedActor ? { actor: namedActor.id, actorUsername: namedActor.username } : {}),
      wishlist: gift.wishlist,
      wishlistName: wishlist.name ?? null,
      wishlistSlug: wishlist.slug ?? null,
      itemName: item?.name ?? null,
      ...(type === 'group_gift_joined' ? { groupGift: gift._id } : {}),
    },
    {
      recheck: async (users) => {
        const [members, fresh] = await Promise.all([
          plainMembersOf(gift.wishlist, users),
          stillHolds ? readGift(gift._id) : null,
        ]);
        return stillHolds ? members.filter((u) => stillHolds(fresh, u)) : members;
      },
    }
  );
}

/** Run one notification's work, logging (by kind only) and swallowing any failure. */
async function bestEffort(what: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    console.error(`Failed to notify a group gift's contributors (${what}):`, errorKind(err));
  }
}

/** Whether `gift` is live and `user` in it. */
const inLiveGift = (gift: GiftRead | null, user: string) =>
  !!gift?.active && contributorIds(gift).includes(user);

/**
 * `joinerId` joined the gift (their place stands): the others in it are told,
 * by name, while the joiner is still in it. One email a day per gift each.
 */
export async function notifyGroupGiftJoined(giftId: Id, joinerId: string): Promise<void> {
  await bestEffort('joined', async () => {
    const gift = await readGift(giftId);
    if (!gift?.active || !contributorIds(gift).includes(joinerId)) return;
    const joiner = await User.findById(joinerId).select('username').lean();
    if (!joiner) return;
    await send(gift, 'group_gift_joined', contributorIds(gift), {
      actor: joinerId,
      namedActor: { id: joinerId, username: joiner.username ?? null },
      // Both still in it: a join undone meanwhile tells nobody.
      stillHolds: (fresh, u) => inLiveGift(fresh, u) && inLiveGift(fresh, joinerId),
    });
  });
}

/**
 * If the gift is funded now and nobody's been told yet, claim that (one
 * conditional write, so two pledges racing tell everyone once) and tell everyone
 * in it but `actorId`, whose pledge did it. Called after every pledge that
 * stands (a start, a join, a change); a gift funded from the start is claimed
 * there, with nobody else to tell.
 */
export async function notifyGroupGiftFunded(giftId: Id, actorId: string): Promise<void> {
  await bestEffort('funded', async () => {
    const gift = await GroupGift.findOneAndUpdate(
      { _id: giftId, active: true, status: 'funded', fundedNotifiedAt: { $exists: false } },
      { $set: { fundedNotifiedAt: new Date() } },
      { new: true, lean: true, projection: GIFT_FIELDS }
    );
    if (!gift) return;
    await send(gift as GiftRead, 'group_gift_funded', contributorIds(gift), {
      actor: actorId,
      stillHolds: (fresh, u) => inLiveGift(fresh, u) && fresh?.status === 'funded',
    });
  });
}

/**
 * `formerId` was the organizer and left the gift (by their own leave, a kick,
 * a removal, becoming an owner or deleting their account): the gift's organizer
 * now, if it's still live and someone else, is told it's theirs. Never who
 * handed it on, or why.
 */
export async function notifyGroupGiftOrganizer(giftId: Id, formerId: string): Promise<void> {
  await bestEffort('organizer', async () => {
    const gift = await readGift(giftId);
    if (!gift?.active || gift.organizer.equals(oid(formerId))) return;
    const organizer = String(gift.organizer);
    await send(gift, 'group_gift_organizer', [organizer], {
      actor: formerId,
      stillHolds: (fresh, u) => !!fresh?.active && String(fresh.organizer) === u,
    });
  });
}

const ENDED_TYPES = {
  cancelled: 'group_gift_cancelled',
  converted: 'group_gift_converted',
  given: 'group_gift_given',
} as const satisfies Record<string, GroupGiftNotificationType>;

/**
 * The organizer ended the gift: everyone else who was in it when it ended (the
 * gift as `endGroupGift` returned it) is told how.
 */
export async function notifyGroupGiftEnded(
  gift: Pick<IGroupGift, '_id' | 'item' | 'wishlist' | 'organizer' | 'contributors'>,
  endedAs: keyof typeof ENDED_TYPES
): Promise<void> {
  await bestEffort(endedAs, async () => {
    const read: GiftRead = { ...gift, active: undefined, status: 'cancelled' };
    await send(read, ENDED_TYPES[endedAs], contributorIds(gift), {
      actor: String(gift.organizer),
    });
  });
}

/**
 * The lists among `wishlistIds` whose group gift rows `userId` mustn't see now:
 * any they aren't a plain member of (an owner, someone who left or was taken
 * off, an archived list's member). What the feed hides those rows by
 * (`GET /api/notifications`), for a role change landing after the send.
 */
export async function hiddenGroupGiftWishlists(
  userId: string,
  wishlistIds: Types.ObjectId[]
): Promise<Types.ObjectId[]> {
  if (wishlistIds.length === 0) return [];
  const uid = oid(userId);
  const [memberships, lists] = await Promise.all([
    WishlistMember.find({ wishlist: { $in: wishlistIds }, user: uid })
      .select('wishlist')
      .lean(),
    Wishlist.find({ _id: { $in: wishlistIds } })
      .select('owners archived')
      .lean(),
  ]);
  const member = new Set(memberships.map((m) => String(m.wishlist)));
  const visible = new Set(
    lists
      .filter((l) => isPlainMember(l, userId, member.has(String(l._id))))
      .map((l) => String(l._id))
  );
  return wishlistIds.filter((id) => !visible.has(String(id)));
}
