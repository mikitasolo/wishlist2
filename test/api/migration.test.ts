import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createMigration } from '@/lib/utils/migration';

// No real DB needed — createMigration only calls connectDB(), which we stub.
vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

function post(secret?: string) {
  const headers: Record<string, string> = {};
  if (secret !== undefined) headers['X-Migration-Secret'] = secret;
  return new NextRequest('http://localhost/api/migrations/test', { method: 'POST', headers });
}

describe('createMigration secret gate', () => {
  beforeEach(() => {
    process.env.MIGRATION_SECRET = 'right-secret';
  });

  it('500s when MIGRATION_SECRET is not configured', async () => {
    delete process.env.MIGRATION_SECRET;
    const handler = createMigration(async () => ({ ran: true }));
    const res = await handler(post('anything'));
    expect(res.status).toBe(500);
    process.env.MIGRATION_SECRET = 'right-secret';
  });

  // regression: a plain `!==` comparison is timing-attackable and could also
  // throw on a null header. The gate must reject a missing header, a wrong
  // secret, and a same-length-wrong secret without running the handler.
  it('401s and does not run the handler when the header is missing', async () => {
    const run = vi.fn(async () => ({ ran: true }));
    const res = await createMigration(run)(post());
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('401s on a wrong secret of the same length', async () => {
    const run = vi.fn(async () => ({ ran: true }));
    const res = await createMigration(run)(post('wrong-secret'));
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs the handler and returns its summary on the correct secret', async () => {
    const res = await createMigration(async () => ({ migrated: 3 }))(post('right-secret'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, migrated: 3 });
  });
});
