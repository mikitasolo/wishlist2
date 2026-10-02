import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
// Keeps the share card's element tree instead of rendering it to a PNG.
vi.mock('next/og', () => ({
  ImageResponse: class {
    constructor(readonly element: unknown) {}
  },
}));

import { generateMetadata } from '@/app/wishlists/[id]/layout';
import ShareCard from '@/app/wishlists/[id]/opengraph-image';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';

/**
 * Crawlers fetch a list's share metadata and share card signed out, so both may
 * reveal its name only when a signed-out visitor could open it
 * (`getWishlistViewAccess`): public, and not archived. Every other list gets a
 * generic preview.
 */

let owner: mongoose.Types.ObjectId;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  owner = (await User.create({ email: 'owner@x.com', username: 'owner' }))._id;
});

async function list(fields: Record<string, unknown>) {
  const wl = await Wishlist.create({ name: 'Secret Santa', owners: [owner], ...fields });
  return wl._id.toString();
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Every piece of text on the share card. */
function cardText(node: unknown): string[] {
  if (node == null || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(cardText);
  return cardText((node as { props?: { children?: unknown } }).props?.children);
}

async function preview(id: string) {
  const metadata = await generateMetadata(params(id));
  const card = (await ShareCard(params(id))) as unknown as { element: unknown };
  return { title: metadata.title, card: cardText(card.element) };
}

describe('wishlist share metadata and share card', () => {
  it('name a public list and its owner', async () => {
    const id = await list({ visibility: 'everyone', isPublic: true, archived: false });
    const { title, card } = await preview(id);
    expect(title).toBe('Secret Santa');
    expect(card).toContain('Secret Santa');
    expect(card.join(' ')).toContain('@owner');
  });

  it.each([
    ['a friends-only list', { visibility: 'friends', isPublic: false }],
    ['a private list', { visibility: 'private', isPublic: false }],
    ['an archived public list', { visibility: 'everyone', isPublic: true, archived: true }],
  ])('never name %s', async (_, fields) => {
    const id = await list(fields);
    const { title, card } = await preview(id);
    expect(title).toBeUndefined();
    expect(card).not.toContain('Secret Santa');
    expect(card).toContain('A private wishlist');
  });
});
