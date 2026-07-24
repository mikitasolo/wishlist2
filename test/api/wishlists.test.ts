import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET } from '@/app/api/wishlists/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';

const session = vi.mocked(auth);

let ownerId: string;
let otherId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const owner = await User.create({ email: 'owner@x.com', username: 'owner' });
  const other = await User.create({ email: 'other@x.com', username: 'other' });
  ownerId = owner._id.toString();
  otherId = other._id.toString();
});

function get(idOrSlug: string, userId?: string) {
  session.mockResolvedValue(userId ? ({ user: { id: userId } } as never) : (null as never));
  const req = new NextRequest('http://localhost/api/wishlists/' + idOrSlug);
  return GET(req, { params: Promise.resolve({ id: idOrSlug }) });
}

describe('GET /api/wishlists/[id] — archived visibility', () => {
  async function archived() {
    const wl = await Wishlist.create({
      name: 'Secret',
      owner: ownerId,
      visibility: 'everyone',
      archived: true,
      slug: 'secret-list',
    });
    return wl._id.toString();
  }

  // Regression: archived wishlists are owner-only — everyone else gets a 404,
  // even via a direct link, so the URL doesn't reveal it exists.
  it('regression: hides an archived wishlist from a non-owner (404)', async () => {
    const id = await archived();
    expect((await get(id, otherId)).status).toBe(404);
  });

  it('regression: hides an archived wishlist from anonymous viewers (404)', async () => {
    const id = await archived();
    expect((await get(id)).status).toBe(404);
  });

  it('still shows an archived wishlist to its owner', async () => {
    const id = await archived();
    const res = await get(id, ownerId);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/wishlists/[id] — slug resolution', () => {
  it('resolves a wishlist by its slug', async () => {
    const wl = await Wishlist.create({
      name: 'Public List',
      owner: ownerId,
      visibility: 'everyone',
      slug: 'public-list',
    });
    const res = await get('public-list');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data._id).toBe(wl._id.toString());
  });

  it('404s for an unknown slug', async () => {
    expect((await get('does-not-exist')).status).toBe(404);
  });
});
