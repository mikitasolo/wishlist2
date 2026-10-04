import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
// A share card purge is a CDN call; these tests are about the answer and the log.
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: vi.fn() }));

import { auth } from '@/lib/auth';
import { PATCH } from '@/app/api/users/me/route';
import User from '@/models/User';

const session = vi.mocked(auth);
let alice: string;

beforeAll(async () => {
  await connectTestDB();
  // The unique index is what refuses the racing write, so it has to exist.
  await User.init();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  alice = (await User.create({ email: 'a@x.com', username: 'alice' }))._id.toString();
  session.mockResolvedValue({ user: { id: alice } } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function patch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

/** Everything a console spy was given, as one string to look for a value in. */
function logged(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls
    .map((args) =>
      args
        .map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a)))
        .join(' ')
    )
    .join('\n');
}

describe('PATCH /api/users/me — two accounts claiming one username at once', () => {
  // regression: WIS-212. Both accounts passed the `User.exists` pre-check, and
  // the second write's E11000 from the unique index fell through to the
  // catch-all: a 500, and a log line quoting `dup key: { username: "…" }`.
  it('regression: answers the 409 "already taken" when the write hits the unique index, and logs no username', async () => {
    const spies = [
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'log').mockImplementation(() => {}),
    ];
    // The other account claims the name right after this request's pre-check.
    const exists = User.exists.bind(User);
    vi.spyOn(User, 'exists').mockImplementationOnce(((filter: Parameters<typeof exists>[0]) =>
      exists(filter).then(async (result) => {
        await User.create({ email: 'b@x.com', username: 'maria_nowak' });
        return result;
      })) as never);

    const res = await patch({ username: 'maria_nowak' });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: 'That username is already taken.',
    });
    expect((await User.findById(alice).lean())?.username).toBe('alice');
    for (const spy of spies) expect(logged(spy)).not.toContain('maria_nowak');
  });

  it('logs any other failure of the write by its kind alone, with the 500', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(User, 'findOneAndUpdate').mockRejectedValueOnce(
      Object.assign(new Error('E11000 duplicate key error dup key: { email: "a@x.com" }'), {
        code: 11000,
        keyPattern: { email: 1 },
      })
    );

    const res = await patch({ username: 'maria_nowak' });

    expect(res.status).toBe(500);
    expect(logged(error)).not.toContain('a@x.com');
    expect(logged(error)).not.toContain('maria_nowak');
    expect(error).toHaveBeenCalledWith('Error updating profile:', { name: 'Error', code: 11000 });
  });

  it('still answers a clash the pre-check sees with the same 409', async () => {
    await User.create({ email: 'b@x.com', username: 'maria_nowak' });
    const res = await patch({ username: 'maria_nowak' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('That username is already taken.');
  });
});
