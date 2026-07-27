import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
const sendEmail = vi.fn();
vi.mock('@/lib/email', () => ({
  sendWishlistInvitationEmail: (...a: unknown[]) => sendEmail(...a),
}));

import { auth } from '@/lib/auth';
import { POST } from '@/app/api/wishlists/[id]/members/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistInvite from '@/models/WishlistInvite';

const session = vi.mocked(auth);

let ownerId: string;
let wishlistId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
  const owner = await User.create({ email: 'owner@x.com', username: 'owner' });
  ownerId = owner._id.toString();
  await User.create({ email: 'friend@x.com', username: 'friend' });
  const wl = await Wishlist.create({ name: 'List', owners: [owner._id], visibility: 'everyone' });
  wishlistId = wl._id.toString();
});

function invite(id: string, body: unknown, userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
  const req = new NextRequest('http://localhost/api/wishlists/' + id + '/members', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

describe('POST /api/wishlists/[id]/members — invites', () => {
  it('owner invites an existing user by username → pending invite + email', async () => {
    const res = await invite(wishlistId, { username: 'friend' }, ownerId);
    expect(res.status).toBe(201);
    const inv = await WishlistInvite.findOne({ wishlist: wishlistId });
    expect(inv?.status).toBe('pending');
    expect(inv?.role).toBe('member');
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  // Regression: invites are registered-users-only. An email is not a valid target.
  it('regression: rejects an email-only invite (no username)', async () => {
    const res = await invite(wishlistId, { email: 'stranger@x.com' }, ownerId);
    expect(res.status).toBe(400);
    expect(await WishlistInvite.countDocuments()).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('404s for an unknown username', async () => {
    const res = await invite(wishlistId, { username: 'ghost' }, ownerId);
    expect(res.status).toBe(404);
  });

  it('non-owner / non-admin cannot invite', async () => {
    const stranger = await User.create({ email: 's@x.com', username: 'stranger' });
    const res = await invite(wishlistId, { username: 'friend' }, stranger._id.toString());
    expect(res.status).toBe(403);
  });

  it("respects the invitee's whoCanInvite = nobody", async () => {
    await User.create({
      email: 'shy@x.com',
      username: 'shy',
      privacy: { whoCanInvite: 'nobody' },
    });
    const res = await invite(wishlistId, { username: 'shy' }, ownerId);
    expect(res.status).toBe(403);
  });
});
