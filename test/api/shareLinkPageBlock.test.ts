import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
// The page's own parts: only which one it picks matters here.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ShareLinkUnavailable', () => ({ default: () => null }));
vi.mock('@/components/WishlistPage', () => ({ default: () => null }));

import { auth } from '@/lib/auth';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import ShareLinkPage from '@/app/l/[token]/page';
import ShareLinkUnavailable from '@/components/ShareLinkUnavailable';
import WishlistPage from '@/components/WishlistPage';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import ShareLink from '@/models/ShareLink';
import { generateShareToken } from '@/lib/utils/shareLinks';
import { blockFromShareLinks } from '@/lib/utils/linkBlocks';

/**
 * The `/l/<token>` page answers a signed-in person kicked from the list with
 * the same dead state as a revoked link (WIS-338), on the server, before any
 * of the list's page is drawn. Signed out, or anyone else, sees the list.
 */

const session = vi.mocked(auth);
let listId: string;
let kickedId: string;
let otherId: string;
const counted: string[] = [];

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  counted.length = 0;
  __setRateLimiters({
    shareLinkInvalid: {
      async limit() {
        counted.push('shareLinkInvalid');
        return { success: true, reset: Date.now() + 60_000, limit: 30, remaining: 29 };
      },
    } as RateLimiter,
  });
  const owner = await User.create({ email: 'o@x.com', username: 'owner' });
  kickedId = (await User.create({ email: 'k@x.com', username: 'kicked' }))._id.toString();
  otherId = (await User.create({ email: 'n@x.com', username: 'other' }))._id.toString();
  const wl = await Wishlist.create({ name: 'Wedding', owners: [owner._id], visibility: 'private' });
  listId = wl._id.toString();
  await blockFromShareLinks(listId, kickedId);
});

afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

async function render(token: string) {
  const tree = (await ShareLinkPage({
    params: Promise.resolve({ token }),
    searchParams: Promise.resolve({}),
  })) as ReactElement;
  expect(isValidElement(tree)).toBe(true);
  return tree;
}

/** Whether the page drew the dead state (anywhere in its tree) rather than the list. */
function isDead(tree: ReactElement): boolean {
  if (tree.type === WishlistPage) return false;
  const walk = (node: unknown): boolean => {
    if (!isValidElement(node)) return Array.isArray(node) && node.some(walk);
    if (node.type === ShareLinkUnavailable) return true;
    return walk((node.props as { children?: unknown }).children);
  };
  return walk(tree);
}

async function liveToken() {
  const doc = await ShareLink.create({
    wishlist: listId,
    token: generateShareToken(),
    level: 'join',
  });
  return doc.token;
}

describe('the share link page for someone kicked from the list', () => {
  it('shows a kicked person, signed in, the dead state, as a revoked link does', async () => {
    const token = await liveToken();
    const revoked = await liveToken();
    await ShareLink.deleteOne({ token: revoked });

    session.mockResolvedValue({ user: { id: kickedId } } as never);
    expect(isDead(await render(token))).toBe(true);
    expect(isDead(await render(revoked))).toBe(true);
    // Both spent the failed-lookup budget alike.
    expect(counted).toEqual(['shareLinkInvalid', 'shareLinkInvalid']);
  });

  it('shows the list to anyone else signed in, and to a signed-out visitor', async () => {
    const token = await liveToken();
    session.mockResolvedValue({ user: { id: otherId } } as never);
    expect(isDead(await render(token))).toBe(false);
    session.mockResolvedValue(null as never);
    expect(isDead(await render(token))).toBe(false);
    expect(counted).toEqual([]);
  });

  it('reads no session for a dead link', async () => {
    session.mockResolvedValue({ user: { id: otherId } } as never);
    expect(isDead(await render(generateShareToken()))).toBe(true);
    expect(session).not.toHaveBeenCalled();
  });

  it('lets the page render when the session can’t be read (its reads refuse a kicked person)', async () => {
    const token = await liveToken();
    session.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(isDead(await render(token))).toBe(false);
  });
});

/** The `visitorView` the page handed `WishlistPage`, if it drew the list. */
function visitorViewOf(tree: ReactElement): unknown {
  expect(tree.type).toBe(WishlistPage);
  return (tree.props as { address: { visitorView?: unknown } }).address.visitorView;
}

describe('the share link page’s server-drawn top for a signed-out visitor (WIS-447)', () => {
  it('reads the list’s top for a signed-out visitor: usernames, never an email or the token', async () => {
    const token = await liveToken();
    const coOwner = await User.create({ email: 'c@x.com', username: 'co_owner' });
    await Wishlist.updateOne(
      { _id: listId },
      {
        $set: { description: 'For the big day', bannerUrl: 'https://example.com/b.webp' },
        $push: { owners: coOwner._id },
      }
    );
    await Wishlist.updateOne(
      { _id: listId },
      { $set: { occasion: { kind: 'wedding', date: '2027-06-12', recurrence: null } } }
    );
    session.mockResolvedValue(null as never);
    const view = visitorViewOf(await render(token));
    expect(view).toEqual({
      name: 'Wedding',
      ownerUsernames: ['owner', 'co_owner'],
      ownerCount: 2,
      occasion: { kind: 'wedding', date: '2027-06-12', recurrence: null },
      visibility: 'private',
      bannerUrl: 'https://example.com/b.webp',
      description: 'For the big day',
      todayHint: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    const text = JSON.stringify(view);
    expect(text).not.toContain('@x.com');
    expect(text).not.toContain(token);
  });

  it('draws nothing on the server for anyone signed in, who may be an owner or member', async () => {
    const token = await liveToken();
    session.mockResolvedValue({ user: { id: otherId } } as never);
    expect(visitorViewOf(await render(token))).toBeUndefined();
  });

  it('draws nothing on the server when the session can’t be read', async () => {
    const token = await liveToken();
    session.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(visitorViewOf(await render(token))).toBeUndefined();
  });

  it('draws nothing on the server for Preview as visitor, which only an owner is offered', async () => {
    const token = await liveToken();
    session.mockResolvedValue(null as never);
    const tree = (await ShareLinkPage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({ as: 'visitor' }),
    })) as ReactElement;
    expect(visitorViewOf(tree)).toBeUndefined();
  });
});
