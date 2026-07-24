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
