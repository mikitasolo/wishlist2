import { createMigration } from '@/lib/utils/migration';
import { findOrphanSnapshots } from '@/lib/utils/orphanSnapshots';

/**
 * Operator-only, read-only report of snapshot blobs that no reservation or gift
 * log holds (WIS-104), behind the same `X-Migration-Secret` gate as migrations:
 *
 *   curl -X POST -H "X-Migration-Secret: $MIGRATION_SECRET" <host>/api/maintenance/orphan-snapshots
 *
 * Deletes nothing and writes nothing, so it's safe to run on any host at any
 * time. Unlike a migration it stays in the tree.
 */
export const POST = createMigration(() => findOrphanSnapshots());
