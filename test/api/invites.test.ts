import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { PATCH } from '@/app/api/invites/[inviteId]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';

const session = vi.mocked(getServerSession);

let inviteeId: string;
let wishlistId: string;
let inviteId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const owner = await User.create({ email: 'owner@x.com', username: 'owner' });
  const invitee = await User.create({ email: 'invitee@x.com', username: 'invitee' });
  inviteeId = invitee._id.toString();
  const wl = await Wishlist.create({ name: 'List', owner: owner._id, visibility: 'friends' });
  wishlistId = wl._id.toString();
  const inv = await WishlistInvite.create({
    wishlist: wl._id,
    invitedBy: owner._id,
    invitedUser: invitee._id,
    role: 'member',
    status: 'pending',
  });
  inviteId = inv._id.toString();
});

function respond(id: string, action: string, userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
  const req = new NextRequest('http://localhost/api/invites/' + id, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  return PATCH(req, { params: Promise.resolve({ inviteId: id }) });
}

describe('PATCH /api/invites/[inviteId]', () => {
  it('accepting creates membership and marks the invite accepted', async () => {
    const res = await respond(inviteId, 'accept', inviteeId);
    expect(res.status).toBe(200);
    expect(await WishlistMember.findOne({ wishlist: wishlistId, user: inviteeId })).not.toBeNull();
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('accepted');
  });

  it('declining marks it declined and creates no membership', async () => {
    const res = await respond(inviteId, 'decline', inviteeId);
    expect(res.status).toBe(200);
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('declined');
    expect(await WishlistMember.findOne({ wishlist: wishlistId, user: inviteeId })).toBeNull();
  });

  // Regression: matching is by invitedUser only now (email-fallback removed), so
  // a different user cannot act on someone else's invite.
  it('regression: a different user cannot accept the invite', async () => {
    const other = await User.create({ email: 'other@x.com', username: 'other' });
    const res = await respond(inviteId, 'accept', other._id.toString());
    expect(res.status).toBe(403);
    expect((await WishlistInvite.findById(inviteId))?.status).toBe('pending');
  });
});
