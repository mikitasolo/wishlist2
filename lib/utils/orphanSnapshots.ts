import { list } from '@vercel/blob';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';
import { isSnapshotBlob, ownBlobHost } from '@/lib/utils/blob';

/**
 * Finding snapshot blobs (see `snapshotBlob` in `blob.ts`) that no record holds
 * any more. A snapshot's holder is the one `Reservation` or `GiftLog` whose
 * `itemImage` points at it (`canAttachImage` keeps snapshots out of every other
 * image field), and `reservationSnapshots.ts` frees it when that holder goes.
 * A few paths still leak one (WIS-104): a copy that lands after booking gave up
 * waiting for it, a function killed between the copy and the reservation swap,
 * a best-effort `del()` that failed.
 *
 * This only reports them. Deleting is a separate, later decision, and must not
 * trust this report alone: marking a gift deletes the reservation before it
 * writes the `GiftLog` that takes the snapshot over, so a scan landing between
 * the two sees an old, held snapshot as unheld. A delete step re-checks each
 * blob's holders at delete time (as `releaseSnapshots` does) and skips any
 * it's unsure of.
 */

/**
 * How old a snapshot must be before it can count as an orphan. Booking writes
 * the reservation first and swaps the snapshot in only after the copy lands
 * (`snapshotReservationImage`), so a fresh snapshot is briefly held by nothing.
 * That gap is seconds; a day leaves room for any retry or slow store.
 */
export const SNAPSHOT_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/** One unreferenced snapshot. The path is a random UUID, so it names nobody. */
export interface OrphanSnapshot {
  pathname: string;
  size: number;
  uploadedAt: string;
}

// A type, not an interface, so it passes as a `MigrationSummary` record.
export type OrphanSnapshotReport = {
  /** Snapshot blobs in the store. */
  scanned: number;
  scannedBytes: number;
  /** Too young to judge (inside the grace period); never reported as orphans. */
  inGracePeriod: number;
  /** Held by a reservation or gift log. */
  referenced: number;
  orphans: OrphanSnapshot[];
  orphanBytes: number;
};

/**
 * List every blob under `snapshots/` and report the ones older than `graceMs`
 * that no `Reservation` or `GiftLog` holds. Read-only: it deletes nothing.
 *
 * Without our own store (local dev, CI) there is nothing of ours to scan, and
 * the report is empty. A failed listing or lookup throws, so a partial scan is
 * never passed off as a complete one.
 */
export async function findOrphanSnapshots({
  now = new Date(),
  graceMs = SNAPSHOT_ORPHAN_GRACE_MS,
}: { now?: Date; graceMs?: number } = {}): Promise<OrphanSnapshotReport> {
  const report: OrphanSnapshotReport = {
    scanned: 0,
    scannedBytes: 0,
    inGracePeriod: 0,
    referenced: 0,
    orphans: [],
    orphanBytes: 0,
  };
  if (!ownBlobHost()) return report;

  const cutoff = now.getTime() - graceMs;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: 'snapshots/', cursor, limit: 1000 });
    cursor = page.cursor;

    const candidates = [];
    for (const blob of page.blobs) {
      // Only files directly in the folder are snapshots we ever write or free.
      if (!isSnapshotBlob(blob.url)) continue;
      report.scanned++;
      report.scannedBytes += blob.size;
      if (new Date(blob.uploadedAt).getTime() > cutoff) report.inGracePeriod++;
      else candidates.push(blob);
    }
    if (candidates.length === 0) continue;

    const urls = candidates.map((b) => b.url);
    const [reserved, gifted] = await Promise.all([
      Reservation.distinct('itemImage', { itemImage: { $in: urls } }),
      GiftLog.distinct('itemImage', { itemImage: { $in: urls } }),
    ]);
    const held = new Set<unknown>([...reserved, ...gifted]);
    for (const blob of candidates) {
      if (held.has(blob.url)) {
        report.referenced++;
        continue;
      }
      report.orphans.push({
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: new Date(blob.uploadedAt).toISOString(),
      });
      report.orphanBytes += blob.size;
    }
  } while (cursor);

  return report;
}
