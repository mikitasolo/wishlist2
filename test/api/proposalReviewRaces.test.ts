import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// An owner's approval of a proposal is decided on the item as the route first
// read it (still `proposed`), so it must only be written if the item is still a
// proposal when the write lands. Each race below holds one owner's item write
// while a co-owner's review (or a delete) runs to completion, then lets it
// through: the order a real race only hits by luck.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
// A store that records copies and deletions instead of performing them, so a
// test can tell which images were freed.
const copy = vi.fn();
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  copy: (...a: unknown[]) => copy(...a),
  del: (...a: unknown[]) => del(...a),
  list: vi.fn(),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { PATCH, DELETE } from '@/app/api/items/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Notification from '@/models/Notification';
import Reservation from '@/models/Reservation';

const session = vi.mocked(auth);

// A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
// store's public host is derived from it.
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';

let owner: string;
let coOwner: string;
let alice: string;
let bob: string;
let itemId: string;
// The image Alice proposed the item with.
let proposedImage: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  del.mockClear();
  copy.mockReset();
  copy.mockImplementation(async (_from: string, to: string) => ({ url: `${HOST}/${to}` }));
  const [o, c, a, b] = await User.create([
    { email: 'o@x.com', username: 'owner' },
    { email: 'c@x.com', username: 'coowner' },
    { email: 'a@x.com', username: 'alice' },
    { email: 'b@x.com', username: 'bob' },
  ]);
  [owner, coOwner, alice, bob] = [o, c, a, b].map((u) => u._id.toString());
  proposedImage = `${HOST}/uploads/${alice}/proposal-abc.jpg`;
  const wl = await Wishlist.create({
    name: 'Birthday',
    owners: [o._id, c._id],
    visibility: 'everyone',
  });
  await WishlistMember.create([
    { wishlist: wl._id, user: a._id },
    { wishlist: wl._id, user: b._id },
  ]);
  const item = await Item.create({
    wishlist: wl._id,
    name: 'Blue Mug',
    notes: 'Size M',
    imageUrl: proposedImage,
    status: 'proposed',
    proposedBy: a._id,
  });
  itemId = item._id.toString();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// `auth()` is the first thing the handler calls, synchronously on invocation, so
// a one-shot session is consumed by this call even while another is in flight.
function patchAs(user: string, body: unknown) {
  session.mockResolvedValueOnce({ user: { id: user } } as never);
  const req = new NextRequest(`http://localhost/api/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id: itemId }) });
}

function deleteAs(user: string, query = '') {
  session.mockResolvedValueOnce({ user: { id: user } } as never);
  const req = new NextRequest(`http://localhost/api/items/${itemId}${query}`, {
    method: 'DELETE',
  });
  return DELETE(req, { params: Promise.resolve({ id: itemId }) });
}

/** The review dialog's Decline: a delete that expects a proposal (WIS-199). */
const declineAs = (user: string) => deleteAs(user, '?expectedStatus=proposed');

/**
 * Hold the next item write (the request under test's, after all its reads and
 * checks) while `meanwhile` runs to completion, then let it land.
 */
const whileItemWriteHeld = <T>(meanwhile: () => Promise<T>) =>
  holdFirstCall(Item, 'findOneAndUpdate', meanwhile);

const approvalsSentToAlice = () =>
  Notification.find({ user: alice, type: 'proposal_approved' }).lean();

// The co-owner's review, which lands first, and the owner's, which comes late.
const firstReview = {
  name: 'Blue Mug (large)',
  price: { value: 2500, currency: 'usd' },
  notes: 'The large one',
  status: 'available',
} as const;
const lateReview = { name: 'Blue Mug (small)', notes: 'The small one', status: 'draft' } as const;

describe("PATCH /api/items/[id] — an owner's approval racing a co-owner's review", () => {
  // regression: an owner's approval was decided on the item as first read (a
  // proposal) and then written on `{ _id }` alone. Two co-owners approving it
  // at once both got a 200, the second replaced the first's reviewed content
  // and status, and the proposer was told twice that it was approved.
  it('regression: the late approval gets a 409, the first stands, and the proposer is told once', async () => {
    const race = whileItemWriteHeld(() => patchAs(coOwner, firstReview));
    const late = await patchAs(owner, lateReview);

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({
      success: false,
      error: 'This proposal has already been reviewed',
    });

    const item = await Item.findById(itemId).lean();
    expect(item).toMatchObject({ ...firstReview, imageUrl: proposedImage });
    expect(item?.proposedBy).toBeNull();

    const approvals = await approvalsSentToAlice();
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ itemName: firstReview.name, actorUsername: null });
    expect(del).not.toHaveBeenCalled();
  });

  // regression: the late approval's `status` and `bookedBy: null` landed on an
  // item a member had booked since the first approval made it live, which
  // unassigned their booking.
  it('regression: a booking made after the first approval survives the late one', async () => {
    const race = whileItemWriteHeld(async () => {
      const approved = await patchAs(coOwner, firstReview);
      const booked = await patchAs(bob, { status: 'booked' });
      return [approved.status, booked.status];
    });
    const late = await patchAs(owner, { ...lateReview, status: 'available' });

    expect(race.held()).toBe(true);
    expect(race.outcome()).toEqual([200, 200]);
    expect(late.status).toBe(409);
    // Says nothing about the booking: the same answer as for the plain race.
    expect((await late.json()).error).toBe('This proposal has already been reviewed');

    const item = await Item.findById(itemId).lean();
    expect(item).toMatchObject({ name: firstReview.name, status: 'booked' });
    expect(item?.bookedBy?.toString()).toBe(bob);
    expect(await Reservation.countDocuments({ gifter: bob, item: itemId })).toBe(1);
    expect(await approvalsSentToAlice()).toHaveLength(1);
  });

  // regression: the late approval swapping in its own image freed the image the
  // first approval had already replaced, and left its own upload on the item.
  it('regression: a late approval with its own image frees nothing and keeps the first approval image', async () => {
    const coOwnersImage = `${HOST}/uploads/${coOwner}/mug-large.jpg`;
    const ownersImage = `${HOST}/uploads/${owner}/mug-small.jpg`;
    const race = whileItemWriteHeld(() =>
      patchAs(coOwner, { ...firstReview, imageUrl: coOwnersImage })
    );
    const late = await patchAs(owner, { ...lateReview, imageUrl: ownersImage });

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(late.status).toBe(409);
    expect((await Item.findById(itemId))?.imageUrl).toBe(coOwnersImage);
    // Freed by the approval that replaced it, and by nothing else.
    expect(del.mock.calls).toEqual([[proposedImage]]);
    expect(await approvalsSentToAlice()).toHaveLength(1);
  });

  it.each([
    ['a co-owner rejecting it', () => coOwner],
    ['its proposer withdrawing it', () => alice],
  ])(
    'an approval that lands after %s gets a 404, writes nothing and tells nobody',
    async (_, by) => {
      const race = whileItemWriteHeld(() => deleteAs(by()));
      const late = await patchAs(owner, lateReview);

      expect(race.held()).toBe(true);
      expect(race.outcome()?.status).toBe(200);
      expect(late.status).toBe(404);
      expect((await late.json()).error).toBe('Item not found');
      expect(await Item.countDocuments()).toBe(0);
      expect(await approvalsSentToAlice()).toHaveLength(0);
      // Only the delete freed anything: the proposal's image, once.
      expect(del.mock.calls).toEqual([[proposedImage]]);
    }
  );

  // Only an approval rests on the item still being a proposal. An owner's edit
  // that leaves its status alone is one they may make to a live item too, so it
  // lands on the approved item instead of being refused.
  it("an owner's edit that doesn't approve it still lands after a co-owner's approval", async () => {
    const race = whileItemWriteHeld(() => patchAs(coOwner, firstReview));
    const edit = await patchAs(owner, { notes: 'Dishwasher safe' });

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(edit.status).toBe(200);
    const item = await Item.findById(itemId).lean();
    expect(item).toMatchObject({
      name: firstReview.name,
      notes: 'Dishwasher safe',
      status: 'available',
    });
    expect(await approvalsSentToAlice()).toHaveLength(1);
  });
});

describe("PATCH /api/items/[id] — an owner's review with no race", () => {
  it('an approval lands while the item is still a proposal, and tells the proposer once', async () => {
    const res = await patchAs(owner, firstReview);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ name: firstReview.name, status: 'available' });
    expect(body.data.proposedBy).toBeUndefined();
    expect(await approvalsSentToAlice()).toHaveLength(1);
  });

  it("an edit that doesn't approve it leaves it Alice's proposal and tells nobody", async () => {
    const res = await patchAs(owner, { name: 'Blue Mug (large)' });

    expect(res.status).toBe(200);
    const item = await Item.findById(itemId);
    expect([item?.status, item?.name]).toEqual(['proposed', 'Blue Mug (large)']);
    expect(item?.proposedBy?.toString()).toBe(alice);
    expect(await approvalsSentToAlice()).toHaveLength(0);
  });
});

// The review dialog is a snapshot of the proposal as it opened, so its approve
// and Decline say they expect a proposal (WIS-199). Each case below is an owner
// whose dialog opened before a co-owner approved the proposal.
describe('/api/items/[id] — a review dialog that expects a proposal', () => {
  const REVIEWED = { success: false, error: 'This proposal has already been reviewed' };
  const stale = { ...lateReview, expectedStatus: 'proposed' } as const;

  // regression: the dialog's approve, sent once a co-owner's approval had
  // landed, read the item as live and took the owner's edit path: it answered
  // 200, replaced the co-owner's review with the dialog's form, and its status
  // change unassigned a member's booking made since.
  it('regression: an approve sent after a co-owner approved it gets a 409 and changes nothing', async () => {
    expect((await patchAs(coOwner, firstReview)).status).toBe(200);
    expect((await patchAs(bob, { status: 'booked' })).status).toBe(200);

    const late = await patchAs(owner, stale);

    expect(late.status).toBe(409);
    // The same answer as on an item nobody reserved: it says nothing of Bob's.
    expect(await late.json()).toEqual(REVIEWED);
    const item = await Item.findById(itemId).lean();
    expect(item).toMatchObject({ name: firstReview.name, notes: firstReview.notes });
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(bob);
    expect(await approvalsSentToAlice()).toHaveLength(1);
    expect(del).not.toHaveBeenCalled();
  });

  it('answers an unreserved approved item exactly as a reserved one', async () => {
    expect((await patchAs(coOwner, firstReview)).status).toBe(200);
    const late = await patchAs(owner, stale);
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual(REVIEWED);
  });

  it('a content-only save from the dialog is refused once the item is live', async () => {
    expect((await patchAs(coOwner, firstReview)).status).toBe(200);
    const late = await patchAs(owner, { notes: 'Stale notes', expectedStatus: 'proposed' });
    expect(late.status).toBe(409);
    expect((await Item.findById(itemId))?.notes).toBe(firstReview.notes);
  });

  // The write's own condition: the co-owner's approval lands after this
  // request's read, while its write is held.
  it('a content-only save from the dialog that loses to an approval at the write gets a 409', async () => {
    const race = whileItemWriteHeld(() => patchAs(coOwner, firstReview));
    const late = await patchAs(owner, { notes: 'Stale notes', expectedStatus: 'proposed' });

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual(REVIEWED);
    expect((await Item.findById(itemId))?.notes).toBe(firstReview.notes);
  });

  it('an approve that still finds a proposal lands as before', async () => {
    const res = await patchAs(owner, { ...firstReview, expectedStatus: 'proposed' });
    expect(res.status).toBe(200);
    expect((await Item.findById(itemId))?.status).toBe('available');
    expect(await approvalsSentToAlice()).toHaveLength(1);
  });

  it('refuses any other expected status, and an expectation with nothing to change', async () => {
    const otherExpectation = await patchAs(owner, { ...firstReview, expectedStatus: 'available' });
    expect(otherExpectation.status).toBe(400);
    expect((await patchAs(owner, { expectedStatus: 'proposed' })).status).toBe(400);
    expect((await deleteAs(owner, '?expectedStatus=available')).status).toBe(400);
    expect(await Item.countDocuments({ status: 'proposed' })).toBe(1);
  });

  // regression: Decline (an owner's delete) went through on whatever the item
  // was by then, so a dialog left open over a co-owner's approval deleted the
  // live item, reserved or not, which the owner can't see.
  it('regression: a Decline sent after a co-owner approved it gets a 409 and deletes nothing', async () => {
    expect((await patchAs(coOwner, firstReview)).status).toBe(200);
    expect((await patchAs(bob, { status: 'booked' })).status).toBe(200);

    const late = await declineAs(owner);

    expect(late.status).toBe(409);
    expect(await late.json()).toEqual(REVIEWED);
    const item = await Item.findById(itemId).lean();
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(bob);
    expect(await Reservation.countDocuments({ gifter: bob, item: itemId })).toBe(1);
    expect(del).not.toHaveBeenCalled();
  });

  it('a Decline that loses to an approval at the delete gets a 409 and deletes nothing', async () => {
    const race = holdFirstCall(Item, 'findOneAndDelete', () => patchAs(coOwner, firstReview));
    const late = await declineAs(owner);

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual(REVIEWED);
    expect((await Item.findById(itemId))?.status).toBe('available');
    expect(del).not.toHaveBeenCalled();
  });

  it('a Decline that still finds a proposal deletes it', async () => {
    const res = await declineAs(owner);
    expect(res.status).toBe(200);
    expect(await Item.countDocuments()).toBe(0);
    expect(del.mock.calls).toEqual([[proposedImage]]);
  });

  it('a Decline of a proposal already deleted is a 404, as any owner delete is', async () => {
    expect((await deleteAs(coOwner)).status).toBe(200);
    expect((await declineAs(owner)).status).toBe(404);
  });

  // Only the dialog's requests carry the expectation: an owner's plain delete
  // of a live item goes on as before.
  it("an owner's plain delete of the approved item still deletes it", async () => {
    expect((await patchAs(coOwner, firstReview)).status).toBe(200);
    expect((await deleteAs(owner)).status).toBe(200);
    expect(await Item.countDocuments()).toBe(0);
  });

  // The expectation is checked only once the caller may make the request, so
  // it never answers someone who couldn't.
  it('someone with no access to the list gets the 403, not the 409', async () => {
    const eve = (await User.create({ email: 'e@x.com', username: 'eve' }))._id.toString();
    await Wishlist.updateOne({}, { visibility: 'private' });
    expect((await patchAs(coOwner, firstReview)).status).toBe(200);

    expect((await patchAs(eve, stale)).status).toBe(403);
    expect((await declineAs(eve)).status).toBe(403);
  });
});
