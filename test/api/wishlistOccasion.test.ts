import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET, PATCH } from '@/app/api/wishlists/[id]/route';
import { GET as LIST_MINE } from '@/app/api/wishlists/route';
import { GET as PROFILE_LISTS } from '@/app/api/users/[id]/wishlists/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';

const session = vi.mocked(auth);

// A yearly occasion as stored: on the placeholder year, never a real one.
const BIRTHDAY = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' } as const;
const WEDDING = { kind: 'wedding', date: '2027-06-12', recurrence: null } as const;

let owner: string;
let coOwner: string;
let member: string;
let stranger: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

async function user(username: string) {
  const u = await User.create({ email: `${username}@x.com`, username });
  return u._id.toString();
}

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  owner = await user('owner');
  coOwner = await user('coowner');
  member = await user('member');
  stranger = await user('stranger');
});

async function list(fields: Record<string, unknown> = {}) {
  const wl = await Wishlist.create({
    name: 'Birthday',
    slug: 'birthday',
    owners: [owner, coOwner],
    visibility: 'everyone',
    ...fields,
  });
  await WishlistMember.create({ wishlist: wl._id, user: member });
  return wl._id.toString();
}

function signIn(userId: string | null) {
  session.mockResolvedValue(userId ? ({ user: { id: userId } } as never) : (null as never));
}

function patch(id: string, userId: string | null, body: unknown) {
  signIn(userId);
  const req = new NextRequest(`http://localhost/api/wishlists/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

function get(id: string, userId: string | null) {
  signIn(userId);
  return GET(new NextRequest(`http://localhost/api/wishlists/${id}`), {
    params: Promise.resolve({ id }),
  });
}

async function storedOccasion(id: string) {
  const wl = await Wishlist.findById(id).lean();
  return wl?.occasion ?? null;
}

describe('PATCH /api/wishlists/[id] — occasion', () => {
  it('lets an owner set, change and clear the occasion', async () => {
    const id = await list();

    let res = await patch(id, owner, { occasion: BIRTHDAY });
    expect(res.status).toBe(200);
    expect((await res.json()).data.occasion).toEqual(BIRTHDAY);
    expect(await storedOccasion(id)).toEqual(BIRTHDAY);

    res = await patch(id, owner, { occasion: WEDDING });
    expect(res.status).toBe(200);
    expect((await res.json()).data.occasion).toEqual(WEDDING);
    expect(await storedOccasion(id)).toEqual(WEDDING);

    res = await patch(id, owner, { occasion: null });
    expect(res.status).toBe(200);
    expect((await res.json()).data.occasion).toBeNull();
    expect(await storedOccasion(id)).toBeNull();
  });

  it('lets a co-owner set and clear it too', async () => {
    const id = await list({ occasion: WEDDING });

    let res = await patch(id, coOwner, { occasion: BIRTHDAY });
    expect(res.status).toBe(200);
    expect(await storedOccasion(id)).toEqual(BIRTHDAY);

    res = await patch(id, coOwner, { occasion: null });
    expect(res.status).toBe(200);
    expect(await storedOccasion(id)).toBeNull();
  });

  it('refuses a member and a stranger with the same answer as any other setting, and changes nothing', async () => {
    const id = await list({ occasion: WEDDING });

    for (const caller of [member, stranger]) {
      const occasionRes = await patch(id, caller, { occasion: BIRTHDAY });
      const nameRes = await patch(id, caller, { name: 'Renamed' });
      expect(occasionRes.status).toBe(403);
      expect(occasionRes.status).toBe(nameRes.status);
      expect(await occasionRes.json()).toEqual(await nameRes.json());

      const clearRes = await patch(id, caller, { occasion: null });
      expect(clearRes.status).toBe(403);
    }
    expect(await storedOccasion(id)).toEqual(WEDDING);
    expect((await Wishlist.findById(id))?.name).toBe('Birthday');
  });

  it('refuses a signed-out caller', async () => {
    const id = await list();
    expect((await patch(id, null, { occasion: BIRTHDAY })).status).toBe(401);
    expect(await storedOccasion(id)).toBeNull();
  });

  it('writes the occasion together with the other settings and the pin, in one edit', async () => {
    const id = await list();

    const res = await patch(id, owner, {
      name: 'Turning 37',
      visibility: 'friends',
      featured: true,
      occasion: BIRTHDAY,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()).data;
    expect(body).toMatchObject({
      name: 'Turning 37',
      visibility: 'friends',
      featured: true,
      occasion: BIRTHDAY,
    });

    const stored = await Wishlist.findById(id).lean();
    expect(stored?.name).toBe('Turning 37');
    expect(stored?.featuredBy.map(String)).toEqual([owner]);
    expect(stored?.occasion).toEqual(BIRTHDAY);
  });

  it('leaves the occasion alone when an edit does not mention it', async () => {
    const id = await list({ occasion: BIRTHDAY });

    const res = await patch(id, owner, { name: 'Renamed', featured: true });
    expect(res.status).toBe(200);
    expect((await res.json()).data.occasion).toEqual(BIRTHDAY);
    expect(await storedOccasion(id)).toEqual(BIRTHDAY);
  });

  it('refuses an invalid occasion (400) and writes none of the edit', async () => {
    const id = await list({ occasion: WEDDING });

    for (const occasion of [
      { ...WEDDING, date: '2026-02-30' },
      { ...WEDDING, date: '2027-02-29' },
      { ...BIRTHDAY, date: '1990-02-30' },
      { date: BIRTHDAY.date, recurrence: 'yearly' },
      { kind: 'birthday', date: BIRTHDAY.date },
    ]) {
      const res = await patch(id, owner, { name: 'Renamed', occasion });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/^Validation error: occasion\./);
    }
    expect(await storedOccasion(id)).toEqual(WEDDING);
    expect((await Wishlist.findById(id))?.name).toBe('Birthday');
  });

  it('accepts a one-off on Feb 29 of a leap year, and a yearly Feb 29 from any year', async () => {
    const id = await list();
    const leap = { kind: 'wedding', date: '2028-02-29', recurrence: null };
    expect((await patch(id, owner, { occasion: leap })).status).toBe(200);
    expect(await storedOccasion(id)).toEqual(leap);

    const yearly = { kind: 'birthday', date: '1991-02-29', recurrence: 'yearly' };
    expect((await patch(id, owner, { occasion: yearly })).status).toBe(200);
    expect(await storedOccasion(id)).toEqual({ ...yearly, date: '2000-02-29' });
  });

  it('accepts a one-off whose date has passed, as a list keeps it once it has', async () => {
    const id = await list();
    const past = { kind: 'wedding', date: '2020-06-12', recurrence: null };
    expect((await patch(id, owner, { occasion: past })).status).toBe(200);
    expect(await storedOccasion(id)).toEqual(past);
  });
});

// The operator's rule: only the day and month of a repeating occasion matter,
// so a real year (a birth year, typically) must never be stored or shown.
describe("a yearly occasion's real year", () => {
  const REAL_YEAR = '1990-';

  it('never reaches the database or any response, only the placeholder year does', async () => {
    const id = await list({ visibility: 'everyone' });

    const res = await patch(id, owner, {
      occasion: { kind: 'birthday', date: '1990-05-14', recurrence: 'yearly' },
    });
    expect(res.status).toBe(200);
    const patched = await res.json();
    expect(patched.data.occasion).toEqual({
      kind: 'birthday',
      date: '2000-05-14',
      recurrence: 'yearly',
    });
    const bodies: unknown[] = [patched];

    // The stored document, read around the model.
    const raw = await Wishlist.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
    expect(raw?.occasion).toEqual({ kind: 'birthday', date: '2000-05-14', recurrence: 'yearly' });
    bodies.push(raw);

    for (const viewer of [owner, coOwner, member, stranger, null]) {
      bodies.push(await (await get(id, viewer)).json());
    }
    for (const viewer of [owner, member]) {
      signIn(viewer);
      bodies.push(
        await (await LIST_MINE(new NextRequest('http://localhost/api/wishlists'))).json()
      );
    }
    for (const viewer of [stranger, null]) {
      signIn(viewer);
      const req = new NextRequest(`http://localhost/api/users/${owner}/wishlists`);
      const profile = await (
        await PROFILE_LISTS(req, { params: Promise.resolve({ id: owner }) })
      ).json();
      expect(profile.data).toEqual([expect.objectContaining({ occasion: patched.data.occasion })]);
      bodies.push(profile);
    }

    for (const body of bodies) {
      expect(JSON.stringify(body)).toContain('2000-05-14');
      expect(JSON.stringify(body)).not.toContain(REAL_YEAR);
    }
  });
});

describe('Wishlist model — occasion', () => {
  // A backstop for a write that skips the API's validation.
  it('refuses an unknown kind or recurrence, or a date that is not YYYY-MM-DD', async () => {
    for (const occasion of [
      { ...BIRTHDAY, kind: 'anniversary' },
      { ...BIRTHDAY, recurrence: 'monthly' },
      { ...BIRTHDAY, date: '2026-10-14T00:00:00.000Z' },
      { kind: 'birthday', recurrence: null },
    ]) {
      await expect(
        Wishlist.create({ name: 'L', owners: [owner], visibility: 'everyone', occasion })
      ).rejects.toThrow(/occasion/);
    }
  });

  it('refuses a yearly occasion stored with a real year, on create and on update', async () => {
    const real = { kind: 'birthday', date: '1990-10-14', recurrence: 'yearly' };
    await expect(
      Wishlist.create({ name: 'L', owners: [owner], visibility: 'everyone', occasion: real })
    ).rejects.toThrow(/occasion/);
    const id = await list();
    await expect(
      Wishlist.findOneAndUpdate(
        { _id: id },
        { $set: { occasion: real } },
        { new: true, runValidators: true }
      )
    ).rejects.toThrow(/occasion/);
    expect(await storedOccasion(id)).toBeNull();
  });

  it('stores a one-off with recurrence null, and a list with none as null', async () => {
    const once = await Wishlist.create({
      name: 'L',
      owners: [owner],
      visibility: 'everyone',
      occasion: WEDDING,
    });
    expect((await Wishlist.findById(once._id).lean())?.occasion).toEqual(WEDDING);
    const none = await Wishlist.create({ name: 'M', owners: [owner], visibility: 'everyone' });
    expect((await Wishlist.findById(none._id).lean())?.occasion).toBeNull();
  });
});

describe('GET /api/wishlists/[id] — occasion', () => {
  it('gives the occasion to every viewer who can see the list', async () => {
    const id = await list({ occasion: BIRTHDAY });

    for (const viewer of [owner, coOwner, member, stranger, null]) {
      const res = await get(id, viewer);
      expect(res.status).toBe(200);
      expect((await res.json()).data.occasion).toEqual(BIRTHDAY);
    }
  });

  it("gives it to a private list's members, and nothing to anyone else", async () => {
    const id = await list({ visibility: 'private', occasion: BIRTHDAY });

    const memberRes = await get(id, member);
    expect(memberRes.status).toBe(200);
    expect((await memberRes.json()).data.occasion).toEqual(BIRTHDAY);

    // Refused as before (403 signed in, 401 signed out), with no occasion.
    for (const [viewer, status] of [
      [stranger, 403],
      [null, 401],
    ] as const) {
      const res = await get(id, viewer);
      expect(res.status).toBe(status);
      expect(JSON.stringify(await res.json())).not.toContain(BIRTHDAY.date);
    }
  });

  it('keeps an archived list a 404 for everyone but its owners, occasion or not', async () => {
    const id = await list({ archived: true, occasion: BIRTHDAY });

    for (const viewer of [member, stranger, null]) {
      const res = await get(id, viewer);
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain(BIRTHDAY.date);
    }
    for (const viewer of [owner, coOwner]) {
      const res = await get(id, viewer);
      expect(res.status).toBe(200);
      expect((await res.json()).data.occasion).toEqual(BIRTHDAY);
    }
  });

  it('reads a list saved before occasions existed as having none', async () => {
    // Inserted around the model, so the stored list has no `occasion` at all.
    const { insertedId } = await Wishlist.collection.insertOne({
      name: 'Old list',
      slug: 'old-list',
      owners: [new mongoose.Types.ObjectId(owner)],
      visibility: 'everyone',
      featuredBy: [],
    });
    const res = await get(insertedId.toString(), stranger);
    expect(res.status).toBe(200);
    expect((await res.json()).data.occasion).toBeNull();
  });
});

describe('GET /api/wishlists — occasion on the list cards', () => {
  type Card = { _id: string; occasion: unknown };
  async function mine(userId: string) {
    signIn(userId);
    const res = await LIST_MINE(new NextRequest('http://localhost/api/wishlists'));
    expect(res.status).toBe(200);
    const { owned, member: shared }: { owned: Card[]; member: Card[] } = (await res.json()).data;
    return { owned: new Map(owned.map((l) => [l._id, l.occasion])), shared };
  }

  it("returns each list's occasion to its owners and members, null where there's none", async () => {
    const withOne = await list({ occasion: BIRTHDAY });
    const without = (
      await Wishlist.create({
        name: 'Other',
        slug: 'other',
        owners: [owner],
        visibility: 'everyone',
      })
    )._id.toString();

    const { owned } = await mine(owner);
    expect(owned.get(withOne)).toEqual(BIRTHDAY);
    expect(owned.get(without)).toBeNull();

    const { shared } = await mine(member);
    expect(shared).toEqual([expect.objectContaining({ _id: withOne, occasion: BIRTHDAY })]);
  });
});

describe('GET /api/users/[id]/wishlists — occasion on the profile cards', () => {
  async function profile(viewer: string | null) {
    signIn(viewer);
    const req = new NextRequest(`http://localhost/api/users/${owner}/wishlists`);
    const res = await PROFILE_LISTS(req, { params: Promise.resolve({ id: owner }) });
    expect(res.status).toBe(200);
    return (await res.json()).data as { _id: string; occasion: unknown }[];
  }

  it("gives a card the occasion of a list the viewer can see, and nothing of one they can't", async () => {
    const open = await list({ occasion: BIRTHDAY });
    const hidden = (
      await Wishlist.create({
        name: 'Wedding',
        slug: 'wedding',
        owners: [owner],
        visibility: 'private',
        occasion: WEDDING,
      })
    )._id.toString();
    const archivedDate = '2028-01-20';
    await Wishlist.create({
      name: 'Put away',
      slug: 'put-away',
      owners: [owner],
      visibility: 'everyone',
      archived: true,
      occasion: { kind: 'other', date: archivedDate, recurrence: null },
    });

    for (const viewer of [stranger, null]) {
      const cards = await profile(viewer);
      expect(cards).toEqual([expect.objectContaining({ _id: open, occasion: BIRTHDAY })]);
      expect(JSON.stringify(cards)).not.toContain(WEDDING.date);
      expect(JSON.stringify(cards)).not.toContain(archivedDate);
    }

    // On their own profile, the owner sees the private list's occasion too.
    const own = await profile(owner);
    expect(new Map(own.map((c) => [c._id, c.occasion]))).toEqual(
      new Map<string, unknown>([
        [open, BIRTHDAY],
        [hidden, WEDDING],
      ])
    );
  });
});
