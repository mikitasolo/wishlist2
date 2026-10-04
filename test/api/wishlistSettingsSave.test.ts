import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// Two co-owners edit the same list's settings at once. The settings form on the
// wishlist page is filled when the page loads, so these tests fill it the same
// way (from the GET), let the other owner change the list, then save it the way
// the page does: only what `settingsChanges` says the owner changed.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
// Record which blobs a save frees instead of talking to a store.
const del = vi.fn().mockResolvedValue(undefined);
vi.mock('@vercel/blob', () => ({
  del: (...a: unknown[]) => del(...a),
  list: vi.fn(),
  put: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { GET, PATCH } from '@/app/api/wishlists/[id]/route';
import {
  settingsChanges,
  settingsFormFor,
  wishlistSettings,
  type WishlistSettingsForm,
} from '@/lib/utils/wishlistSettings';
import { occasionToDraft } from '@/lib/utils/occasion';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';

const session = vi.mocked(auth);

// A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
// store's public host is derived from it.
const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const blobOf = (userId: string, name: string) => `${HOST}/uploads/${userId}/${name}`;

const BIRTHDAY = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' } as const;

let alice: string;
let bob: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  await clearTestDB();
  session.mockReset();
  del.mockClear();
  alice = (await User.create({ email: 'a@x.com', username: 'alice' }))._id.toString();
  bob = (await User.create({ email: 'b@x.com', username: 'bob' }))._id.toString();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function signIn(userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
}

async function patch(id: string, userId: string, body: unknown) {
  signIn(userId);
  const req = new NextRequest(`http://localhost/api/wishlists/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

/** Open the settings: the list as the page loads it, and the form filled from it. */
async function openSettings(id: string, userId: string) {
  signIn(userId);
  const res = await GET(new NextRequest(`http://localhost/api/wishlists/${id}`), {
    params: Promise.resolve({ id }),
  });
  const baseline = wishlistSettings((await res.json()).data);
  return { baseline, form: settingsFormFor(baseline) };
}

/** Save the form the way the page does: only the settings changed in it. */
async function save(
  id: string,
  userId: string,
  { baseline, form }: Awaited<ReturnType<typeof openSettings>>,
  change: Partial<WishlistSettingsForm>
) {
  const body = settingsChanges({ ...form, ...change }, baseline);
  const res = await patch(id, userId, body);
  expect(res.status).toBe(200);
  return { body, data: (await res.json()).data };
}

async function list(fields: Record<string, unknown> = {}) {
  const wl = await Wishlist.create({
    name: 'Birthday',
    slug: 'birthday',
    description: 'Things I would like',
    owners: [alice, bob],
    visibility: 'everyone',
    currency: 'EUR',
    ...fields,
  });
  return wl._id.toString();
}

describe("saving the wishlist settings leaves a co-owner's change made meanwhile alone", () => {
  // regression: the form sent every setting on each save, as filled when the
  // page loaded, so Alice's description edit wrote back `visibility: everyone`
  // over the list Bob had just made private.
  it('regression: a description-only save keeps the visibility a co-owner just changed', async () => {
    const id = await list();
    const alicesForm = await openSettings(id, alice);

    expect((await patch(id, bob, { visibility: 'private' })).status).toBe(200);

    const { body, data } = await save(id, alice, alicesForm, { description: 'Updated' });
    expect(body).toEqual({ description: 'Updated' });
    expect(data).toMatchObject({ description: 'Updated', visibility: 'private' });

    const stored = await Wishlist.findById(id).lean();
    expect(stored).toMatchObject({
      description: 'Updated',
      visibility: 'private',
    });
  });

  it('keeps every other setting a co-owner changed: name, link, currency, occasion', async () => {
    const id = await list();
    const alicesForm = await openSettings(id, alice);

    const bobs = {
      name: 'Family birthday',
      slug: 'family-birthday',
      currency: 'GBP',
      visibility: 'friends',
      occasion: BIRTHDAY,
    };
    expect((await patch(id, bob, bobs)).status).toBe(200);

    await save(id, alice, alicesForm, { description: 'Updated' });

    const stored = await Wishlist.findById(id).lean();
    expect(stored).toMatchObject({ ...bobs, description: 'Updated' });
  });

  // regression: the stale form also sent the banner it had loaded. Once Bob had
  // replaced it, Alice's save put back the old one (whose blob Bob's change had
  // already freed) and freed Bob's new upload.
  it("regression: keeps, and doesn't free, a banner a co-owner just replaced", async () => {
    const alicesBanner = blobOf(alice, 'old.webp');
    const bobsBanner = blobOf(bob, 'new.webp');
    const id = await list({ bannerUrl: alicesBanner });
    const alicesForm = await openSettings(id, alice);

    expect((await patch(id, bob, { bannerUrl: bobsBanner })).status).toBe(200);
    expect(del).toHaveBeenCalledWith(alicesBanner);
    del.mockClear();

    await save(id, alice, alicesForm, { description: 'Updated' });

    expect((await Wishlist.findById(id).lean())?.bannerUrl).toBe(bobsBanner);
    expect(del).not.toHaveBeenCalled();
  });

  it('still writes the settings the owner did change, together, in one save', async () => {
    const id = await list({ occasion: BIRTHDAY });
    const alicesForm = await openSettings(id, alice);

    expect((await patch(id, bob, { description: "Bob's notes" })).status).toBe(200);

    const { body } = await save(id, alice, alicesForm, {
      name: 'Turning 37',
      visibility: 'friends',
      occasion: occasionToDraft(null),
    });
    expect(body).toEqual({ name: 'Turning 37', visibility: 'friends', occasion: null });

    const stored = await Wishlist.findById(id).lean();
    expect(stored).toMatchObject({
      name: 'Turning 37',
      visibility: 'friends',
      occasion: null,
      description: "Bob's notes",
    });
  });
});
