import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import connectDB from '@/lib/mongodb';

/**
 * Constant-time secret comparison.
 *
 * A plain `a !== b` short-circuits at the first differing byte, so the time it
 * takes to reject a wrong secret leaks how long a correct prefix the attacker
 * guessed — enough to reconstruct the secret byte-by-byte over many requests.
 * We hash both sides to a fixed 32-byte digest first: that gives
 * `timingSafeEqual` two equal-length buffers (it throws on length mismatch),
 * and it avoids leaking the secret's length through a preliminary length check.
 */
function secretsMatch(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Whatever summary a migration wants to report back (counts, errors, etc.). */
export type MigrationSummary = Record<string, unknown>;

/** A migration's business logic — receives the request, returns a summary. */
export type MigrationHandler = (request: NextRequest) => Promise<MigrationSummary | void>;

/**
 * Wraps a migration's business logic with the shared plumbing every migration
 * needs, so a route only has to supply the actual work:
 *
 *   - validates the `X-Migration-Secret` header against `MIGRATION_SECRET`
 *   - opens the DB connection
 *   - normalizes the JSON response (`{ success, ...summary }`) and error handling
 *
 * Usage in `app/api/migrations/<name>/route.ts`:
 *
 *   export const POST = createMigration(async () => {
 *     const rows = await Model.find({ field: { $exists: false } });
 *     let migrated = 0;
 *     for (const row of rows) { ...; migrated++; }
 *     return { scanned: rows.length, migrated };
 *   });
 */
export function createMigration(handler: MigrationHandler) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    const expected = process.env.MIGRATION_SECRET;
    if (!expected) {
      return NextResponse.json(
        { success: false, error: 'MIGRATION_SECRET is not set' },
        { status: 500 }
      );
    }
    if (!secretsMatch(request.headers.get('X-Migration-Secret'), expected)) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Invalid migration secret' },
        { status: 401 }
      );
    }

    try {
      await connectDB();
      const summary = (await handler(request)) ?? {};
      return NextResponse.json({ success: true, ...summary }, { status: 200 });
    } catch (error) {
      console.error('Migration error:', error);
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : 'Migration failed' },
        { status: 500 }
      );
    }
  };
}
