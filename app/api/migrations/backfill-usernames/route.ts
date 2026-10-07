import type { NextRequest } from 'next/server';
import User from '@/models/User';
import { createMigration } from '@/lib/utils/migration';
import { isDuplicateKeyError } from '@/lib/utils/mongoErrors';
import { generateUniqueUsername } from '@/lib/utils/username';

/**
 * Gives every account without a username (the field missing, null or empty) a
 * generated one, `generateUniqueUsername`'s `user_xxxxxxxx` (WIS-357, PR 1):
 *
 *   curl -X POST -H "X-Migration-Secret: $MIGRATION_SECRET" "<host>/api/migrations/backfill-usernames?dryRun=1"
 *   curl -X POST -H "X-Migration-Secret: $MIGRATION_SECRET" <host>/api/migrations/backfill-usernames
 *
 * `?dryRun` (any value but `0` / `false`) only counts the accounts it would
 * fix and writes nothing. The answer is
 * `{ success, dryRun, matched, changed, skipped, gone, failed }`: `matched` is
 * how many accounts had no username when the run started, `changed` how many
 * it gave one, `skipped` how many got one from elsewhere (a sign-in's
 * `backfillUsername`) before this run's write, `gone` how many were deleted
 * meanwhile, and `failed` how many it couldn't name (lost the unique-index
 * race on every attempt, or an error): re-run to finish them.
 *
 * **Idempotent**: each write is conditional on the account still having no
 * username, so this run never overwrites one set in the meantime, and a second
 * run matches and changes 0. A generated name another writer took between the
 * check and the write trips the unique index and is drawn again. (The other
 * way round, a sign-in's `backfillUsername` that read the row before this
 * write saves unconditionally and may replace the name this run gave with
 * another generated one: harmless, and that path goes in the follow-up.)
 *
 * **Deploy order**: additive (it only fills a field old code already reads and
 * writes), so it's safe on any deployed code. Release it, run it on staging,
 * then on production, and re-run each to confirm `matched: 0`. Only then does
 * the follow-up make `username` required and drop the no-username fallbacks;
 * delete this route in that follow-up.
 *
 * Logs no usernames or emails: a duplicate-key error quotes the clashing name,
 * so none is logged, and any other per-account error is logged by its name
 * only.
 */

export const maxDuration = 60;

/** No username: the field missing, null (`null` matches both) or empty. */
const NO_USERNAME = { $or: [{ username: null }, { username: '' }] };

/** How many generated names to try per account before counting it failed. */
const MAX_ATTEMPTS = 3;

/** Accounts named at once. */
const CONCURRENCY = 20;

type Outcome = 'changed' | 'skipped' | 'gone' | 'failed';

async function backfillOne(id: unknown): Promise<Outcome> {
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const username = await generateUniqueUsername();
      try {
        // Re-checks "no username" in the write itself, so a name a concurrent
        // sign-in gave this account in the meantime is left alone.
        const result = await User.updateOne({ _id: id, ...NO_USERNAME }, { $set: { username } });
        if (result.modifiedCount === 1) return 'changed';
        return (await User.exists({ _id: id })) ? 'skipped' : 'gone';
      } catch (error) {
        // This write sets only `username`, so a duplicate key means the
        // generated name was taken between the check and the write.
        if (isDuplicateKeyError(error)) continue;
        throw error;
      }
    }
    return 'failed';
  } catch (error) {
    console.error(
      'backfill-usernames: an account failed:',
      error instanceof Error ? error.name : 'unknown error'
    );
    return 'failed';
  }
}

function isDryRun(request: NextRequest): boolean {
  const value = request.nextUrl.searchParams.get('dryRun');
  return value !== null && value !== '0' && value.toLowerCase() !== 'false';
}

export const POST = createMigration(async (request) => {
  const dryRun = isDryRun(request);
  const ids = (await User.find(NO_USERNAME).select('_id').lean()).map((user) => user._id);
  const counts: Record<Outcome, number> = { changed: 0, skipped: 0, gone: 0, failed: 0 };
  if (!dryRun) {
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const outcomes = await Promise.all(ids.slice(i, i + CONCURRENCY).map(backfillOne));
      for (const outcome of outcomes) counts[outcome]++;
    }
  }
  return { dryRun, matched: ids.length, ...counts };
});
