import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import type { ReactElement } from 'react';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { cardImages, cardText } from '../ogCards';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['USD', 1]]) }),
  convertToUsdCents: vi.fn(),
}));
// Keeps each card's element tree instead of drawing it.
const { rendered, renderCard, loadCardPhoto, deleteByTag } = vi.hoisted(() => ({
  rendered: [] as ReactElement[],
  renderCard: vi.fn(),
  loadCardPhoto: vi.fn(),
  deleteByTag: vi.fn(),
}));
vi.mock('@/lib/og/render', () => ({ renderCardImage: renderCard }));
vi.mock('@/lib/og/photo', () => ({ loadCardPhoto }));
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: deleteByTag }));

import { auth } from '@/lib/auth';
import { generateMetadata } from '@/app/l/[token]/layout';
import LinkCard from '@/app/l/[token]/opengraph-image';
import { generateMetadata as canonicalMetadata } from '@/app/wishlists/[id]/layout';
import CanonicalCard from '@/app/wishlists/[id]/opengraph-image';
import {
  PATCH as patchLink,
  DELETE as revokeLink,
} from '@/app/api/wishlists/[id]/links/[linkId]/route';
import { PATCH as patchWishlist } from '@/app/api/wishlists/[id]/route';
import { insertShareLink } from '@/lib/utils/shareLinks';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import Item from '@/models/Item';
import ShareLink from '@/models/ShareLink';

/**
 * A share link's preview (WIS-336): the owner chose to share the link, so a
 * live one names its list (banner, name, primary owner, item count) whatever
 * the list's visibility, and points og:url at the link, not at the list's own
 * URL. A dead link (malformed, unknown, revoked, expired, archived or deleted
 * list) answers exactly like a missing list. A link's card is cached under its
 * list's tags and its own, never past the link's expiry, and only if the link
 * is still live once drawn.
 */

const session = vi.mocked(auth);
const OWN_BANNER = 'https://store.public.blob.vercel-storage.com/uploads/u/banner.webp';
const DAY = 86_400;
let owner: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  rendered.length = 0;
  renderCard.mockReset();
  renderCard.mockImplementation(async (element: ReactElement) => {
    rendered.push(element);
    return { body: new ArrayBuffer(8), contentType: 'image/jpeg' };
  });
  loadCardPhoto.mockReset();
  loadCardPhoto.mockResolvedValue({ status: 'none' });
  deleteByTag.mockReset();
  deleteByTag.mockResolvedValue(undefined);
  owner = (await User.create({ email: 'owner@x.com', username: 'owner' }))._id.toString();
  await backdate(User, owner);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A minute back, so a write a test makes is told from the fixture's creation. */
async function backdate(model: typeof User | typeof Wishlist, id: unknown) {
  await (model as typeof User).updateOne(
    { _id: id },
    { $set: { updatedAt: new Date(Date.now() - 60_000) } },
    { timestamps: false }
  );
}

async function list(fields: Record<string, unknown> = {}) {
  const wl = await Wishlist.create({
    name: 'Secret Santa',
    owners: [owner],
    visibility: 'private',
    slug: 'secret-santa-ab12c',
    ...fields,
  });
  await backdate(Wishlist, wl._id);
  return wl._id.toString();
}

async function link(wishlistId: string, expiresAt: Date | null = null) {
  const doc = await insertShareLink({
    wishlistId,
    level: 'view',
    label: 'Family chat',
    expiresAt,
    createdBy: owner,
  });
  return { id: doc._id.toString(), token: doc.token };
}

async function card(token: string) {
  const res = (await LinkCard({ params: Promise.resolve({ token }) })) as Response;
  const element = rendered.at(-1)!;
  return { res, text: cardText(element), images: cardImages(element) };
}

async function preview(token: string) {
  const metadata = await generateMetadata({ params: Promise.resolve({ token }) });
  return { metadata, ...(await card(token)) };
}

/** What a list that doesn't exist previews as, at its canonical URL. */
async function missingListPreview() {
  const params = { params: Promise.resolve({ id: new mongoose.Types.ObjectId().toString() }) };
  const metadata = await canonicalMetadata(params);
  const res = (await CanonicalCard(params)) as Response;
  return { metadata, res, text: cardText(rendered.at(-1)!) };
}

const tagsOf = (res: Response) => res.headers.get('Vercel-Cache-Tag')?.split(',') ?? [];
const purged = () => deleteByTag.mock.calls.map(([tags]) => tags);

describe('a live share link', () => {
  it.each([
    ['Public', 'everyone'],
    ['Friends', 'friends'],
    ['Invite only', 'private'],
  ])('names a %s list, its owner and the items a visitor sees', async (_, visibility) => {
    const id = await list({ visibility, bannerUrl: OWN_BANNER });
    await Item.create(
      ['available', 'booked', 'completed', 'draft', 'proposed'].map((status) => ({
        wishlist: id,
        name: `A ${status} item`,
        status,
      }))
    );
    loadCardPhoto.mockResolvedValue({ status: 'ok', src: 'data:image/jpeg;base64,AAAA' });
    const { token, id: linkId } = await link(id);

    const { metadata, text, images, res } = await preview(token);
    expect(metadata.title).toBe('Secret Santa');
    expect(metadata.description).toBe('Browse “Secret Santa” by @owner on Wishlist.');
    expect(text).toContain('Secret Santa');
    // Drafts and proposals aren't shown to visitors, so they aren't counted.
    expect(text).toContain('by @owner · 3 items');
    expect(loadCardPhoto).toHaveBeenCalledWith(OWN_BANNER, { width: 1200, height: 630 });
    expect(images).toContain('data:image/jpeg;base64,AAAA');
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe(`public, max-age=${DAY}`);
    // The list's tags (so every list purge drops it) plus the link's own, by id.
    expect(tagsOf(res)).toEqual([`og-wishlist-${id}`, `og-user-${owner}`, `og-link-${linkId}`]);
    expect(res.headers.get('Vercel-Cache-Tag')).not.toContain(token);
  });

  // The list's own URL wouldn't open for the chat's readers.
  it('points og:url at the link, never at the list', async () => {
    const id = await list();
    const { token } = await link(id);
    const { metadata } = await preview(token);
    expect(metadata.openGraph).toMatchObject({ url: `/l/${token}` });
    expect(JSON.stringify(metadata)).not.toContain('secret-santa-ab12c');
    expect(JSON.stringify(metadata)).not.toContain(id);
  });

  it("is credited to a co-owned list's primary owner", async () => {
    const second = await User.create({ email: 'second@x.com', username: 'second' });
    const id = await list({ owners: [owner, second._id] });
    const { token } = await link(id);
    const { text } = await card(token);
    expect(text).toContain('by @owner · No items yet');
  });

  // Nothing purges a card when its link simply runs out.
  it("is kept by the CDN no longer than the link's expiry", async () => {
    const id = await list();
    const { token } = await link(id, new Date(Date.now() + 2 * 3600_000));
    const { res } = await card(token);
    const maxAge = Number(
      /max-age=(\d+)/.exec(res.headers.get('Vercel-CDN-Cache-Control') ?? '')?.[1]
    );
    expect(maxAge).toBeGreaterThan(2 * 3600 - 60);
    expect(maxAge).toBeLessThanOrEqual(2 * 3600);
  });

  it('is kept for a day when the link expires later than that', async () => {
    const id = await list();
    const { token } = await link(id, new Date(Date.now() + 7 * DAY * 1000));
    const { res } = await card(token);
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe(`public, max-age=${DAY}`);
  });

  it("is still drawn but isn't cached when its banner couldn't be loaded", async () => {
    const id = await list({ bannerUrl: OWN_BANNER });
    loadCardPhoto.mockResolvedValue({ status: 'failed' });
    const { token } = await link(id);
    const { text, res } = await card(token);
    expect(text).toContain('Secret Santa');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('a dead share link', () => {
  const dead: [string, () => Promise<string>][] = [
    ['a malformed token', async () => '{"$ne":null}'],
    ['a too-short token', async () => 'abc'],
    ['an unknown token', async () => 'A'.repeat(22)],
    [
      'a revoked link',
      async () => {
        const { id, token } = await link(await list({ bannerUrl: OWN_BANNER }));
        await ShareLink.deleteOne({ _id: id });
        return token;
      },
    ],
    ['an expired link', async () => (await link(await list(), new Date(Date.now() - 1000))).token],
    [
      "an archived list's link",
      async () => (await link(await list({ visibility: 'everyone', archived: true }))).token,
    ],
    [
      "a deleted list's link",
      async () => {
        const id = await list({ visibility: 'everyone' });
        const { token } = await link(id);
        await Wishlist.deleteOne({ _id: id });
        return token;
      },
    ],
  ];

  it.each(dead)('previews %s exactly like a missing list', async (_, make) => {
    const token = await make();
    const deadPreview = await preview(token);
    const missing = await missingListPreview();

    expect(deadPreview.metadata).toEqual({});
    expect(deadPreview.metadata).toEqual(missing.metadata);
    expect(deadPreview.text).toEqual(missing.text);
    expect(deadPreview.text.join(' ')).not.toContain('Secret Santa');
    expect(deadPreview.text.join(' ')).not.toContain('owner');
    expect(deadPreview.images.every((src) => src.startsWith('data:image/svg+xml'))).toBe(true);
    expect([...deadPreview.res.headers]).toEqual([...missing.res.headers]);
    expect(deadPreview.res.headers.get('Cache-Control')).toBe('no-store');
    expect(loadCardPhoto).not.toHaveBeenCalled();
  });

  it('never queries for a token of the wrong shape', async () => {
    const findOne = vi.spyOn(ShareLink, 'findOne');
    await preview('{"$ne":null}');
    expect(findOne).not.toHaveBeenCalled();
  });

  // A failed read is the generic card, and the log never quotes the token.
  it('falls back to the generic card, uncached, when the link read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { token } = await link(await list());
    vi.spyOn(ShareLink, 'findOne').mockImplementation(() => {
      throw new Error(`db down near ${token}`);
    });
    const { text, res, metadata } = await preview(token);
    expect(metadata).toEqual({});
    expect(text).toContain('A wishlist');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(JSON.stringify(error.mock.calls)).not.toContain(token);
  });
});

describe("a link card that changes while it's drawn isn't cached", () => {
  // A write landing mid-draw purged a cache this card wasn't in yet.
  it.each([
    ['the link is revoked', (linkId: string) => ShareLink.deleteOne({ _id: linkId })],
    [
      'the link expires',
      (linkId: string) =>
        ShareLink.updateOne({ _id: linkId }, { $set: { expiresAt: new Date(Date.now() - 1) } }),
    ],
    [
      "the link's expiry is moved",
      (linkId: string) =>
        ShareLink.updateOne(
          { _id: linkId },
          { $set: { expiresAt: new Date(Date.now() + 3600_000) } }
        ),
    ],
    [
      'the list is archived',
      (_: string, listId: string) => Wishlist.updateOne({ _id: listId }, { archived: true }),
    ],
    [
      'the list is renamed',
      (_: string, listId: string) => Wishlist.updateOne({ _id: listId }, { name: 'Renamed' }),
    ],
  ])('when %s', async (_, change) => {
    const listId = await list();
    const { id: linkId, token } = await link(listId);
    renderCard.mockImplementationOnce(async (element: ReactElement) => {
      rendered.push(element);
      await change(linkId, listId);
      return { body: new ArrayBuffer(8), contentType: 'image/jpeg' };
    });
    const { res } = await card(token);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it('when the link no longer opens its list', async () => {
    const listId = await list();
    const other = await list({ slug: 'other-ab12c' });
    const { id: linkId, token } = await link(listId);
    renderCard.mockImplementationOnce(async (element: ReactElement) => {
      rendered.push(element);
      await ShareLink.updateOne({ _id: linkId }, { $set: { wishlist: other } });
      return { body: new ArrayBuffer(8), contentType: 'image/jpeg' };
    });
    const { res } = await card(token);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('purging link cards', () => {
  function as(userId: string) {
    session.mockResolvedValue({ user: { id: userId } } as never);
  }
  function req(url: string, method: string, body?: unknown) {
    return new NextRequest('http://localhost' + url, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  }
  const linkParams = (id: string, linkId: string) => ({
    params: Promise.resolve({ id, linkId }),
  });

  it("revoking a link purges the link's own card, by id", async () => {
    const listId = await list();
    const { id: linkId, token } = await link(listId);
    as(owner);
    const res = await revokeLink(
      req(`/api/wishlists/${listId}/links/${linkId}`, 'DELETE'),
      linkParams(listId, linkId)
    );
    expect(res.status).toBe(200);
    expect(purged()).toEqual([[`og-link-${linkId}`]]);
    expect(JSON.stringify(purged())).not.toContain(token);
  });

  it("editing a link's expiry purges its card; editing its label doesn't", async () => {
    const listId = await list();
    const { id: linkId } = await link(listId);
    as(owner);
    const patch = (body: unknown) =>
      patchLink(
        req(`/api/wishlists/${listId}/links/${linkId}`, 'PATCH', body),
        linkParams(listId, linkId)
      );

    expect((await patch({ label: 'Wedding QR' })).status).toBe(200);
    expect(deleteByTag).not.toHaveBeenCalled();

    const later = new Date(Date.now() + 7 * DAY * 1000).toISOString();
    expect((await patch({ expiresAt: later })).status).toBe(200);
    expect(purged()).toEqual([[`og-link-${linkId}`]]);
  });

  it('a refused revoke or edit purges nothing', async () => {
    const listId = await list();
    const { id: linkId } = await link(listId);
    const stranger = (await User.create({ email: 's@x.com', username: 'stranger' }))._id;
    as(stranger.toString());
    await revokeLink(
      req(`/api/wishlists/${listId}/links/${linkId}`, 'DELETE'),
      linkParams(listId, linkId)
    );
    await patchLink(
      req(`/api/wishlists/${listId}/links/${linkId}`, 'PATCH', { expiresAt: null }),
      linkParams(listId, linkId)
    );
    expect(deleteByTag).not.toHaveBeenCalled();
    expect(await ShareLink.exists({ _id: linkId })).toBeTruthy();
  });

  // Every list purge drops the link's card too: it carries the list's tag.
  it("renaming the list purges a tag its links' cards carry", async () => {
    const listId = await list();
    const { token } = await link(listId);
    const { res } = await card(token);
    as(owner);
    const patched = await patchWishlist(
      req(`/api/wishlists/${listId}`, 'PATCH', { name: 'Renamed' }),
      { params: Promise.resolve({ id: listId }) }
    );
    expect(patched.status).toBe(200);
    expect(purged()).toHaveLength(1);
    expect(tagsOf(res)).toEqual(expect.arrayContaining(purged()[0]));
  });
});
