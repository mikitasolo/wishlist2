import mongoose from 'mongoose';
import Notification, { NotificationType } from '@/models/Notification';

type Id = string | mongoose.Types.ObjectId;

interface CreateNotificationArgs {
  user: Id; // recipient
  type: NotificationType;
  actorUsername?: string | null;
  wishlist?: Id | null;
  wishlistName?: string | null;
  wishlistSlug?: string | null;
  itemName?: string | null;
}

/**
 * Create a notification. Best-effort: a notification is a side effect, so it
 * must never fail (or slow to a crawl) the action that triggered it — any error
 * is logged and swallowed. Assumes the caller has already connected to the DB.
 */
export async function createNotification(args: CreateNotificationArgs): Promise<void> {
  try {
    await Notification.create({
      user: args.user,
      type: args.type,
      actorUsername: args.actorUsername ?? null,
      wishlist: args.wishlist ?? null,
      wishlistName: args.wishlistName ?? null,
      wishlistSlug: args.wishlistSlug ?? null,
      itemName: args.itemName ?? null,
      read: false,
    });
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
}

/**
 * Same notification to several recipients — used to fan an event out to every
 * owner of a co-owned wishlist, so no owner misses a proposal just because
 * someone else created the list. Duplicate ids are collapsed.
 */
export async function createNotifications(
  users: Id[],
  args: Omit<CreateNotificationArgs, 'user'>
): Promise<void> {
  const unique = Array.from(new Set(users.map((u) => u.toString())));
  await Promise.all(unique.map((user) => createNotification({ ...args, user })));
}
