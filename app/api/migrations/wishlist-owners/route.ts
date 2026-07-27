import Wishlist from '@/models/Wishlist';
import { createMigration } from '@/lib/utils/migration';

/**
 * POST /api/migrations/wishlist-owners
 *
 * Moves wishlists from the single-owner shape to co-ownership:
 *   owner          → owners: [owner]
 *   featured: true → featuredBy: [owner]   ("featured" is per-owner now)
 *
 * **Additive on purpose.** The legacy `owner` / `featured` fields are left in
 * place, so this is safe to run against an environment still serving the previous
 * code — that code authorizes against `owner`, and pulling it out from under a
 * running deployment would break every wishlist route. Dropping them is a
 * separate cleanup migration for once every environment runs the new code.
 *
 * Roles are untouched — this migration is only about the wishlist document.
 * (Removing the admin role is `remove-admin-role`, which is *not* backward
 * compatible and must run after the deploy.)
 *
 * Idempotent: rows that already have `owners` are skipped, so re-running is free.
 */
export const POST = createMigration(async () => {
  const rows = await Wishlist.find({
    $or: [{ owners: { $exists: false } }, { owners: { $size: 0 } }],
  }).select('owners owner featuredBy featured');

  let migrated = 0;
  let unowned = 0;

  for (const row of rows) {
    if (!row.owner) {
      // Nothing to derive an owner from — leave it alone rather than writing an
      // invalid document, and report it so it can be looked at by hand.
      unowned++;
      continue;
    }

    const owners = [row.owner];
    const featuredBy = row.featured ? [row.owner] : [];

    await Wishlist.updateOne({ _id: row._id }, { $set: { owners, featuredBy } });
    migrated++;
  }

  return { scanned: rows.length, migrated, unowned };
});
