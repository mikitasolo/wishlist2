import { del, list } from '@vercel/blob';
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
 * `findOrphanSnapshots` only reports them; `sweepOrphanSnapshots` (the monthly
 * cron, WIS-331) deletes them. Deleting must not trust one scan: marking a gift
 * deletes the reservation before it writes the `GiftLog` that takes the
 * snapshot over, so a scan landing between the two sees an old, held snapshot
 * as unheld. So the sweep checks each orphan's holders again
 * `SWEEP_RECHECK_DELAY_MS` later and deletes only what is still unheld.
 */

/**
 * How old a snapshot must be before it can count as an orphan. Booking writes
 * the reservation first and swaps the snapshot in only after the copy lands
 * (`snapshotReservationImage`), so a fresh snapshot is briefly held by nothing.
 * That gap is a few seconds, and can't outlast the booking request's function
 * (minutes at most). A day is far past that, and costs nothing: a leak waits a
 * day longer to be freed.
 */
export const SNAPSHOT_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/** The snapshot URLs among `urls` that a reservation or gift log holds now. */
async function heldSnapshots(urls: string[]): Promise<Set<unknown>> {
  const [reserved, gifted] = await Promise.all([
    Reservation.distinct('itemImage', { itemImage: { $in: urls } }),
    GiftLog.distinct('itemImage', { itemImage: { $in: urls } }),
  ]);
  return new Set<unknown>([...reserved, ...gifted]);
}

/** One unreferenced snapshot. The path is a random UUID, so it names nobody. */
export interface OrphanSnapshot {
  url: string;
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

    const held = await heldSnapshots(candidates.map((b) => b.url));
    for (const blob of candidates) {
      if (held.has(blob.url)) {
        report.referenced++;
        continue;
      }
      report.orphans.push({
        url: blob.url,
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: new Date(blob.uploadedAt).toISOString(),
      });
      report.orphanBytes += blob.size;
    }
  } while (cursor);

  return report;
}

/**
 * How long the sweep waits before checking an orphan's holders a second time.
 * The gap it covers is the gift route's: between deleting the reservation and
 * writing the gift log (one user lookup, normally milliseconds), and, if that
 * write fails, until the reservation is put back. Against a slow or failing
 * database that wait can reach the driver's 30s server-selection timeout, so
 * the re-check waits longer than that. A monthly job can spare the time.
 */
export const SWEEP_RECHECK_DELAY_MS = 45_000;

/**
 * At most this many deletions per run. Normal leaks are a handful a month; a
 * run finding more than this means something is broken and wants a human, so
 * it stops there and leaves the rest for the next run (or a manual one). It
 * also keeps a run well inside the function's time limit.
 */
export const SWEEP_MAX_DELETIONS = 500;

/** Blobs per `del()` call. */
const DELETE_CHUNK = 100;

export type SnapshotSweepResult = {
  scanned: number;
  orphansFound: number;
  /** Held again by the second check (a gift hand-off mid-scan); kept. */
  keptNowHeld: number;
  deleted: number;
  deletedBytes: number;
  deleteFailed: number;
  /** Past `SWEEP_MAX_DELETIONS`; left for the next run. */
  leftForNextRun: number;
};

/**
 * Delete the orphaned snapshots `findOrphanSnapshots` reports, after checking
 * each one's holders again `recheckDelayMs` later (see the gift hand-off note at
 * the top). At most `maxDeletions` per run. A failed listing or lookup throws
 * before anything is deleted; a failed delete is counted, and the blob is
 * simply found again next run. Logs carry counts only.
 */
export async function sweepOrphanSnapshots({
  now = new Date(),
  graceMs = SNAPSHOT_ORPHAN_GRACE_MS,
  maxDeletions = SWEEP_MAX_DELETIONS,
  recheckDelayMs = SWEEP_RECHECK_DELAY_MS,
}: {
  now?: Date;
  graceMs?: number;
  maxDeletions?: number;
  recheckDelayMs?: number;
} = {}): Promise<SnapshotSweepResult> {
  const report = await findOrphanSnapshots({ now, graceMs });
  const batch = report.orphans.slice(0, maxDeletions);
  const result: SnapshotSweepResult = {
    scanned: report.scanned,
    orphansFound: report.orphans.length,
    keptNowHeld: 0,
    deleted: 0,
    deletedBytes: 0,
    deleteFailed: 0,
    leftForNextRun: report.orphans.length - batch.length,
  };
  if (batch.length === 0) return result;

  await new Promise((resolve) => setTimeout(resolve, recheckDelayMs));
  const held = await heldSnapshots(batch.map((o) => o.url));
  // Defensive: only ever delete a file directly in `snapshots/`.
  const doomed = batch.filter((o) => !held.has(o.url) && isSnapshotBlob(o.url));
  result.keptNowHeld = batch.length - doomed.length;

  for (let i = 0; i < doomed.length; i += DELETE_CHUNK) {
    const chunk = doomed.slice(i, i + DELETE_CHUNK);
    try {
      await del(chunk.map((o) => o.url));
      result.deleted += chunk.length;
      result.deletedBytes += chunk.reduce((sum, o) => sum + o.size, 0);
    } catch (err) {
      result.deleteFailed += chunk.length;
      console.error(
        `Snapshot sweep: deleting ${chunk.length} blobs failed (${err instanceof Error ? err.name : 'unknown error'})`
      );
    }
  }
  return result;
}
