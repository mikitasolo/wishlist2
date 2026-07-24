import type { IconName } from '@/components/Icon';

export type NotificationType =
  'follow' | 'wishlist_invite' | 'invite_accepted' | 'proposal' | 'proposal_approved';

// The client-facing shape (ids stringified) returned by /api/notifications.
export interface NotificationView {
  _id: string;
  type: NotificationType;
  actorUsername: string | null;
  wishlistName: string | null;
  wishlistSlug: string | null;
  wishlistId: string | null;
  itemName: string | null;
  read: boolean;
  createdAt: string;
}

const actor = (n: NotificationView) => (n.actorUsername ? `@${n.actorUsername}` : 'Someone');
const list = (n: NotificationView) => n.wishlistName ?? 'a wishlist';

/** Human-readable line for a notification. Never assumes a non-null actor. */
export function notificationText(n: NotificationView): string {
  switch (n.type) {
    case 'follow':
      return `${actor(n)} started following you`;
    case 'wishlist_invite':
      return `${actor(n)} invited you to ${list(n)}`;
    case 'invite_accepted':
      return `${actor(n)} accepted your invitation to ${list(n)}`;
    case 'proposal':
      // Deliberately anonymous — owners must never learn who proposed an item.
      return `Someone proposed an item for ${list(n)}`;
    case 'proposal_approved':
      return n.itemName
        ? `Your proposed item “${n.itemName}” was accepted in ${list(n)}`
        : `Your proposed item was accepted in ${list(n)}`;
    default:
      return 'You have a new notification';
  }
}

/** Where clicking a notification should take the user. */
export function notificationLink(n: NotificationView): string {
  switch (n.type) {
    case 'follow':
      return n.actorUsername ? `/users/${n.actorUsername}` : '/notifications';
    case 'wishlist_invite':
      return '/invites';
    case 'invite_accepted':
    case 'proposal':
    case 'proposal_approved':
      return n.wishlistSlug || n.wishlistId
        ? `/wishlists/${n.wishlistSlug ?? n.wishlistId}`
        : '/notifications';
    default:
      return '/notifications';
  }
}

/** Icon that best represents the notification type. */
export function notificationIcon(n: NotificationView): IconName {
  switch (n.type) {
    case 'follow':
      return 'user';
    case 'wishlist_invite':
      return 'inbox';
    case 'invite_accepted':
      return 'check-circle';
    case 'proposal':
      return 'sparkles';
    case 'proposal_approved':
      return 'check-circle';
    default:
      return 'bell';
  }
}
