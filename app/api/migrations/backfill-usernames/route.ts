import type { NextRequest } from 'next/server';
import User from '@/models/User';
import { createMigration } from '@/lib/utils/migration';
import { duplicateKeyField } from '@/lib/utils/mongoErrors';
import { generateUniqueUsername } from '@/lib/utils/username';

/**
 * Gives every account without a username (the field missing, null or empty) a
 * generated one, `generateUniqueUsername`'s `user_xxxxxxxx` (WIS-357, PR 1):
 *
 *   curl -X POST -H "X-Migration-Secret: $MIGRATION_SECRET" "<host>/api/migrations/backfill-usernames?dryRun=1"
 *   curl -X POST -H "X-Migration-Secret: $MIGRATION_SECRET" <host>/api/migrations/backfill-usernames
 *
 * `?dryRun=1` only counts the accounts it would fix and writes nothing. The
 * answer is `{ success, dryRun, matched, changed, skipped, failed }`:
 * `matched` is how many accounts had no username when the run started,
 * `changed` how many it gave one, `skipped` how many got one from elsewhere
 * (a sign-in's `backfillUsername`) before this run's write, and `failed` how
 * many lost the unique-index race on every attempt (re-run to finish them).
 *
 * **Idempotent**: each write is conditional on the account still having no
 * username, so it never overwrites one set in the meantime, and a second run
 * matches and changes 0. A generated name another writer took between the
 * check and the write trips the unique index and is drawn again.
 *
 * **Deploy order**: additive (it only fills a field old code already reads and
 * writes), so it's safe on any deployed code. Release it, run it on staging,
 * then on production, and re-run each to confirm `matched: 0`. Only then does
 * the follow-up make `username` required and drop the no-username fallbacks;
 * delete this route in that follow-up.
 *
 * Logs no usernames or emails: a duplicate-key error is reported by its field
 * only, and nothing per account is logged.
 */

/** No username: the field missing, null (`null` matches both) or empty. */
const NO_USERNAME = { $or: [{ username: null }, { username: '' }] };

/** How many generated names to try per account before counting it failed. */
const MAX_ATTEMPTS = 3;

type Outcome = 'changed' | 'skipped' | 'failed';

async function backfillOne(id: unknown): Promise<Outcome> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const username = await generateUniqueUsername();
    try {
      // Re-checks "no username" in the write itself, so a name a concurrent
      // sign-in gave this account in the meantime is left alone.
      const result = await User.updateOne({ _id: id, ...NO_USERNAME }, { $set: { username } });
      return result.modifiedCount === 1 ? 'changed' : 'skipped';
    } catch (error) {
      // The generated name was taken between the check and this write.
      if (duplicateKeyField(error) === 'username') continue;
      throw error;
    }
  }
  return 'failed';
}

function isDryRun(request: NextRequest): boolean {
  const value = request.nextUrl.searchParams.get('dryRun');
  return value === '1' || value === 'true';
}

export const POST = createMigration(async (request) => {
  const dryRun = isDryRun(request);
  const ids = (await User.find(NO_USERNAME).select('_id').lean()).map((user) => user._id);
  if (dryRun) return { dryRun, matched: ids.length, changed: 0, skipped: 0, failed: 0 };

  const counts: Record<Outcome, number> = { changed: 0, skipped: 0, failed: 0 };
  for (const id of ids) counts[await backfillOne(id)]++;
  return { dryRun, matched: ids.length, ...counts };
});
