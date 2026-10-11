import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import type { ReactElement } from 'react';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { cardImages, cardText } from '../ogCards';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
// Keeps each card's element tree instead of drawing it.
const { rendered, renderCard, loadCardPhoto, resolveWishlistId } = vi.hoisted(() => ({
  rendered: [] as ReactElement[],
  renderCard: vi.fn(),
  loadCardPhoto: vi.fn(),
  resolveWishlistId: vi.fn(),
}));
vi.mock('@/lib/og/render', () => ({ renderCardImage: renderCard }));
vi.mock('@/lib/og/photo', () => ({ loadCardPhoto }));
vi.mock('@/lib/utils/wishlistSlug', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/wishlistSlug')>()),
  resolveWishlistId,
}));

import { generateMetadata } from '@/app/wishlists/[id]/layout';
import ShareCard from '@/app/wishlists/[id]/opengraph-image';
import { DATA_BUDGET_MS, RENDER_BUDGET_MS } from '@/lib/og/shareCards';
import { METADATA_BUDGET_MS } from '@/lib/utils/og';
import * as slugs from '@/lib/utils/wishlistSlug';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import Item from '@/models/Item';

/**
 * Crawlers fetch a list's share metadata and share card signed out, so both may
 * reveal its name only when a signed-out visitor could open it
 * (`getWishlistViewAccess`): public, and not archived. Every other list gets a
 * generic preview, the same as a list that doesn't exist, and only a card that
 * showed real, current data may be kept by the CDN.
 */

const OWN_BANNER = 'https://store.public.blob.vercel-storage.com/uploads/u/banner.webp';
let owner: mongoose.Types.ObjectId;
let actualResolve: typeof slugs.resolveWishlistId;

beforeAll(async () => {
  await connectTestDB();
  actualResolve = (await vi.importActual<typeof slugs>('@/lib/utils/wishlistSlug'))
    .resolveWishlistId;
});
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  rendered.length = 0;
  renderCard.mockReset();
  renderCard.mockImplementation(async (element: ReactElement) => {
    rendered.push(element);
    return { body: new ArrayBuffer(8), contentType: 'image/jpeg' };
  });
  loadCardPhoto.mockReset();
  loadCardPhoto.mockResolvedValue({ status: 'none' });
  resolveWishlistId.mockReset();
  resolveWishlistId.mockImplementation(actualResolve);
  owner = (await User.create({ email: 'owner@x.com', username: 'owner' }))._id;
  await backdate(User, owner);
});

/**
 * Move a fixture's `updatedAt` a minute back, so a write a test makes is told
 * from its creation even when both land in the same millisecond.
 */
async function backdate(model: typeof User | typeof Wishlist, id: unknown) {
  await (model as typeof User).updateOne(
    { _id: id },
    { $set: { updatedAt: new Date(Date.now() - 60_000) } },
    { timestamps: false }
  );
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function list(fields: Record<string, unknown> = {}) {
  const wl = await Wishlist.create({
    name: 'Secret Santa',
    owners: [owner],
    visibility: 'everyone',
    slug: 'secret-santa-ab12c',
    ...fields,
  });
  await backdate(Wishlist, wl._id);
  return wl._id.toString();
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function card(id: string) {
  const res = (await ShareCard(params(id))) as Response;
  const element = rendered.at(-1)!;
  return { res, text: cardText(element), images: cardImages(element) };
}

async function preview(id: string) {
  const metadata = await generateMetadata(params(id));
  return { metadata, ...(await card(id)) };
}

describe('wishlist share metadata and share card', () => {
  it('name a public list, its owner and the items a visitor sees', async () => {
    const id = await list();
    await Item.create(
      ['available', 'booked', 'completed', 'draft', 'proposed'].map((status) => ({
        wishlist: id,
        name: `A ${status} item`,
        status,
      }))
    );
    const { metadata, text, res } = await preview(id);
    expect(metadata.title).toBe('Secret Santa');
    expect(metadata.openGraph).toMatchObject({ url: '/wishlists/secret-santa-ab12c' });
    expect(text).toContain('Secret Santa');
    // Drafts and proposals aren't shown to visitors, so they aren't counted.
    expect(text).toContain('by @owner · 3 items');
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('point og:url at the id when the list has no slug', async () => {
    const id = await list({ slug: null });
    const { metadata } = await preview(id);
    expect(metadata.openGraph).toMatchObject({ url: `/wishlists/${id}` });
  });

  it('credit a co-owned list to its primary owner', async () => {
    const second = await User.create({ email: 'second@x.com', username: 'second' });
    const id = await list({ owners: [owner, second._id] });
    const { text, res } = await preview(id);
    expect(text).toContain('by @owner · No items yet');
    expect(res.headers.get('Vercel-Cache-Tag')).toBe(`og-wishlist-${id},og-user-${owner}`);
  });

  it("let the CDN keep a public list's card for a day, under its own and its owner's tags", async () => {
    const id = await list();
    const { res } = await card(id);
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe('public, max-age=86400');
    expect(res.headers.get('Vercel-Cache-Tag')).toBe(`og-wishlist-${id},og-user-${owner}`);
  });

  it('answer by slug with the same card as by id', async () => {
    const id = await list();
    const bySlug = await card('secret-santa-ab12c');
    const byId = await card(id);
    expect(bySlug.text).toEqual(byId.text);
    expect(bySlug.res.headers.get('Vercel-Cache-Tag')).toBe(
      byId.res.headers.get('Vercel-Cache-Tag')
    );
  });

  it.each([
    ['a friends-only list', { visibility: 'friends' }],
    ['a private list', { visibility: 'private' }],
    ['an archived public list', { visibility: 'everyone', archived: true }],
  ])('never name %s, and show it exactly like a missing list', async (_, fields) => {
    const id = await list({ bannerUrl: OWN_BANNER, ...fields });
    const hidden = await preview(id);
    expect(hidden.metadata.title).toBeUndefined();
    expect(hidden.metadata.openGraph).toBeUndefined();
    expect(hidden.text.join(' ')).not.toContain('Secret Santa');
    expect(hidden.text.join(' ')).not.toContain('owner');
    expect(hidden.text).toContain('A wishlist');
    // Only the logo: no banner, not even one a hidden list has.
    expect(hidden.images.every((src) => src.startsWith('data:image/svg+xml'))).toBe(true);

    const missing = await preview(new mongoose.Types.ObjectId().toString());
    expect(hidden.text).toEqual(missing.text);
    expect(hidden.metadata).toEqual(missing.metadata);
    expect([...hidden.res.headers]).toEqual([...missing.res.headers]);
    // Not cached: a list that goes public later shows at once, and no header
    // tells a hidden list from a missing one.
    expect(hidden.res.headers.get('Cache-Control')).toBe('no-store');
    expect(hidden.res.headers.get('Vercel-Cache-Tag')).toBeNull();
    expect(loadCardPhoto).not.toHaveBeenCalled();
  });

  it("draw a public list's banner", async () => {
    const id = await list({ bannerUrl: OWN_BANNER });
    loadCardPhoto.mockResolvedValue({ status: 'ok', src: 'data:image/jpeg;base64,AAAA' });
    const { text, images, res } = await card(id);
    expect(loadCardPhoto).toHaveBeenCalledWith(OWN_BANNER, { width: 1200, height: 630 });
    expect(images).toContain('data:image/jpeg;base64,AAAA');
    expect(text).toContain('Secret Santa');
    expect(res.headers.get('Vercel-Cache-Tag')).toBe(`og-wishlist-${id},og-user-${owner}`);
  });

  // WIS-428: a list without a banner wears its occasion's cover pattern, drawn from the kind only.
  it("draw the occasion's cover pattern on a list with no banner, and not over a banner", async () => {
    const occasion = { kind: 'wedding', date: '2000-06-01', recurrence: 'yearly' };
    const id = await list({ occasion });
    const svgs = (images: string[]) =>
      images
        .filter((src) => src.startsWith('data:image/svg+xml;base64,'))
        .map((src) => Buffer.from(src.split(',')[1], 'base64').toString());
    const patterned = svgs((await card(id)).images).filter((svg) =>
      svg.includes('viewBox="0 0 1200 630"')
    );
    expect(patterned).toHaveLength(1);
    // The wedding family is the wavy line; the date never reaches the card.
    expect(patterned[0]).toContain('S33');
    expect(patterned[0]).not.toContain('2000-06');

    const withBanner = await list({ occasion, bannerUrl: OWN_BANNER, slug: 'other-ab12c' });
    loadCardPhoto.mockResolvedValue({ status: 'ok', src: 'data:image/jpeg;base64,AAAA' });
    const shown = svgs((await card(withBanner)).images).filter((svg) =>
      svg.includes('viewBox="0 0 1200 630"')
    );
    expect(shown).toHaveLength(0);
  });

  // The gradient stands in, but the next fetch should try the photo again.
  it("don't cache a card whose banner couldn't be loaded", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = await list({ bannerUrl: OWN_BANNER });
    loadCardPhoto.mockResolvedValue({ status: 'failed' });
    const { text, images, res } = await card(id);
    expect(text).toContain('Secret Santa');
    expect(images.some((src) => src.startsWith('data:image/jpeg'))).toBe(false);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  // A write that lands while the card is drawn purges a cache this card isn't in
  // yet, so caching it would keep the old name for a day.
  it.each([
    ['the list is made private', () => ({ model: Wishlist, update: { visibility: 'private' } })],
    ['the list is renamed', () => ({ model: Wishlist, update: { name: 'Renamed' } })],
    ['its owner is renamed', () => ({ model: User, update: { username: 'renamed' } })],
  ])("don't cache a card when %s while it's drawn", async (_, change) => {
    const id = await list();
    const { model, update } = change();
    renderCard.mockImplementationOnce(async (element: ReactElement) => {
      rendered.push(element);
      const target = model === Wishlist ? id : owner;
      await (model as typeof Wishlist).updateOne({ _id: target }, { $set: update });
      return { body: new ArrayBuffer(8), contentType: 'image/jpeg' };
    });
    const { res } = await card(id);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it("don't cache a card when its data can't be checked again", async () => {
    const id = await list();
    vi.spyOn(Wishlist, 'exists').mockRejectedValue(new Error('db down'));
    const { text, res } = await card(id);
    expect(text).toContain('Secret Santa');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  // regression: a cold DB held the page (and the card) until the crawler gave
  // up, and it showed no preview at all.
  it('fall back to the generic preview when the list takes too long to read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = await list();
    resolveWishlistId.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const metadata = generateMetadata(params(id));
    await vi.advanceTimersByTimeAsync(METADATA_BUDGET_MS);
    expect(await metadata).toEqual({});

    const response = ShareCard(params(id)) as Promise<Response>;
    await vi.advanceTimersByTimeAsync(DATA_BUDGET_MS);
    const res = await response;
    expect(cardText(rendered.at(-1)!)).toContain('A wishlist');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  // An emoji or a script our fonts lack is fetched while the card draws.
  it('fall back to the generic card when drawing the list takes too long', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = await list();
    // Timers go fake only once the reads are done and the card starts drawing.
    let drawing = false;
    renderCard.mockImplementationOnce(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      drawing = true;
      return new Promise(() => {});
    });
    const response = ShareCard(params(id)) as Promise<Response>;
    while (!drawing) await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(RENDER_BUDGET_MS);
    const res = await response;
    expect(cardText(rendered.at(-1)!)).toContain('A wishlist');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it("fall back to the generic card when the list's card fails to draw", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = await list();
    renderCard.mockRejectedValueOnce(new Error('satori'));
    const { text, res } = await card(id);
    expect(text).toContain('A wishlist');
    expect(text.join(' ')).not.toContain('Secret Santa');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
