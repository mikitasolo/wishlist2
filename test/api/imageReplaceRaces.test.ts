import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// An image field (User.image, Wishlist.bannerUrl, Item.imageUrl) frees the
// image an edit replaces. Each race below holds one edit's write, after all its
// reads and checks, while another edit of the same image runs to completion,
// then lets it land: the order a real race only hits by luck. Whatever the
// order, every image that was replaced is freed exactly once, and the one left
// on the record never is.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
// A store that records deletions instead of performing them, so a test can tell
// which images were freed, and how often.
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  copy: vi.fn(),
  del: (...a: unknown[]) => del(...a),
  list: vi.fn(),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { PATCH as PATCH_ME } from '@/app/api/users/me/route';
import { PATCH as PATCH_WISHLIST, DELETE as DELETE_WISHLIST } from '@/app/api/wishlists/[id]/route';
import { PATCH as PATCH_ITEM, DELETE as DELETE_ITEM } from '@/app/api/items/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

// A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
// store's public host is derived from it.
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const blobOf = (userId: string, name: string) => `${HOST}/uploads/${userId}/${name}`;
const EXTERNAL = 'https://images.example.com/photo.jpg';
const OTHER_EXTERNAL = 'https://images.example.com/another.jpg';

let alice: string;
let bob: string;
let carol: string; // a member of the list, who proposes items
let wishlistId: string;
let itemId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  del.mockClear();
  const [a, b, c] = await User.create([
    { email: 'a@x.com', username: 'alice' },
    { email: 'b@x.com', username: 'bob' },
    { email: 'c@x.com', username: 'carol' },
  ]);
  [alice, bob, carol] = [a, b, c].map((u) => u._id.toString());
  const wl = await Wishlist.create({
    name: 'Birthday',
    owners: [a._id, b._id],
    visibility: 'everyone',
  });
  wishlistId = wl._id.toString();
  await WishlistMember.create({ wishlist: wl._id, user: c._id });
  itemId = (await Item.create({ wishlist: wl._id, name: 'Blue Mug' }))._id.toString();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// `auth()` is the first thing each handler calls, synchronously on invocation,
// so a one-shot session is consumed by this call even while another is in flight.
function request(user: string, path: string, method: string, body?: unknown) {
  session.mockResolvedValueOnce({ user: { id: user } } as never);
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const patchItem = (user: string, body: unknown) =>
  PATCH_ITEM(request(user, `/api/items/${itemId}`, 'PATCH', body), {
    params: Promise.resolve({ id: itemId }),
  });

type Image = string | null;

/** One image field, and the route that edits it. */
interface Field {
  name: string;
  /** The model whose `findOneAndUpdate` is the edit's write. */
  model: object;
  /** Who edits it: two co-owners, or one user in two tabs. */
  editors: () => [string, string];
  /** The field's name in the request and the reply. */
  key: 'image' | 'bannerUrl' | 'imageUrl';
  setImage: (image: Image) => Promise<unknown>;
  stored: () => Promise<Image>;
  /** An edit that sets the image to `image` (null clears it), plus `also`. */
  edit: (user: string, image: Image, also?: Record<string, unknown>) => Promise<Response>;
  /** Another field the same edit can change, and its value afterwards. */
  other: { change: Record<string, unknown>; stored: () => Promise<unknown>; value: unknown };
  /** Delete the record, where its route can. */
  remove?: (user: string) => Promise<Response>;
}

const fields: Field[] = [
  {
    name: 'User.image — PATCH /api/users/me',
    model: User,
    editors: () => [alice, alice],
    key: 'image',
    setImage: (image) => User.updateOne({ _id: alice }, { $set: { image } }),
    stored: async () => (await User.findById(alice).lean())?.image ?? null,
    edit: (user, image, also = {}) =>
      PATCH_ME(request(user, '/api/users/me', 'PATCH', { image, ...also })),
    other: {
      change: { bio: 'Hi there' },
      stored: async () => (await User.findById(alice).lean())?.bio,
      value: 'Hi there',
    },
  },
  {
    name: 'Wishlist.bannerUrl — PATCH /api/wishlists/[id]',
    model: Wishlist,
    editors: () => [alice, bob],
    key: 'bannerUrl',
    setImage: (bannerUrl) => Wishlist.updateOne({ _id: wishlistId }, { $set: { bannerUrl } }),
    stored: async () => (await Wishlist.findById(wishlistId).lean())?.bannerUrl ?? null,
    edit: (user, bannerUrl, also = {}) =>
      PATCH_WISHLIST(
        request(user, `/api/wishlists/${wishlistId}`, 'PATCH', { bannerUrl, ...also }),
        { params: Promise.resolve({ id: wishlistId }) }
      ),
    other: {
      change: { description: 'Updated' },
      stored: async () => (await Wishlist.findById(wishlistId).lean())?.description,
      value: 'Updated',
    },
    remove: (user) =>
      DELETE_WISHLIST(request(user, `/api/wishlists/${wishlistId}`, 'DELETE'), {
        params: Promise.resolve({ id: wishlistId }),
      }),
  },
  {
    name: 'Item.imageUrl — PATCH /api/items/[id]',
    model: Item,
    editors: () => [alice, bob],
    key: 'imageUrl',
    setImage: (imageUrl) => Item.updateOne({ _id: itemId }, { $set: { imageUrl } }),
    stored: async () => (await Item.findById(itemId).lean())?.imageUrl ?? null,
    edit: (user, imageUrl, also = {}) => patchItem(user, { imageUrl, ...also }),
    other: {
      change: { notes: 'Updated' },
      stored: async () => (await Item.findById(itemId).lean())?.notes,
      value: 'Updated',
    },
    remove: (user) =>
      DELETE_ITEM(request(user, `/api/items/${itemId}`, 'DELETE'), {
        params: Promise.resolve({ id: itemId }),
      }),
  },
];

describe.each(fields)('$name', (field) => {
  const freed = () => del.mock.calls;
  let original: string;
  let late: string; // the editor whose write is held
  let early: string; // the editor whose edit lands while it's held
  let latesImage: string;
  let earlysImage: string;

  beforeEach(async () => {
    [late, early] = field.editors();
    original = blobOf(late, 'original.jpg');
    latesImage = blobOf(late, 'late.jpg');
    earlysImage = blobOf(early, 'early.jpg');
    await field.setImage(original);
  });

  /** Hold the next write while `meanwhile` runs to completion, then let it land. */
  const whileWriteHeld = <T>(meanwhile: () => Promise<T>) =>
    holdFirstCall(field.model, 'findOneAndUpdate', meanwhile);

  describe('two edits at once', () => {
    // regression: the edit freed the image it read at the start of the request,
    // not the one its write replaced. Two edits replacing the same image both
    // read the original: both freed it, and the image the first one put in its
    // place was replaced without being freed (orphaned in storage, and on its
    // uploader's quota).
    it('regression: two replacements free the original and the first replacement, once each', async () => {
      const race = whileWriteHeld(() => field.edit(early, earlysImage));
      const res = await field.edit(late, latesImage);

      expect(race.held()).toBe(true);
      expect(race.outcome()?.status).toBe(200);
      expect(res.status).toBe(200);
      expect((await res.json()).data[field.key]).toBe(latesImage);
      expect(await field.stored()).toBe(latesImage);
      expect(freed()).toEqual([[original], [earlysImage]]);
    });

    // regression: same race, with the late edit clearing the image.
    it('regression: clearing it as another edit replaces it frees the replacement too', async () => {
      const race = whileWriteHeld(() => field.edit(early, earlysImage));
      const res = await field.edit(late, null);

      expect(race.held()).toBe(true);
      expect(res.status).toBe(200);
      expect(await field.stored()).toBeNull();
      expect(freed()).toEqual([[original], [earlysImage]]);
    });

    // regression: an edit that sent back the image it had read (the item edit
    // form sends it with every save) wrote it back over a replacement that
    // landed in between. The record then pointed at the image the replacement
    // had already freed, and the replacement's own upload was orphaned.
    it("regression: an edit sending back the image it read doesn't undo a replacement landing meanwhile", async () => {
      const race = whileWriteHeld(() => field.edit(early, earlysImage));
      const res = await field.edit(late, original, field.other.change);

      expect(race.held()).toBe(true);
      expect(res.status).toBe(200);
      expect((await res.json()).data[field.key]).toBe(earlysImage);
      expect(await field.stored()).toBe(earlysImage);
      expect(await field.other.stored()).toBe(field.other.value);
      // Freed by the replacement, and by nothing else.
      expect(freed()).toEqual([[original]]);
    });

    // regression: same race from an external image. The late edit "freed" the
    // external URL it had read, which is never deleted, so the first edit's
    // upload it replaced was left in storage.
    it('regression: frees the upload an edit replaced, but never an external image', async () => {
      await field.setImage(EXTERNAL);
      const race = whileWriteHeld(() => field.edit(early, earlysImage));
      const res = await field.edit(late, OTHER_EXTERNAL);

      expect(race.held()).toBe(true);
      expect(res.status).toBe(200);
      expect(await field.stored()).toBe(OTHER_EXTERNAL);
      // Only the upload the late edit replaced; neither external URL.
      expect(freed()).toEqual([[earlysImage]]);
    });

    if (field.remove) {
      const remove = field.remove;
      // The write landed, so the image it replaced is freed. The record it was
      // answered with is gone, so it gets the same 404 as any missing one.
      it('an edit whose record is deleted just after it lands frees what it replaced and answers 404', async () => {
        const race = holdFirstCall(field.model, 'findOneAndUpdate', () => remove(early), {
          after: true,
        });
        const res = await field.edit(late, latesImage);

        expect(race.held()).toBe(true);
        expect(race.outcome()?.status).toBe(200);
        expect(res.status).toBe(404);
        // The delete freed the image on the record then (the edit's), and the
        // edit the one it had replaced.
        expect(freed()).toEqual([[latesImage], [original]]);
      });
    }
  });

  describe('one edit', () => {
    it('replacing it frees the old image once', async () => {
      const res = await field.edit(late, latesImage);

      expect(res.status).toBe(200);
      expect((await res.json()).data[field.key]).toBe(latesImage);
      expect(await field.stored()).toBe(latesImage);
      expect(freed()).toEqual([[original]]);
    });

    it('clearing it frees the old image once', async () => {
      const res = await field.edit(late, null);

      expect(res.status).toBe(200);
      expect(await field.stored()).toBeNull();
      expect(freed()).toEqual([[original]]);
    });

    it('sending the image it already has keeps it and frees nothing', async () => {
      const res = await field.edit(late, original, field.other.change);

      expect(res.status).toBe(200);
      expect((await res.json()).data[field.key]).toBe(original);
      expect(await field.stored()).toBe(original);
      expect(await field.other.stored()).toBe(field.other.value);
      expect(freed()).toEqual([]);
    });

    it('never deletes an external image it replaces or clears', async () => {
      await field.setImage(EXTERNAL);
      expect((await field.edit(late, OTHER_EXTERNAL)).status).toBe(200);
      expect((await field.edit(late, null)).status).toBe(200);

      expect(await field.stored()).toBeNull();
      expect(freed()).toEqual([]);
    });
  });
});

describe("PATCH /api/items/[id] — a proposal's image, edited by an owner and its proposer at once", () => {
  let proposed: string; // the image Carol proposed the item with
  let carolsNew: string;

  beforeEach(async () => {
    proposed = blobOf(carol, 'proposal.jpg');
    carolsNew = blobOf(carol, 'proposal-2.jpg');
    await Item.updateOne(
      { _id: itemId },
      { $set: { status: 'proposed', proposedBy: carol, imageUrl: proposed } }
    );
  });

  // regression: the review form sends the proposal's image back with the
  // approval. Carol replacing it (and freeing it) between the owner's read and
  // write, the approval put the freed image back, so the item went live
  // pointing at a deleted blob, and Carol's new upload was orphaned.
  it("regression: an approval keeping the image doesn't put back the one the proposer just replaced", async () => {
    const race = holdFirstCall(Item, 'findOneAndUpdate', () =>
      patchItem(carol, { imageUrl: carolsNew })
    );
    const approval = await patchItem(alice, {
      name: 'Blue Mug',
      imageUrl: proposed,
      status: 'available',
    });

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(approval.status).toBe(200);
    const item = await Item.findById(itemId).lean();
    expect(item).toMatchObject({ status: 'available', imageUrl: carolsNew, proposedBy: null });
    // Freed by Carol's edit, which replaced it, and by nothing else.
    expect(del.mock.calls).toEqual([[proposed]]);
    expect(await Notification.countDocuments({ user: carol, type: 'proposal_approved' })).toBe(1);
  });

  // regression: Carol's edit, landing after an owner had swapped the image of
  // her still-pending proposal, freed the image she had read (which the owner's
  // edit had already freed) and orphaned the owner's.
  it("regression: the proposer's edit landing after an owner's swap frees the owner's image, once", async () => {
    const ownersImage = blobOf(alice, 'mug.jpg');
    const race = holdFirstCall(Item, 'findOneAndUpdate', () =>
      patchItem(alice, { imageUrl: ownersImage })
    );
    const edit = await patchItem(carol, { imageUrl: carolsNew });

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    // Still her proposal when it landed, so her edit stands.
    expect(edit.status).toBe(200);
    expect((await Item.findById(itemId).lean())?.imageUrl).toBe(carolsNew);
    expect(del.mock.calls).toEqual([[proposed], [ownersImage]]);
  });
});
