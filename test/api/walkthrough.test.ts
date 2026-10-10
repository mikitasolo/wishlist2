import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// The guided walkthrough's state (WIS-371): what GET /api/users/me says is due,
// the visit it records (`lastActiveAt`, at most once a day, the three-month
// re-offer decided by the write that bumps it), and the answers PATCH takes.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET, PATCH } from '@/app/api/users/me/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import { TOUR_VERSION } from '@/lib/utils/walkthrough';

const session = vi.mocked(auth);
const DAY = 24 * 60 * 60 * 1000;
let alice: string;
let bob: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  alice = (await User.create({ email: 'a@x.com', username: 'alice' }))._id.toString();
  bob = (await User.create({ email: 'b@x.com', username: 'bob' }))._id.toString();
  session.mockResolvedValue({ user: { id: alice } } as never);
});

async function status() {
  const res = await GET();
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

async function patch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

const stored = async (id = alice) => (await User.findById(id).lean())!;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
/** Alice has finished the tour, last seen `lastActiveAt`. */
const finishedAndLastSeen = (lastActiveAt: Date) =>
  User.updateOne(
    { _id: alice },
    { $set: { walkthrough: { version: TOUR_VERSION, completedAt: daysAgo(200) }, lastActiveAt } }
  );

describe('GET /api/users/me walkthrough', () => {
  it('answers 401 signed out', async () => {
    session.mockResolvedValue(null as never);
    expect((await GET()).status).toBe(401);
  });

  it('has the tour due for a new account, and records the visit', async () => {
    const data = await status();
    expect(data.walkthrough).toEqual({ due: 'tour', ownsList: false, listPath: null });
    expect((await stored()).lastActiveAt).toBeInstanceOf(Date);
  });

  it('answers what is due, never the stored state or the last visit', async () => {
    await finishedAndLastSeen(daysAgo(2));
    const data = await status();
    expect(Object.keys(data.walkthrough).sort()).toEqual(['due', 'listPath', 'ownsList']);
    expect(data).not.toHaveProperty('lastActiveAt');
  });

  it('says whether they own or co-own a list', async () => {
    await Wishlist.create({
      name: 'Bob and Alice',
      owners: [bob, alice],
      visibility: 'everyone',
      slug: 'shared-owners',
      currency: 'USD',
    });
    expect((await status()).walkthrough).toMatchObject({
      ownsList: true,
      listPath: '/wishlists/shared-owners',
    });
  });

  it('names an unarchived list of theirs for the tour, never someone else’s', async () => {
    await Wishlist.create({
      name: 'Old one',
      owners: [alice],
      visibility: 'everyone',
      slug: 'old-one',
      currency: 'USD',
      archived: true,
    });
    await Wishlist.create({
      name: 'Bob’s',
      owners: [bob],
      visibility: 'everyone',
      slug: 'bobs',
      currency: 'USD',
    });
    // Only an archived list of their own: they own one, but there's none to show.
    expect((await status()).walkthrough).toMatchObject({ ownsList: true, listPath: null });

    await Wishlist.create({
      name: 'Live one',
      owners: [alice],
      visibility: 'private',
      slug: 'live-one',
      currency: 'USD',
    });
    expect((await status()).walkthrough.listPath).toBe('/wishlists/live-one');
  });

  it('bumps the last visit at most once a day', async () => {
    const recent = daysAgo(0.5);
    await finishedAndLastSeen(recent);
    await status();
    expect((await stored()).lastActiveAt).toEqual(recent);

    const yesterday = daysAgo(1.1);
    await finishedAndLastSeen(yesterday);
    await status();
    expect((await stored()).lastActiveAt!.getTime()).toBeGreaterThan(yesterday.getTime());
  });

  it('offers nothing after 89 days away', async () => {
    await finishedAndLastSeen(daysAgo(89));
    expect((await status()).walkthrough.due).toBeNull();
  });

  it('offers the tour after 90 days away, decided before the visit is bumped', async () => {
    await finishedAndLastSeen(daysAgo(90));
    expect((await status()).walkthrough.due).toBe('offer');
    // The bump has landed, and the offer stands until it's answered.
    expect(Date.now() - (await stored()).lastActiveAt!.getTime()).toBeLessThan(DAY);
    expect((await status()).walkthrough.due).toBe('offer');
  });

  it('offers it to both of two reads racing the visit back', async () => {
    await finishedAndLastSeen(daysAgo(120));
    const [a, b] = await Promise.all([status(), status()]);
    expect([a.walkthrough.due, b.walkthrough.due]).toEqual(['offer', 'offer']);
  });

  it('a dismissed offer stays quiet until the next three-month gap', async () => {
    await finishedAndLastSeen(daysAgo(100));
    expect((await status()).walkthrough.due).toBe('offer');
    expect((await patch({ walkthrough: 'offer_dismissed' })).status).toBe(200);
    expect((await status()).walkthrough.due).toBeNull();

    await User.updateOne({ _id: alice }, { $set: { lastActiveAt: daysAgo(95) } });
    expect((await status()).walkthrough.due).toBe('offer');
  });

  it('shows the tour again to someone who finished an older version', async () => {
    await User.updateOne(
      { _id: alice },
      { $set: { walkthrough: { version: TOUR_VERSION - 1, completedAt: daysAgo(30) } } }
    );
    expect((await status()).walkthrough.due).toBe('tour');
  });
});

describe('PATCH /api/users/me walkthrough', () => {
  it.each(['skipped', 'completed'] as const)(
    '%s marks it done for this version',
    async (action) => {
      expect((await patch({ walkthrough: action })).status).toBe(200);
      const { walkthrough } = await stored();
      expect(walkthrough?.version).toBe(TOUR_VERSION);
      expect(walkthrough?.[action === 'skipped' ? 'skippedAt' : 'completedAt']).toBeInstanceOf(
        Date
      );
      expect((await status()).walkthrough.due).toBeNull();
    }
  );

  it('writes the caller’s own account only', async () => {
    await patch({ walkthrough: 'skipped' });
    expect((await stored(bob)).walkthrough?.skippedAt).toBeUndefined();
  });

  it('restart makes the tour due again until it is finished', async () => {
    await patch({ walkthrough: 'completed' });
    await patch({ walkthrough: 'restart' });
    expect((await status()).walkthrough.due).toBe('tour');
    await patch({ walkthrough: 'completed' });
    expect((await status()).walkthrough.due).toBeNull();
  });

  it('accepting the offer answers it', async () => {
    await finishedAndLastSeen(daysAgo(100));
    await status();
    await patch({ walkthrough: 'offer_accepted' });
    expect((await status()).walkthrough.due).toBeNull();
  });

  it('refuses an unknown answer', async () => {
    expect((await patch({ walkthrough: 'forever' })).status).toBe(400);
  });

  it('leaves the rest of the profile alone', async () => {
    await User.updateOne({ _id: alice }, { $set: { bio: 'Mugs.' } });
    await patch({ walkthrough: 'skipped' });
    expect((await stored()).bio).toBe('Mugs.');
  });
});
