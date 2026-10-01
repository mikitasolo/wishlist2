import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
// Record which blobs a delete frees instead of talking to a store.
const deleteBlob = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  del: (...a: unknown[]) => deleteBlob(...a),
  list: vi.fn(),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { POST as CREATE } from '@/app/api/wishlists/route';
import { GET, PATCH, DELETE } from '@/app/api/wishlists/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';

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
      owners: [ownerId],
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
      owners: [ownerId],
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

describe('DELETE /api/wishlists/[id] — cleanup', () => {
  let doomedId: string;
  let keptId: string;

  function del(id: string, userId: string) {
    session.mockResolvedValue({ user: { id: userId } } as never);
    const req = new NextRequest('http://localhost/api/wishlists/' + id, { method: 'DELETE' });
    return DELETE(req, { params: Promise.resolve({ id }) });
  }

  // Everything a list accumulates that points back at it: invites in every
  // status, and one notification of each wishlist-linked type.
  async function seedInvitesAndNotifications(wishlistId: string) {
    await WishlistInvite.create([
      { wishlist: wishlistId, invitedBy: ownerId, invitedUser: otherId, status: 'pending' },
      { wishlist: wishlistId, invitedBy: ownerId, invitedUser: otherId, status: 'declined' },
      { wishlist: wishlistId, invitedBy: ownerId, invitedUser: otherId, status: 'accepted' },
    ]);
    const types = ['wishlist_invite', 'invite_accepted', 'proposal', 'proposal_approved'] as const;
    await Notification.create(
      types.map((type) => ({ user: otherId, type, wishlist: wishlistId, wishlistName: 'List' }))
    );
  }

  beforeEach(async () => {
    const doomed = await Wishlist.create({
      name: 'Doomed',
      owners: [ownerId],
      visibility: 'everyone',
      slug: 'doomed',
    });
    const kept = await Wishlist.create({
      name: 'Kept',
      owners: [ownerId],
      visibility: 'everyone',
      slug: 'kept',
    });
    doomedId = doomed._id.toString();
    keptId = kept._id.toString();
    await WishlistMember.create({ wishlist: doomedId, user: otherId });
    await seedInvitesAndNotifications(doomedId);
    await seedInvitesAndNotifications(keptId);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('deletes its items and memberships, and frees the images uploaded for it', async () => {
    // A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
    // store's public host is derived from it.
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', ['vercel', 'blob', 'rw', 'TestStore42', 'x'].join('_'));
    const blob = (name: string) =>
      `https://teststore42.public.blob.vercel-storage.com/uploads/${ownerId}/${name}`;
    await Wishlist.updateOne({ _id: doomedId }, { $set: { bannerUrl: blob('cover.jpg') } });
    await Item.create([
      { wishlist: doomedId, name: 'Uploaded', imageUrl: blob('item.jpg') },
      { wishlist: doomedId, name: 'Linked', imageUrl: 'https://images.example.com/photo.jpg' },
      { wishlist: keptId, name: 'Elsewhere', imageUrl: blob('kept.jpg') },
    ]);
    deleteBlob.mockClear();

    expect((await del(doomedId, ownerId)).status).toBe(200);

    expect(await Item.countDocuments({ wishlist: doomedId })).toBe(0);
    expect(await Item.countDocuments({ wishlist: keptId })).toBe(1);
    expect(await WishlistMember.countDocuments({ wishlist: doomedId })).toBe(0);
    // Only our own uploads for this list: never a pasted external URL.
    expect(deleteBlob.mock.calls.map(([url]) => url).sort()).toEqual(
      [blob('cover.jpg'), blob('item.jpg')].sort()
    );
  });

  // Regression: deleting a list left its invites and notifications behind, so
  // recipients kept notifications (including actionable-looking invites) that
  // linked to a 404.
  it('regression: deletes every invite (any status) and notification for the list', async () => {
    const res = await del(doomedId, ownerId);
    expect(res.status).toBe(200);

    expect(await Wishlist.findById(doomedId)).toBeNull();
    expect(await WishlistInvite.countDocuments({ wishlist: doomedId })).toBe(0);
    expect(await Notification.countDocuments({ wishlist: doomedId })).toBe(0);
  });

  it('leaves invites and notifications for other lists, and unrelated notifications, alone', async () => {
    await Notification.create({ user: ownerId, type: 'follow', actorUsername: 'other' });

    await del(doomedId, ownerId);

    expect(await WishlistInvite.countDocuments({ wishlist: keptId })).toBe(3);
    expect(await Notification.countDocuments({ wishlist: keptId })).toBe(4);
    expect(await Notification.countDocuments({ type: 'follow', user: ownerId })).toBe(1);
  });

  // Reservations and gift logs belong to the gifter: they must outlive the list
  // so the gifter can still see what they claimed and log the gift.
  it('leaves reservations and gift logs for the list untouched', async () => {
    const item = await Item.create({
      wishlist: doomedId,
      name: 'Gift',
      status: 'booked',
      bookedBy: otherId,
    });
    const reservation = await Reservation.create({
      gifter: otherId,
      wishlist: doomedId,
      item: item._id,
      owner: ownerId,
      itemName: 'Gift',
      wishlistName: 'Doomed',
    });
    const giftLog = await GiftLog.create({
      gifter: otherId,
      giftedAt: new Date(),
      itemName: 'Earlier gift',
      recipient: ownerId,
      wishlistName: 'Doomed',
      wishlist: doomedId,
    });

    expect((await del(doomedId, ownerId)).status).toBe(200);

    expect(await Reservation.findById(reservation._id)).not.toBeNull();
    expect(await GiftLog.findById(giftLog._id)).not.toBeNull();
  });

  // Cleanup is best-effort: the list is already gone, so a failed step must
  // neither fail the delete nor stop the other (independent) step from running.
  async function expectDeleteSurvives(
    failing: { mockRestore(): void },
    otherStepLeftovers: () => PromiseLike<number>
  ) {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await del(doomedId, ownerId);
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);

      expect(await Wishlist.findById(doomedId)).toBeNull();
      expect(log).toHaveBeenCalledWith(expect.stringContaining(doomedId), expect.any(Error));
      expect(await otherStepLeftovers()).toBe(0);
    } finally {
      failing.mockRestore();
      log.mockRestore();
    }
  }

  it('still deletes the list and succeeds when item cleanup fails', async () => {
    await expectDeleteSurvives(
      vi.spyOn(Item, 'deleteMany').mockRejectedValueOnce(new Error('db hiccup')),
      () => WishlistMember.countDocuments({ wishlist: doomedId })
    );
  });

  it('still deletes the list and succeeds when membership cleanup fails', async () => {
    await expectDeleteSurvives(
      vi.spyOn(WishlistMember, 'deleteMany').mockRejectedValueOnce(new Error('db hiccup')),
      () => WishlistInvite.countDocuments({ wishlist: doomedId })
    );
  });

  it('still deletes the list and succeeds when invite cleanup fails', async () => {
    await expectDeleteSurvives(
      vi.spyOn(WishlistInvite, 'deleteMany').mockRejectedValueOnce(new Error('db hiccup')),
      () => Notification.countDocuments({ wishlist: doomedId })
    );
  });

  it('still deletes the list and succeeds when notification cleanup fails', async () => {
    await expectDeleteSurvives(
      vi.spyOn(Notification, 'deleteMany').mockRejectedValueOnce(new Error('db hiccup')),
      () => WishlistInvite.countDocuments({ wishlist: doomedId })
    );
  });

  it('refuses a non-owner and leaves everything on the list in place', async () => {
    const item = await Item.create({ wishlist: doomedId, name: 'Gift' });

    const res = await del(doomedId, otherId);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/only an owner can delete/i);

    expect(await Wishlist.findById(doomedId)).not.toBeNull();
    expect(await Item.findById(item._id)).not.toBeNull();
    expect(await WishlistMember.countDocuments({ wishlist: doomedId })).toBe(1);
    expect(await WishlistInvite.countDocuments({ wishlist: doomedId })).toBe(3);
    expect(await Notification.countDocuments({ wishlist: doomedId })).toBe(4);
  });
});

describe('POST /api/wishlists and PATCH /api/wishlists/[id] — name validation', () => {
  // A name the invite email's plain-text part would render as a second paragraph.
  const MULTI_LINE_NAME =
    'Birthday\n\nACTION REQUIRED: verify your account at https://evil.example';

  beforeEach(() => {
    session.mockResolvedValue({ user: { id: ownerId } } as never);
  });

  function send(url: string, method: 'POST' | 'PATCH', body: unknown) {
    return new NextRequest(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // regression: the schemas didn't refuse an inner line break, so a direct API
  // call could store one in the name the invite email takes raw.
  it('regression: refuses to create a list whose name has a line break, and stores nothing', async () => {
    const res = await CREATE(
      send('http://localhost/api/wishlists', 'POST', { name: MULTI_LINE_NAME })
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name: .*line breaks/i);
    expect(await Wishlist.countDocuments()).toBe(0);
  });

  it('regression: refuses to rename a list to a name with a line break, and keeps the old name', async () => {
    const wl = await Wishlist.create({ name: 'Birthday', owners: [ownerId], slug: 'birthday' });
    const id = wl._id.toString();

    const res = await PATCH(
      send(`http://localhost/api/wishlists/${id}`, 'PATCH', { name: MULTI_LINE_NAME }),
      { params: Promise.resolve({ id }) }
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/name: .*line breaks/i);
    expect((await Wishlist.findById(id))?.name).toBe('Birthday');
  });

  // regression: the schema checked the name's length before trimming it, so
  // "   " passed as a name, trimmed to "", and the model's `required` refused it
  // inside the route: a 500 "Failed to create/update wishlist" instead of a 400.
  it('regression: refuses to create a list whose name is only spaces (400), and stores nothing', async () => {
    const res = await CREATE(send('http://localhost/api/wishlists', 'POST', { name: '   ' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation error: name: Wishlist name is required');
    expect(await Wishlist.countDocuments()).toBe(0);
  });

  it('regression: refuses to rename a list to a name that is only spaces (400), and keeps the old name', async () => {
    const wl = await Wishlist.create({ name: 'Birthday', owners: [ownerId], slug: 'birthday' });
    const id = wl._id.toString();

    const res = await PATCH(
      send(`http://localhost/api/wishlists/${id}`, 'PATCH', { name: '   ' }),
      {
        params: Promise.resolve({ id }),
      }
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Validation error: name: Wishlist name is required');
    expect((await Wishlist.findById(id))?.name).toBe('Birthday');
  });

  it('still creates a list whose name only has a line break at the end, trimmed', async () => {
    const res = await CREATE(
      send('http://localhost/api/wishlists', 'POST', { name: 'Birthday\n' })
    );

    expect(res.status).toBe(201);
    expect((await Wishlist.findOne())?.name).toBe('Birthday');
  });
});
