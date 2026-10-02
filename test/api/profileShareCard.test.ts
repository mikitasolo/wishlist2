import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { cardImages, cardText } from '../ogCards';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
// Keeps each card's element tree instead of drawing it.
const { rendered, renderCard, loadCardPhoto } = vi.hoisted(() => ({
  rendered: [] as ReactElement[],
  renderCard: vi.fn(),
  loadCardPhoto: vi.fn(),
}));
vi.mock('@/lib/og/render', () => ({ renderCardImage: renderCard }));
vi.mock('@/lib/og/photo', () => ({ loadCardPhoto }));

import { generateMetadata } from '@/app/users/[username]/layout';
import ShareCard from '@/app/users/[username]/opengraph-image';
import { DATA_BUDGET_MS } from '@/lib/og/shareCards';
import { METADATA_BUDGET_MS } from '@/lib/utils/og';
import User from '@/models/User';

/**
 * A profile's preview shows what any signed-out visitor sees on it: the
 * username and avatar always, the bio only when the profile isn't friends-only.
 */

const BIO = 'I collect mugs and very small plants.';
const AVATAR = 'https://store.public.blob.vercel-storage.com/uploads/u/avatar.webp';
let userId: string;

beforeAll(connectTestDB);
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
  userId = (await User.create({ email: 'mia@x.com', username: 'mia', bio: BIO }))._id.toString();
  // A minute back, so a write a test makes is told from the user's creation even
  // when both land in the same millisecond.
  await User.updateOne(
    { _id: userId },
    { $set: { updatedAt: new Date(Date.now() - 60_000) } },
    { timestamps: false }
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const params = (username: string) => ({ params: Promise.resolve({ username }) });

async function preview(username: string) {
  const metadata = await generateMetadata(params(username));
  const res = (await ShareCard(params(username))) as Response;
  const element = rendered.at(-1)!;
  return { metadata, res, text: cardText(element), images: cardImages(element) };
}

describe('profile share metadata and share card', () => {
  it('show the username and a public bio', async () => {
    const { metadata, text } = await preview('mia');
    expect(metadata.title).toBe('@mia');
    expect(metadata.description).toBe(BIO);
    expect(metadata.openGraph).toMatchObject({ title: '@mia on Wishlist', url: '/users/mia' });
    expect(text).toContain('@mia');
    expect(text).toContain(BIO);
    // No avatar: the initial stands in.
    expect(text).toContain('M');
  });

  it('describe the profile in our own words when the bio is too short to', async () => {
    await User.updateOne({ _id: userId }, { $set: { bio: 'Hi!' } });
    const { metadata, text } = await preview('mia');
    expect(metadata.description).toMatch(/^See @mia’s wishlists on Wishlist/);
    expect(text).toContain('Hi!');
  });

  it('never show the bio of a friends-only profile', async () => {
    await User.updateOne({ _id: userId }, { $set: { 'privacy.profileVisibility': 'friends' } });
    const { metadata, text } = await preview('mia');
    expect(metadata.title).toBe('@mia');
    expect(metadata.description).not.toContain('mugs');
    expect(text.join(' ')).not.toContain('mugs');
    expect(text).toContain('on Wishlist');
  });

  it('draw the avatar', async () => {
    await User.updateOne({ _id: userId }, { $set: { image: AVATAR } });
    loadCardPhoto.mockResolvedValue({ status: 'ok', src: 'data:image/jpeg;base64,AAAA' });
    const { images } = await preview('mia');
    expect(loadCardPhoto).toHaveBeenCalledWith(AVATAR, { width: 184, height: 184 });
    expect(images).toContain('data:image/jpeg;base64,AAAA');
  });

  it("let the CDN keep a profile's card for a day, under the user's tag", async () => {
    const { res } = await preview('mia');
    expect(res.headers.get('Vercel-CDN-Cache-Control')).toBe('public, max-age=86400');
    expect(res.headers.get('Vercel-Cache-Tag')).toBe(`og-user-${userId}`);
  });

  it("don't cache a card whose avatar couldn't be loaded", async () => {
    await User.updateOne({ _id: userId }, { $set: { image: AVATAR } });
    loadCardPhoto.mockResolvedValue({ status: 'failed' });
    const { res, text } = await preview('mia');
    expect(text).toContain('@mia');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it("don't cache a card when the user changes their profile while it's drawn", async () => {
    renderCard.mockImplementationOnce(async (element: ReactElement) => {
      rendered.push(element);
      await User.updateOne({ _id: userId }, { $set: { 'privacy.profileVisibility': 'friends' } });
      return { body: new ArrayBuffer(8), contentType: 'image/jpeg' };
    });
    const res = (await ShareCard(params('mia'))) as Response;
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vercel-Cache-Tag')).toBeNull();
  });

  it("don't cache a card when its data can't be checked again", async () => {
    vi.spyOn(User, 'exists').mockRejectedValue(new Error('db down'));
    const { res, text } = await preview('mia');
    expect(text).toContain('@mia');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it("fall back to the default card when the profile's card fails to draw", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderCard.mockRejectedValueOnce(new Error('satori'));
    const res = (await ShareCard(params('mia'))) as Response;
    const text = cardText(rendered.at(-1)!);
    expect(text).toContain('Share lists. Gift without spoilers.');
    expect(text.join(' ')).not.toContain('@mia');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('give a username that matches no one the default card, uncached', async () => {
    const { metadata, res, text } = await preview('nobody');
    expect(metadata).toEqual({});
    expect(text).toContain('Share lists. Gift without spoilers.');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(loadCardPhoto).not.toHaveBeenCalled();
  });

  // regression: a cold DB held the page (and the card) until the crawler gave
  // up, and it showed no preview at all.
  it('fall back to the defaults when the profile takes too long to read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(User, 'findOne').mockReturnValue({
      select: () => ({ lean: () => new Promise(() => {}) }),
    } as never);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const metadata = generateMetadata(params('mia'));
    await vi.advanceTimersByTimeAsync(METADATA_BUDGET_MS);
    expect(await metadata).toEqual({});

    const response = ShareCard(params('mia')) as Promise<Response>;
    await vi.advanceTimersByTimeAsync(DATA_BUDGET_MS);
    const res = await response;
    expect(cardText(rendered.at(-1)!)).toContain('Share lists. Gift without spoilers.');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
