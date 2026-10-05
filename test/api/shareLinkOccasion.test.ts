import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// WIS-342: a link made with Day after the occasion remembers it
// (`untilOccasion`), and moves with the list's occasion.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendWishlistInvitationEmail: vi.fn() }));
vi.mock('@/lib/og/purge', () => ({ purgeShareCards: vi.fn().mockResolvedValue(undefined) }));

import { auth } from '@/lib/auth';
import { purgeShareCards } from '@/lib/og/purge';
import { GET as listLinks, POST as createLink } from '@/app/api/wishlists/[id]/links/route';
import { PATCH as editLink } from '@/app/api/wishlists/[id]/links/[linkId]/route';
import { PATCH as editWishlist } from '@/app/api/wishlists/[id]/route';
import { __setRateLimiters } from '@/lib/rateLimit';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import ShareLink from '@/models/ShareLink';
import { generateShareToken } from '@/lib/utils/shareLinks';

const session = vi.mocked(auth);
const purge = vi.mocked(purgeShareCards);
const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);
const BERLIN = 'Europe/Berlin';

let alice: string; // owner
let carol: string; // member
let listId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  purge.mockClear();
  __setRateLimiters(null);
  alice = (await User.create({ email: 'a@x.com', username: 'alice' }))._id.toString();
  carol = (await User.create({ email: 'c@x.com', username: 'carol' }))._id.toString();
  listId = (
    await Wishlist.create({
      name: 'Wedding',
      slug: 'wedding',
      owners: [alice],
      visibility: 'private',
      occasion: { kind: 'wedding', date: '2030-06-20', recurrence: null },
    })
  )._id.toString();
  await WishlistMember.create({ wishlist: listId, user: carol });
});

afterEach(() => vi.restoreAllMocks());

function req(url: string, method: string, body: unknown) {
  return new NextRequest('http://localhost' + url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}
const as = (userId: string) => session.mockResolvedValueOnce({ user: { id: userId } } as never);
const params = () => ({ params: Promise.resolve({ id: listId }) });
const linkParams = (linkId: string) => ({ params: Promise.resolve({ id: listId, linkId }) });

async function create(body: Record<string, unknown>) {
  as(alice);
  const res = await createLink(req(`/api/wishlists/${listId}/links`, 'POST', body), params());
  return { status: res.status, body: await res.json() };
}
async function edit(linkId: string, body: Record<string, unknown>, who = alice) {
  as(who);
  const res = await editLink(
    req(`/api/wishlists/${listId}/links/${linkId}`, 'PATCH', body),
    linkParams(linkId)
  );
  return { status: res.status, body: await res.json() };
}
async function setOccasion(occasion: unknown) {
  as(alice);
  const res = await editWishlist(req(`/api/wishlists/${listId}`, 'PATCH', { occasion }), params());
  return { status: res.status, body: await res.json() };
}
async function listLinksAs(who: string) {
  as(who);
  const res = await listLinks(req(`/api/wishlists/${listId}/links`, 'GET', undefined), params());
  return { status: res.status, body: await res.json() };
}
const link = (over: Record<string, unknown>) =>
  ShareLink.create({ wishlist: listId, token: generateShareToken(), level: 'join', ...over });
const expiryOf = async (id: unknown) =>
  (await ShareLink.findById(id).lean())!.expiresAt!.toISOString();

describe('untilOccasion on create and edit', () => {
  it('is stored with its zone on create, the server working out the date', async () => {
    const res = await create({
      level: 'join',
      // Whatever date comes along, the server's own is the occasion's.
      expiresAt: '2031-01-01T00:00:00Z',
      untilOccasion: true,
      timeZone: BERLIN,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.untilOccasion).toBe(true);
    // Midnight after Jun 20 in Berlin.
    expect(res.body.data.expiresAt).toBe('2030-06-20T22:00:00.000Z');
    const stored = (await ShareLink.findById(res.body.data._id).lean())!;
    expect(stored.timeZone).toBe(BERLIN);
  });

  it('defaults to false, with no zone kept', async () => {
    const res = await create({ level: 'view', timeZone: BERLIN });
    expect(res.body.data.untilOccasion).toBe(false);
    expect((await ShareLink.findById(res.body.data._id).lean())!.timeZone).toBeNull();
  });

  it('needs a real time zone', async () => {
    expect((await create({ level: 'join', untilOccasion: true })).status).toBe(400);
    expect(
      (await create({ level: 'join', untilOccasion: true, timeZone: 'Mars/Olympus' })).status
    ).toBe(400);
  });

  it('is refused on a list with no occasion ahead', async () => {
    await Wishlist.updateOne({ _id: listId }, { $set: { occasion: null } });
    const res = await create({ level: 'join', untilOccasion: true, timeZone: BERLIN });
    expect(res.status).toBe(409);
    expect(await ShareLink.countDocuments()).toBe(0);
  });

  it('is cleared by an expiry set any other way, and kept by a label edit', async () => {
    const l = await link({
      expiresAt: at('2030-06-20T22:00:00Z'),
      untilOccasion: true,
      timeZone: BERLIN,
    });
    await edit(String(l._id), { label: 'Guests' });
    expect((await ShareLink.findById(l._id).lean())!.untilOccasion).toBe(true);
    const res = await edit(String(l._id), { expiresAt: '2030-07-01T00:00:00Z' });
    expect(res.body.data.untilOccasion).toBe(false);
    expect((await ShareLink.findById(l._id).lean())!.timeZone).toBeNull();
  });

  it('is set by an edit to Day after the occasion, with the server’s date', async () => {
    const l = await link({ expiresAt: at('2030-07-01T00:00:00Z') });
    const res = await edit(String(l._id), { untilOccasion: true, timeZone: 'America/Los_Angeles' });
    expect(res.body.data.untilOccasion).toBe(true);
    expect(res.body.data.expiresAt).toBe('2030-06-21T07:00:00.000Z');
    expect(purge).toHaveBeenCalledWith({ shareLinkIds: [String(l._id)] });
  });

  it('can’t be set by a member', async () => {
    const l = await link({ expiresAt: at('2030-07-01T00:00:00Z') });
    const res = await edit(String(l._id), { untilOccasion: true, timeZone: BERLIN }, carol);
    expect(res.status).toBe(404);
    expect((await ShareLink.findById(l._id).lean())!.untilOccasion).toBe(false);
  });
});

describe('an occasion change', () => {
  const tiedLink = (timeZone = BERLIN, expiresAt = at('2030-06-20T22:00:00Z')) =>
    link({ expiresAt, untilOccasion: true, timeZone });

  it('moves live links that end with it to midnight after the new date, in each one’s zone', async () => {
    const berlin = await tiedLink();
    const la = await tiedLink('America/Los_Angeles', at('2030-06-21T07:00:00Z'));
    const fixed = await link({ expiresAt: at('2030-06-20T22:00:00Z') });
    const res = await setOccasion({ kind: 'wedding', date: '2030-12-10', recurrence: null });
    expect(res.status).toBe(200);
    // December: Berlin is UTC+1 now, so midnight is 23:00 UTC, not 22:00.
    expect(await expiryOf(berlin._id)).toBe('2030-12-10T23:00:00.000Z');
    expect(await expiryOf(la._id)).toBe('2030-12-11T08:00:00.000Z');
    expect(await expiryOf(fixed._id)).toBe('2030-06-20T22:00:00.000Z');
    expect(purge).toHaveBeenCalledWith({
      shareLinkIds: expect.arrayContaining([String(berlin._id), String(la._id)]),
    });
  });

  it('never brings back an expired link', async () => {
    const expired = await tiedLink(BERLIN, new Date(Date.now() - DAY));
    const was = await expiryOf(expired._id);
    await setOccasion({ kind: 'wedding', date: '2030-06-27', recurrence: null });
    expect(await expiryOf(expired._id)).toBe(was);
  });

  it('leaves links alone when the day after stays the same', async () => {
    const tied = await tiedLink();
    await setOccasion({ kind: 'other', date: '2030-06-20', recurrence: null });
    expect(await expiryOf(tied._id)).toBe('2030-06-20T22:00:00.000Z');
    expect(purge).not.toHaveBeenCalledWith(
      expect.objectContaining({ shareLinkIds: expect.anything() })
    );
  });

  it('keeps the date and stops following when the occasion is cleared', async () => {
    const tied = await tiedLink();
    await setOccasion(null);
    const after = (await ShareLink.findById(tied._id).lean())!;
    expect(after.expiresAt!.toISOString()).toBe('2030-06-20T22:00:00.000Z');
    expect(after.untilOccasion).toBe(false);
  });

  it('moves nothing on an edit that leaves the occasion alone', async () => {
    await Wishlist.updateOne({ _id: listId }, { $set: { 'occasion.date': '2030-06-27' } });
    const tied = await tiedLink();
    as(alice);
    await editWishlist(req(`/api/wishlists/${listId}`, 'PATCH', { name: 'Our wedding' }), params());
    expect(await expiryOf(tied._id)).toBe('2030-06-20T22:00:00.000Z');
  });

  // regression (review of WIS-342): the links moved only right after the
  // occasion's write, so one that failed left them stale for good.
  it('saves the occasion even when moving the links fails, and the owners’ next read mends them', async () => {
    const tied = await tiedLink();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(ShareLink, 'bulkWrite').mockRejectedValueOnce(new Error('db hiccup'));
    const res = await setOccasion({ kind: 'wedding', date: '2030-06-27', recurrence: null });
    expect(res.status).toBe(200);
    expect(logged).toHaveBeenCalled();
    expect(await expiryOf(tied._id)).toBe('2030-06-20T22:00:00.000Z');

    const read = await listLinksAs(alice);
    expect(read.status).toBe(200);
    expect(read.body.data[0].expiresAt).toBe('2030-06-27T22:00:00.000Z');
    expect(await expiryOf(tied._id)).toBe('2030-06-27T22:00:00.000Z');
  });
});
