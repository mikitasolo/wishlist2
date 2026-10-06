import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// "Start a new list from this one" (WIS-325): GET / POST
// /api/wishlists/[id]/copy. These pin who may copy a list, that the picker and
// the copy say nothing about bookings, that a copy's images are its own blobs,
// that a retried request makes one list, and that a copy that can't stand is
// taken back whole, images included.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
// A store that records what it's asked to do instead of doing it.
const copy = vi.fn();
const del = vi.fn().mockResolvedValue(undefined);
const head = vi.fn();
const list = vi.fn();
vi.mock('@vercel/blob', () => ({
  copy: (...a: unknown[]) => copy(...a),
  del: (...a: unknown[]) => del(...a),
  head: (...a: unknown[]) => head(...a),
  list: (...a: unknown[]) => list(...a),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { GET as READ_COPY, POST as COPY } from '@/app/api/wishlists/[id]/copy/route';
import { GET as LIST_ITEMS } from '@/app/api/wishlists/[id]/items/route';
import { USER_UPLOAD_QUOTA_BYTES } from '@/lib/utils/blob';
import {
  COPY_IN_PROGRESS_ERROR,
  COPY_STALE_MS,
  COPY_LIST_IMAGES_FAILED_NOTICE,
  COPY_LIST_IMAGES_QUOTA_NOTICE,
} from '@/lib/utils/wishlistCopy';
import { scopedIdempotencyKey } from '@/lib/utils/itemIdempotency';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistCopy from '@/models/WishlistCopy';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import ShareLink from '@/models/ShareLink';
import WishlistInvite from '@/models/WishlistInvite';

vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn(),
}));

const session = vi.mocked(auth);

const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const EXTERNAL = 'https://images.example.com/photo.jpg';
const blobOf = (userId: string, name = 'image-abc.jpg') => `${HOST}/uploads/${userId}/${name}`;

let alice: string; // owns the source list, starts the copy
let bob: string; // co-owns it
let carol: string; // a member of it
let erin: string; // nothing to do with it
let source: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

let copies = 0;
beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  copy.mockReset();
  del.mockClear();
  head.mockReset();
  list.mockReset();
  copies = 0;
  // Every copy lands at a new path, as the SDK's random suffix makes it.
  copy.mockImplementation(async (_from: string, to: string) => ({
    url: `${HOST}/${to.replace(/(\.[a-z]+)$/, `-c${++copies}$1`)}`,
  }));
  head.mockResolvedValue({ size: 1000 });
  list.mockResolvedValue({ blobs: [], cursor: undefined });

  const user = async (username: string) =>
    (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  alice = await user('alice');
  bob = await user('bob');
  carol = await user('carol');
  erin = await user('erin');
  source = (
    await Wishlist.create({
      name: 'Birthday 2026',
      slug: 'birthday-2026',
      description: 'Turning 30',
      owners: [alice, bob],
      featuredBy: [alice],
      visibility: 'friends',
      currency: 'EUR',
      bannerUrl: blobOf(bob, 'cover.jpg'),
      occasion: { kind: 'birthday', date: '2000-03-14', recurrence: 'yearly' },
    })
  )._id.toString();
  await WishlistMember.create({ wishlist: source, user: carol });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  __setRateLimiters(null);
});

function as(userId: string | null) {
  session.mockResolvedValue((userId ? { user: { id: userId } } : null) as never);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const readCopy = (id = source) =>
  READ_COPY(new NextRequest(`http://localhost/api/wishlists/${id}/copy`), params(id));

const KEY = 'copy-key-0123456789abcdef';

function postCopy(body: Record<string, unknown>, { id = source, key = KEY as string | null } = {}) {
  return COPY(
    new NextRequest(`http://localhost/api/wishlists/${id}/copy`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: JSON.stringify({ name: 'Birthday 2027', visibility: 'friends', ...body }),
    }),
    params(id)
  );
}

let made = 0;
async function makeItem(fields: Record<string, unknown> = {}, wishlist = source) {
  // Spaced out, so their order is the order they were made in.
  return Item.create({
    wishlist,
    name: `Item ${++made}`,
    imageUrl: blobOf(alice, `item-${made}.jpg`),
    price: { value: 2500, currency: 'EUR' },
    link: 'https://shop.example.com/mug',
    notes: 'The dark blue one',
    mostWanted: true,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, made)),
    ...fields,
  });
}

/** The lists alice owns besides the source. */
const newLists = () => Wishlist.find({ _id: { $ne: source } }).lean();

describe('GET /api/wishlists/[id]/copy — what the picker offers', () => {
  it('offers the list’s settings and its items minus received ones and pending proposals', async () => {
    const draft = await makeItem({ status: 'draft' });
    const available = await makeItem();
    await makeItem({ status: 'completed' });
    await makeItem({ status: 'proposed', proposedBy: carol });
    as(alice);

    const res = await readCopy();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const { data } = await res.json();
    // Only what the form starts on; the rest is read again by the copy itself.
    expect(Object.keys(data).sort()).toEqual([
      'archived',
      'items',
      'name',
      'occasion',
      'visibility',
    ]);
    expect(data).toMatchObject({
      name: 'Birthday 2026',
      visibility: 'friends',
      occasion: { kind: 'birthday', date: '2000-03-14', recurrence: 'yearly' },
      archived: false,
    });
    // Newest first, as the list shows them.
    expect(data.items.map((i: { _id: string }) => i._id)).toEqual([
      available._id.toString(),
      draft._id.toString(),
    ]);
    expect(data.items[1]).toEqual({
      _id: draft._id.toString(),
      name: draft.name,
      imageUrl: draft.imageUrl,
      mostWanted: true,
      draft: true,
    });
  });

  it('leaves a one-off occasion for the owner to pick', async () => {
    await Wishlist.updateOne(
      { _id: source },
      { occasion: { kind: 'wedding', date: '2026-06-01', recurrence: null } }
    );
    as(alice);

    const { data } = await (await readCopy()).json();

    expect(data.occasion).toBeNull();
  });

  it('shows a reserved item exactly as an unreserved one: same fields, same place, no status', async () => {
    // Two lists alike but for one item being reserved: the answers must be the same.
    const answers = [];
    for (const reserved of [false, true]) {
      await Item.deleteMany({});
      await Reservation.deleteMany({});
      const first = await makeItem({ name: 'A', imageUrl: EXTERNAL });
      const second = await makeItem({
        name: 'B',
        imageUrl: EXTERNAL,
        ...(reserved ? { status: 'booked', bookedBy: carol } : {}),
      });
      await makeItem({ name: 'C', imageUrl: EXTERNAL });
      if (reserved) {
        await Reservation.create({
          gifter: carol,
          item: second._id,
          wishlist: source,
          owner: alice,
          itemName: 'B',
          wishlistName: 'Birthday 2026',
        });
      }
      as(alice);
      const { data } = await (await readCopy()).json();
      const ids = new Map([first, second].map((i, n) => [i._id.toString(), `#${n}`]));
      answers.push(JSON.stringify(data.items, (k, v) => (k === '_id' ? (ids.get(v) ?? '#2') : v)));
      expect(JSON.stringify(data)).not.toMatch(/booked|bookedBy|proposedBy|status|reserv/i);
    }
    expect(answers[1]).toBe(answers[0]);
  });

  it('is offered on an archived list to its owners', async () => {
    await Wishlist.updateOne({ _id: source }, { archived: true });
    as(alice);

    const res = await readCopy();

    expect(res.status).toBe(200);
    expect((await res.json()).data.archived).toBe(true);
  });

  it('refuses a member and a stranger (403), a signed-out caller (401), a missing list (404)', async () => {
    as(carol);
    expect((await readCopy()).status).toBe(403);
    as(erin);
    expect((await readCopy()).status).toBe(403);
    as(null);
    expect((await readCopy()).status).toBe(401);
    as(alice);
    expect((await readCopy('64b000000000000000000000')).status).toBe(404);
  });

  it('answers a non-owner of an archived list as for a missing one', async () => {
    await Wishlist.updateOne({ _id: source }, { archived: true });
    as(carol);
    const res = await readCopy();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Wishlist not found' });
  });
});

describe('POST /api/wishlists/[id]/copy — the new list', () => {
  it('copies the settings, with only the caller as its owner, and nothing about people or links', async () => {
    await ShareLink.create({ wishlist: source, token: 'S'.repeat(22), level: 'join' });
    await WishlistInvite.create({ wishlist: source, invitedBy: alice, invitedUser: erin });
    as(alice);

    const res = await postCopy({
      occasion: { kind: 'birthday', date: '2000-03-14', recurrence: 'yearly' },
    });

    expect(res.status).toBe(201);
    const { data, notice } = await res.json();
    expect(notice).toBeUndefined();
    expect(data).toMatchObject({
      name: 'Birthday 2027',
      description: 'Turning 30',
      visibility: 'friends',
      currency: 'EUR',
      owners: [alice],
      featured: false,
      archived: false,
      occasion: { kind: 'birthday', date: '2000-03-14', recurrence: 'yearly' },
    });
    expect(data.slug).toMatch(/^birthday-2027/);
    // The cover is a new blob of alice's own, never bob's.
    expect(data.bannerUrl).toMatch(new RegExp(`^${HOST}/uploads/${alice}/image-c\\d+\\.jpg$`));
    expect(copy).toHaveBeenCalledWith(
      blobOf(bob, 'cover.jpg'),
      `uploads/${alice}/image.jpg`,
      expect.anything()
    );

    const [made] = await newLists();
    expect(made.featuredBy).toEqual([]);
    expect(await WishlistMember.countDocuments({ wishlist: made._id })).toBe(0);
    expect(await WishlistInvite.countDocuments({ wishlist: made._id })).toBe(0);
    expect(await ShareLink.countDocuments({ wishlist: made._id })).toBe(0);
    // The source is as it was.
    const src = await Wishlist.findById(source).lean();
    expect(src!.owners.map(String)).toEqual([alice, bob]);
    expect(src!.archived).toBe(false);
  });

  it('keeps an external cover as it is', async () => {
    await Wishlist.updateOne({ _id: source }, { bannerUrl: EXTERNAL });
    as(alice);

    const { data } = await (await postCopy({})).json();

    expect(data.bannerUrl).toBe(EXTERNAL);
    expect(copy).not.toHaveBeenCalled();
  });

  it('copies the picked items as new, unreserved items with their own images', async () => {
    const draft = await makeItem({ status: 'draft', name: 'Draft', mostWanted: false });
    const booked = await makeItem({ status: 'booked', bookedBy: carol, name: 'Booked' });
    await Reservation.create({
      gifter: carol,
      item: booked._id,
      wishlist: source,
      owner: alice,
      itemName: 'Booked',
      wishlistName: 'Birthday 2026',
    });
    const external = await makeItem({ name: 'External', imageUrl: EXTERNAL, price: null });
    const left = await makeItem({ name: 'Not picked' });
    as(alice);

    const res = await postCopy({
      itemIds: [booked._id, draft._id, external._id, draft._id].map(String),
    });

    expect(res.status).toBe(201);
    const { data } = await res.json();
    const copied = await Item.find({ wishlist: data._id }).sort({ createdAt: 1 }).lean();
    // In the source's order, each once.
    expect(copied.map((i) => i.name)).toEqual(['Draft', 'Booked', 'External']);
    expect(copied.map((i) => i.status)).toEqual(['draft', 'available', 'available']);
    for (const item of copied) {
      expect(item.bookedBy ?? null).toBeNull();
      expect(item.proposedBy ?? null).toBeNull();
    }
    expect(copied[1]).toMatchObject({
      price: { value: 2500, currency: 'EUR' },
      link: 'https://shop.example.com/mug',
      notes: 'The dark blue one',
      mostWanted: true,
    });
    expect(copied[2].imageUrl).toBe(EXTERNAL);
    // Our blobs are copied into alice's uploads, one each.
    const ownImages = [copied[0].imageUrl, copied[1].imageUrl, data.bannerUrl];
    for (const url of ownImages) expect(url).toMatch(new RegExp(`^${HOST}/uploads/${alice}/`));
    expect(new Set(ownImages).size).toBe(3);
    expect(copy).toHaveBeenCalledTimes(3);

    // The source and its reservation are untouched.
    const src = await Item.find({ wishlist: source }).lean();
    expect(src).toHaveLength(4);
    expect((await Item.findById(booked._id).lean())!).toMatchObject({ status: 'booked' });
    expect(await Reservation.countDocuments({ item: booked._id })).toBe(1);
    expect((await Item.findById(left._id).lean())!.imageUrl).toBe(left.imageUrl);

    // And the new list's owner reads them as on any list of theirs, newest first.
    const listed = await LIST_ITEMS(
      new NextRequest(`http://localhost/api/wishlists/${data._id}/items`),
      params(data._id)
    );
    const { data: items } = await listed.json();
    expect(items.map((i: { name: string }) => i.name)).toEqual(['External', 'Booked', 'Draft']);
  });

  it('gives two items sharing one source image a copy each', async () => {
    const a = await makeItem({ imageUrl: blobOf(alice, 'same.jpg') });
    const b = await makeItem({ imageUrl: blobOf(alice, 'same.jpg') });
    as(alice);

    const { data } = await (await postCopy({ itemIds: [a._id, b._id].map(String) })).json();

    const copied = await Item.find({ wishlist: data._id }).lean();
    expect(copied[0].imageUrl).not.toBe(copied[1].imageUrl);
  });

  it('leaves out an item received, a pending proposal, and one from another list', async () => {
    const received = await makeItem({ status: 'completed' });
    const proposal = await makeItem({ status: 'proposed', proposedBy: carol });
    const other = (
      await Wishlist.create({ name: 'Other', owners: [erin], visibility: 'everyone' })
    )._id.toString();
    const foreign = await makeItem({}, other);
    as(alice);

    const res = await postCopy({ itemIds: [received._id, proposal._id, foreign._id].map(String) });

    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(await Item.countDocuments({ wishlist: data._id })).toBe(0);
    // Only the cover was copied: nothing of the items left out.
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('makes the list without an image that wouldn’t fit the quota, and says so', async () => {
    const item = await makeItem();
    list.mockResolvedValue({ blobs: [{ size: USER_UPLOAD_QUOTA_BYTES - 500 }], cursor: undefined });
    as(alice);

    const res = await postCopy({ itemIds: [String(item._id)] });

    expect(res.status).toBe(201);
    const { data, notice } = await res.json();
    expect(notice).toBe(COPY_LIST_IMAGES_QUOTA_NOTICE);
    expect(data.bannerUrl).toBeNull();
    expect((await Item.findOne({ wishlist: data._id }).lean())!.imageUrl).toBeUndefined();
  });

  // regression (review): each image's copy checked the quota for itself, so
  // copies running together could all pass it and go over between them.
  it('copies images together within the quota, reading the uploads folder once', async () => {
    const a = await makeItem();
    const b = await makeItem();
    // Room for one 1000-byte image, not two.
    list.mockResolvedValue({
      blobs: [{ size: USER_UPLOAD_QUOTA_BYTES - 1500 }],
      cursor: undefined,
    });
    as(alice);

    const res = await postCopy({ itemIds: [a, b].map((i) => String(i._id)) });

    expect(res.status).toBe(201);
    expect((await res.json()).notice).toBe(COPY_LIST_IMAGES_QUOTA_NOTICE);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('makes the list without an image whose copy failed, and says so', async () => {
    copy.mockRejectedValue(new Error('store unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    as(alice);

    const res = await postCopy({});

    expect(res.status).toBe(201);
    const { data, notice } = await res.json();
    expect(notice).toBe(COPY_LIST_IMAGES_FAILED_NOTICE);
    expect(data.bannerUrl).toBeNull();
  });

  it('validates the name as making a list does, and copies nothing for a refused request', async () => {
    const item = await makeItem();
    as(alice);

    const res = await postCopy({ name: '   ', itemIds: [String(item._id)] });

    expect(res.status).toBe(400);
    expect(await newLists()).toHaveLength(0);
    expect(copy).not.toHaveBeenCalled();
  });

  it('refuses more than 100 picked items', async () => {
    as(alice);
    const ids = Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(24, '0'));
    expect((await postCopy({ itemIds: ids })).status).toBe(400);
  });

  it('requires an Idempotency-Key', async () => {
    as(alice);
    expect((await postCopy({}, { key: null })).status).toBe(400);
    expect((await postCopy({}, { key: 'bad key!' })).status).toBe(400);
    expect(await newLists()).toHaveLength(0);
  });

  it('is limited as making a list is, with the new-account tier', async () => {
    const denyAll: RateLimiter = {
      async limit() {
        return { success: false, reset: Date.now() + 60_000, limit: 20, remaining: 0 };
      },
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    session.mockResolvedValue({ user: { id: alice, newAccount: true } } as never);
    // Both its own budget and the one every new list spends.
    for (const name of ['listCopy:new', 'content:new'] as const) {
      __setRateLimiters({ [name]: denyAll });
      expect((await postCopy({})).status).toBe(429);
      expect(await newLists()).toHaveLength(0);
    }
  });
});

describe('POST /api/wishlists/[id]/copy — who may copy', () => {
  it('lets an owner copy their archived list', async () => {
    await Wishlist.updateOne({ _id: source }, { archived: true });
    as(alice);

    const res = await postCopy({});

    expect(res.status).toBe(201);
    expect((await res.json()).data.archived).toBe(false);
  });

  it('refuses a member and a stranger, and makes nothing', async () => {
    const item = await makeItem();
    for (const who of [carol, erin]) {
      as(who);
      expect((await postCopy({ itemIds: [String(item._id)] })).status).toBe(403);
    }
    expect(await newLists()).toHaveLength(0);
    expect(copy).not.toHaveBeenCalled();
  });

  it('answers a non-owner of an archived list as for a missing one, and a signed-out caller 401', async () => {
    await Wishlist.updateOne({ _id: source }, { archived: true });
    as(carol);
    const res = await postCopy({});
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Wishlist not found' });
    as(null);
    expect((await postCopy({})).status).toBe(401);
    expect(await newLists()).toHaveLength(0);
  });

  // The copy is checked against the caller's ownership as read at the start;
  // a co-owner taking them off meanwhile must not leave them a copy.
  it('takes the copy back, images included, from an owner removed while it was made', async () => {
    const item = await makeItem();
    holdFirstCall(
      Item,
      'insertMany',
      () => Wishlist.updateOne({ _id: source }, { $pull: { owners: alice } }),
      { after: true }
    );
    as(alice);

    const res = await postCopy({ itemIds: [String(item._id)] });

    expect(res.status).toBe(403);
    expect(await newLists()).toHaveLength(0);
    expect(await Item.countDocuments({ wishlist: { $ne: source } })).toBe(0);
    const copiedUrls = (await Promise.all(copy.mock.results.map((r) => r.value))).map(
      (c: { url: string }) => c.url
    );
    expect(copiedUrls).toHaveLength(2);
    for (const url of copiedUrls) expect(del).toHaveBeenCalledWith(url);
  });
});

describe('POST /api/wishlists/[id]/copy — once only, and whole or not at all', () => {
  it('answers a retry with the list the first attempt made', async () => {
    const item = await makeItem();
    as(alice);

    const first = await postCopy({ itemIds: [String(item._id)] });
    const second = await postCopy({ itemIds: [String(item._id)] });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await second.json()).data._id).toBe((await first.json()).data._id);
    expect(await newLists()).toHaveLength(1);
    expect(await Item.countDocuments({ wishlist: { $ne: source } })).toBe(1);
    // The retry copied no images.
    expect(copy).toHaveBeenCalledTimes(2);
  });

  it('never answers another account’s list for the same key', async () => {
    as(alice);
    const first = await (await postCopy({})).json();
    as(bob);
    const second = await postCopy({});

    expect(second.status).toBe(201);
    expect((await second.json()).data._id).not.toBe(first.data._id);
  });

  it('makes one list when two attempts race, and the loser copies nothing', async () => {
    as(alice);
    let racer: Response | undefined;
    holdFirstCall(WishlistCopy, 'create', async () => {
      racer = await postCopy({});
    });

    const res = await postCopy({});

    expect(res.status).toBe(200);
    expect(racer!.status).toBe(201);
    expect((await res.json()).data._id).toBe((await racer!.json()).data._id);
    expect(await newLists()).toHaveLength(1);
    // The key is claimed before any image is copied: only the winner's cover.
    expect(copy).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
  });

  // regression (review): a retry while the first attempt was still copying was
  // handed a half-made list, and the list was readable everywhere meanwhile.
  it('tells a retry to wait, and shows no list anywhere, while the first attempt is making it', async () => {
    const item = await makeItem();
    as(alice);
    let racer: Response | undefined;
    let listsMeanwhile = -1;
    holdFirstCall(Item, 'insertMany', async () => {
      racer = await postCopy({ itemIds: [String(item._id)] });
      listsMeanwhile = (await newLists()).length;
    });

    const res = await postCopy({ itemIds: [String(item._id)] });

    expect(racer!.status).toBe(409);
    expect(await racer!.json()).toEqual({ success: false, error: COPY_IN_PROGRESS_ERROR });
    // No list exists until it's finished: nothing can read, count or share it.
    expect(listsMeanwhile).toBe(0);
    expect(res.status).toBe(201);
    expect(await newLists()).toHaveLength(1);
    expect(copy).toHaveBeenCalledTimes(2);
    // Once it's finished, the same retry gets the list.
    expect((await postCopy({ itemIds: [String(item._id)] })).status).toBe(200);
  });

  /** What a copy that died part-way leaves: its row, an item and two copied images. */
  async function deadCopy(key: string) {
    const wishlist = new mongoose.Types.ObjectId();
    await Item.create({ wishlist, name: 'Orphan', imageUrl: blobOf(alice, 'o.jpg') });
    await WishlistCopy.create({
      user: alice,
      key: scopedIdempotencyKey(alice, key),
      wishlist,
      copiedUrls: [blobOf(alice, 'o.jpg'), blobOf(alice, 'cover-copy.jpg')],
      createdAt: new Date(Date.now() - COPY_STALE_MS - 1000),
    });
    return wishlist;
  }

  it('takes back what a dead attempt left, images included, and makes the list again', async () => {
    const dead = await deadCopy(KEY);
    as(alice);

    const res = await postCopy({});

    expect(res.status).toBe(201);
    expect((await res.json()).data._id).not.toBe(String(dead));
    expect(await Item.countDocuments({ wishlist: dead })).toBe(0);
    expect(del).toHaveBeenCalledWith(blobOf(alice, 'o.jpg'));
    expect(del).toHaveBeenCalledWith(blobOf(alice, 'cover-copy.jpg'));
    expect(await newLists()).toHaveLength(1);
    expect(await WishlistCopy.countDocuments({ wishlist: dead })).toBe(0);
  });

  // regression (review): a dead attempt's leftovers were only ever cleaned up
  // by a retry with its own key, which the dialog drops once it's closed.
  it('sweeps a dead attempt under another key on the user’s next copy', async () => {
    const dead = await deadCopy('an-older-key-0123456789');
    as(alice);

    expect((await postCopy({})).status).toBe(201);

    expect(await Item.countDocuments({ wishlist: dead })).toBe(0);
    expect(del).toHaveBeenCalledWith(blobOf(alice, 'cover-copy.jpg'));
    expect(await WishlistCopy.countDocuments({ wishlist: dead })).toBe(0);
  });

  it('answers with the list of an attempt that wrote it but died before marking it done', async () => {
    const list = await Wishlist.create({ name: 'Made', owners: [alice], visibility: 'friends' });
    await WishlistCopy.create({
      user: alice,
      key: scopedIdempotencyKey(alice, KEY),
      wishlist: list._id,
      createdAt: new Date(Date.now() - COPY_STALE_MS - 1000),
    });
    as(alice);

    const res = await postCopy({});

    expect(res.status).toBe(200);
    expect((await res.json()).data._id).toBe(String(list._id));
    expect(await newLists()).toHaveLength(1);
    expect((await WishlistCopy.findOne({ wishlist: list._id }).lean())!.done).toBe(true);
  });

  // regression (review): the limits were spent before a retry was answered,
  // so retrying one copy could lock a new account out.
  it('spends no limit on a retry or a refused request', async () => {
    const spent: string[] = [];
    const counting = (name: string): RateLimiter => ({
      async limit() {
        spent.push(name);
        return { success: true, reset: Date.now() + 60_000, limit: 10, remaining: 9 };
      },
    });
    __setRateLimiters({ listCopy: counting('listCopy'), content: counting('content') });
    as(alice);

    expect((await postCopy({})).status).toBe(201);
    expect((await postCopy({})).status).toBe(200);
    expect((await postCopy({ name: ' ' })).status).toBe(400);

    expect(spent).toEqual(['listCopy', 'content']);
  });

  it('leaves no list, items or copied images behind when saving the items fails', async () => {
    const items = [await makeItem(), await makeItem()];
    vi.spyOn(Item, 'insertMany').mockRejectedValueOnce(new Error('write failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    as(alice);

    const res = await postCopy({ itemIds: items.map((i) => String(i._id)) });

    expect(res.status).toBe(500);
    expect(await newLists()).toHaveLength(0);
    expect(await Item.countDocuments({ wishlist: { $ne: source } })).toBe(0);
    expect(del).toHaveBeenCalledTimes(3);
    expect(await WishlistCopy.countDocuments()).toBe(0);
    // A retry with the same key then makes the list.
    vi.mocked(console.error).mockRestore();
    expect((await postCopy({ itemIds: items.map((i) => String(i._id)) })).status).toBe(201);
  });
});
