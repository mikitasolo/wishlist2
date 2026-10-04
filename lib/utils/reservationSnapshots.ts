import type { FilterQuery, Types } from 'mongoose';
import Reservation, { IReservation } from '@/models/Reservation';
import GiftLog, { type IGiftLog } from '@/models/GiftLog';
import { deleteOwnBlob, isSnapshotBlob, snapshotBlob } from '@/lib/utils/blob';

/**
 * Freeing the snapshot images (see `snapshotBlob` in `blob.ts`) that a gifter's
 * reservations and gift logs hold. Booking makes a snapshot for the new
 * `Reservation`; marking the gift moves it, with the rest of the snapshot, into
 * the permanent `GiftLog`. Either way it belongs to that one gifter's record.
 */

/**
 * Free the snapshot blobs among `urls` that none of `gifter`'s reservations or
 * gift logs still holds. Call it once the record that held them is gone or
 * points elsewhere: a reservation ending without a gift (unbook, dismiss, its
 * holder becoming an owner), a rebooking replacing one, or a gift-log entry
 * being deleted.
 *
 *  - Only snapshots are ever freed. Anything else on those records is left
 *    alone: an external URL, or the item's own blob on a reservation made before
 *    snapshots existed or whose copy failed. That blob is the item's, and
 *    freeing it would break the owner's image and tell them it had been booked.
 *  - As a safety net, a snapshot another of the gifter's records still shows is
 *    kept until the last one goes. (Each snapshot normally has exactly one
 *    holder, handed on atomically: see `deleteReservations` and the gift route.)
 *  - Best-effort: it never throws. If the check itself fails it keeps the blob,
 *    since a leaked blob costs less than a broken image.
 */
export async function releaseSnapshots(
  gifter: string | Types.ObjectId,
  urls: Array<string | null | undefined>
): Promise<void> {
  const snapshots = [...new Set(urls.filter(isSnapshotBlob))];
  await Promise.all(
    snapshots.map(async (url) => {
      try {
        const [reserved, gifted] = await Promise.all([
          Reservation.exists({ gifter, itemImage: url }),
          GiftLog.exists({ gifter, itemImage: url }),
        ]);
        if (reserved || gifted) return;
      } catch (err) {
        console.error('Snapshot cleanup check failed, keeping the blob:', err);
        return;
      }
      await deleteOwnBlob(url);
    })
  );
}

/**
 * Give a just-booked reservation its own copy of the item's image: copy
 * `imageUrl` into a snapshot blob and point the gifter's reservation for `item`
 * at it. Best-effort, like `snapshotBlob`: it never throws, and the reservation
 * keeps `imageUrl` if anything fails.
 *
 * Runs after the reservation is written, never between that and the item write:
 * the copy can take seconds, and an unbook, or the gifter becoming an owner,
 * landing in that gap has to find the reservation to delete it. So the swap
 * only applies while the reservation still holds `imageUrl`. If it has gone
 * meanwhile (deleted, or marked as gifted with the shared URL), the copy is
 * freed again.
 */
export async function snapshotReservationImage(
  gifter: string | Types.ObjectId,
  item: string | Types.ObjectId,
  imageUrl: string | null | undefined
): Promise<void> {
  const snapshot = await snapshotBlob(imageUrl);
  if (!imageUrl || !isSnapshotBlob(snapshot)) return; // no image, external, or the copy failed
  try {
    const { modifiedCount } = await Reservation.updateOne(
      { gifter, item, itemImage: imageUrl },
      { $set: { itemImage: snapshot } }
    );
    if (modifiedCount > 0) return;
  } catch (err) {
    console.error('Attaching a snapshot image to a reservation failed:', err);
  }
  await releaseSnapshots(gifter, [snapshot]);
}

/**
 * Delete the reservations matching `filter`, ending them without a gift, and
 * free their snapshot images. Returns how many were deleted.
 *
 * Every path that deletes a reservation goes through this, except marking the
 * gift: there the `GiftLog` takes the snapshot over and must keep it.
 *
 * Deletes one at a time, each in a single atomic step that returns the image
 * the reservation held as it went. A read followed by a bulk delete would miss
 * a snapshot swapped in between (see `snapshotReservationImage`), or one on a
 * reservation written in between, and leak it. Looping until nothing matches
 * also catches those late reservations. A gifter holds only a handful per list.
 */
export async function deleteReservations(filter: FilterQuery<IReservation>): Promise<number> {
  const ended: Array<Pick<IReservation, 'gifter' | 'itemImage'>> = [];
  for (;;) {
    // Options rather than a chained `.select().lean()`, so a race test can hold it.
    const r = await Reservation.findOneAndDelete(filter, {
      projection: { gifter: 1, itemImage: 1 },
      lean: true,
    });
    if (!r) break;
    ended.push(r);
  }
  await Promise.all(ended.map((r) => releaseSnapshots(r.gifter, [r.itemImage])));
  return ended.length;
}

/**
 * Delete the gift-log entries matching `filter` and free their snapshot images,
 * as deleting one entry from the gift history does. Returns how many went.
 *
 * One at a time, each in a single atomic step that returns the image it held,
 * for the reason `deleteReservations` gives: an entry written meanwhile (a gift
 * being marked, which hands its reservation's snapshot on) is caught by looping
 * until nothing matches, and its snapshot is never missed.
 */
export async function deleteGiftLogs(filter: FilterQuery<IGiftLog>): Promise<number> {
  const ended: Array<Pick<IGiftLog, 'gifter' | 'itemImage'>> = [];
  for (;;) {
    const g = await GiftLog.findOneAndDelete(filter, {
      projection: { gifter: 1, itemImage: 1 },
      lean: true,
    });
    if (!g) break;
    ended.push(g);
  }
  await Promise.all(ended.map((g) => releaseSnapshots(g.gifter, [g.itemImage])));
  return ended.length;
}
