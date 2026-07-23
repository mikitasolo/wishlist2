import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';

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
    if (request.headers.get('X-Migration-Secret') !== expected) {
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
