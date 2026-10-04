import Item from '@/models/Item';
import Wishlist from '@/models/Wishlist';
import User from '@/models/User';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';
import { deleteOwnBlob, isUploadedBy } from '@/lib/utils/blob';

/**
 * Giving back an upload that never got saved onto anything (WIS-181).
 *
 * `/api/upload` stores an image as soon as it's cropped, before the form around
 * it is saved, so a form that's cancelled, closed or discarded, or whose photo
 * is replaced before a save, would leave the first upload in `uploads/<id>/`
 * forever, on its uploader's quota. The browser hands such an upload back
 * (`DELETE /api/upload`, from `useFreshUploads`), and this frees it, but only
 * when both hold:
 *
 *  - it's a file directly in the caller's own `uploads/<callerId>/` folder
 *    (`isUploadedBy`), so nobody can free anyone else's image, a snapshot, or a
 *    URL outside our store;
 *  - no record shows it: no item, list banner, profile photo, reservation or
 *    gift-history entry. A co-owner may have kept it on an item, a proposal may
 *    have been approved with it, or a reservation whose snapshot copy failed may
 *    hold it, and freeing it would break their image.
 *
 * That check and the delete aren't one write, so it can't stop a save that
 * attaches the image after the check from pointing at a freed blob. Only the
 * uploader can attach a blob from their folder (`canAttachImage`), so the
 * browser holds that end: it never hands back an upload any save may still be
 * carrying (one in flight, or one whose outcome it couldn't tell).
 *
 * Returns whether the blob was freed, for the tests; the route answers the same
 * either way, so it never says whether anything shows the image (a reservation
 * holding an owner's blob would tell them their item was reserved).
 */
export async function releaseUnsavedUpload(url: string, userId: string): Promise<boolean> {
  if (!isUploadedBy(url, userId)) return false;
  if (await isImageReferenced(url)) return false;
  await deleteOwnBlob(url);
  return true;
}

/**
 * Does any record show this image? Every field an upload can end up in: the
 * three image fields (`Item.imageUrl`, `Wishlist.bannerUrl`, `User.image`), and
 * the reservation and gift-log images, which hold the item's own blob when their
 * snapshot copy failed. A new image field needs adding here.
 */
export async function isImageReferenced(url: string): Promise<boolean> {
  const found = await Promise.all([
    Item.exists({ imageUrl: url }),
    Wishlist.exists({ bannerUrl: url }),
    User.exists({ image: url }),
    Reservation.exists({ itemImage: url }),
    GiftLog.exists({ itemImage: url }),
  ]);
  return found.some(Boolean);
}
