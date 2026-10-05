import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
  sendWishlistInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['USD', 1]]) }),
  convertToUsdCents: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import { GET as GET_WISHLIST } from '@/app/api/wishlists/[id]/route';
import { GET as LIST_ITEMS } from '@/app/api/wishlists/[id]/items/route';
import { POST as ASK } from '@/app/api/wishlists/[id]/requests/route';
import { GET as MY_REQUEST } from '@/app/api/wishlists/[id]/requests/me/route';
import { DELETE as KICK } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { DELETE as LEAVE } from '@/app/api/wishlists/[id]/members/me/route';
import {
  PATCH as DEMOTE,
  DELETE as REMOVE_OWNER,
} from '@/app/api/wishlists/[id]/owners/[userId]/route';
import { PATCH as ANSWER_INVITE } from '@/app/api/invites/[inviteId]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import WishlistLinkBlock from '@/models/WishlistLinkBlock';
import Item from '@/models/Item';
import ShareLink from '@/models/ShareLink';
import { generateShareToken } from '@/lib/utils/shareLinks';
import { SHARE_TOKEN_HEADER } from '@/lib/utils/shareLinkFields';
import { blockFromShareLinks, isBlockedFromShareLinks } from '@/lib/utils/linkBlocks';
import { deleteOwnedWishlist } from '@/lib/utils/wishlistDeletion';
import { deleteAccount } from '@/lib/utils/accountDeletion';

/**
 * People kicked from a list are kept out of its share links (WIS-338): a kick
 * writes a `WishlistLinkBlock`, and every link of that list then answers them,
 * signed in, exactly as a revoked link does, View and Join alike. Leaving and
 * demotion write none; accepting an owner's invite lifts it; the list's and
 * the account's deletion take the rows with them.
 */

const session = vi.mocked(auth);

const NAMES = ['owner', 'coOwner', 'kicked', 'other'] as const;
type Name = (typeof NAMES)[number];
const ids = {} as Record<Name, string>;
let listId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

const counted: string[] = [];
const countingLimiters = (): Partial<Record<string, RateLimiter>> =>
  Object.fromEntries(
    ['shareLinkInvalid', 'joinRequest', 'joinRequest:new'].map((name) => [
      name,
      {
        async limit() {
          counted.push(name);
          return { success: true, reset: Date.now() + 60_000, limit: 30, remaining: 29 };
        },
      },
    ])
  );

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  counted.length = 0;
  __setRateLimiters(countingLimiters());
  for (const name of NAMES) {
    const u = await User.create({ email: `${name}@x.com`, username: name });
    ids[name] = u._id.toString();
  }
  // Invite only, so nobody but its people could open it without a link.
  const wl = await Wishlist.create({
    name: 'Wedding',
    owners: [ids.owner, ids.coOwner],
    visibility: 'private',
  });
  listId = wl._id.toString();
  await WishlistMember.create([
    { wishlist: listId, user: ids.kicked },
    { wishlist: listId, user: ids.other },
  ]);
  await Item.create({ wishlist: listId, name: 'Kettle', status: 'available' });
});

afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

async function link(level: 'view' | 'join' = 'view', wishlist = listId) {
  const doc = await ShareLink.create({
    wishlist,
    token: generateShareToken(),
    level,
    createdBy: ids.owner,
  });
  return doc.token;
}

function as(name: Name | null) {
  session.mockResolvedValue(name ? ({ user: { id: ids[name] } } as never) : (null as never));
}

const req = (path: string, init: { method?: string; token?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: init.token ? { [SHARE_TOKEN_HEADER]: init.token } : {},
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });

const params = <T>(p: T) => ({ params: Promise.resolve(p) });

/** Every link-mode read and ask, by `viewer`, with `token`: their statuses and bodies. */
async function throughLink(viewer: Name | null, token: string) {
  const answers = [];
  as(viewer);
  answers.push(
    await GET_WISHLIST(req(`/api/wishlists/${listId}`, { token }), params({ id: listId }))
  );
  answers.push(
    await LIST_ITEMS(req(`/api/wishlists/${listId}/items`, { token }), params({ id: listId }))
  );
  if (viewer) {
    answers.push(
      await MY_REQUEST(
        req(`/api/wishlists/${listId}/requests/me`, { token }),
        params({ id: listId })
      )
    );
    answers.push(
      await ASK(
        req(`/api/wishlists/${listId}/requests`, { method: 'POST', token }),
        params({ id: listId })
      )
    );
  }
  return Promise.all(
    answers.map(async (res) => ({
      status: res.status,
      cache: res.headers.get('Cache-Control'),
      body: await res.json(),
    }))
  );
}

async function kick(userName: Name, by: Name = 'owner') {
  const membership = await WishlistMember.findOne({ wishlist: listId, user: ids[userName] });
  as(by);
  return KICK(
    req(`/api/wishlists/${listId}/members/${membership!._id}`, { method: 'DELETE' }),
    params({ id: listId, memberId: membership!._id.toString() })
  );
}

const blocked = (name: Name) => isBlockedFromShareLinks(listId, ids[name]);

describe('a kick keeps the person out of the list’s share links', () => {
  it('writes a block once the kick removed them', async () => {
    const res = await kick('kicked');
    expect(res.status).toBe(200);
    expect(await WishlistMember.exists({ wishlist: listId, user: ids.kicked })).toBeNull();
    expect(await blocked('kicked')).toBe(true);
    expect(await blocked('other')).toBe(false);
  });

  for (const level of ['view', 'join'] as const) {
    it(`answers them through a live ${level} link exactly as through a revoked one`, async () => {
      const live = await link(level);
      const revoked = await link(level);
      await ShareLink.deleteOne({ token: revoked });
      await kick('kicked');

      const deadAnswers = await throughLink('kicked', revoked);
      counted.length = 0;
      const blockedAnswers = await throughLink('kicked', live);

      expect(blockedAnswers).toEqual(deadAnswers);
      for (const answer of blockedAnswers) {
        expect(answer.status).toBe(404);
        expect(answer.body).toEqual({ success: false, error: 'Wishlist not found' });
        expect(answer.cache).toBe('private, no-store');
      }
      // Even the failed-lookup budget is spent as a dead link's is.
      expect(counted.filter((n) => n === 'shareLinkInvalid')).toHaveLength(4);
      // No request to join was written.
      const asks = await import('@/models/WishlistJoinRequest').then((m) =>
        m.default.countDocuments({ wishlist: listId })
      );
      expect(asks).toBe(0);
    });
  }

  it('affects nobody else: another signed-in person and a signed-out visitor still get in', async () => {
    const token = await link();
    await kick('kicked');
    await WishlistMember.deleteOne({ wishlist: listId, user: ids.other });

    for (const answer of await throughLink('other', token)) {
      expect(answer.status).toBeLessThan(400);
    }
    // Signed out, the kicked person is anyone holding the link (a block is per account).
    for (const answer of await throughLink(null, token)) expect(answer.status).toBe(200);
  });

  it('is per list: the person still gets in through another list’s link', async () => {
    const other = await Wishlist.create({
      name: 'Other',
      owners: [ids.owner],
      visibility: 'private',
    });
    const token = await link('view', other._id.toString());
    await kick('kicked');
    as('kicked');
    const res = await GET_WISHLIST(
      req(`/api/wishlists/${other._id}`, { token }),
      params({ id: other._id.toString() })
    );
    expect(res.status).toBe(200);
  });

  it('regression: a lost kick (they had already left) blocks nobody', async () => {
    const membership = await WishlistMember.findOne({ wishlist: listId, user: ids.kicked });
    await WishlistMember.deleteOne({ _id: membership!._id });
    as('owner');
    const res = await KICK(
      req(`/api/wishlists/${listId}/members/${membership!._id}`, { method: 'DELETE' }),
      params({ id: listId, memberId: membership!._id.toString() })
    );
    expect(res.status).toBe(404);
    expect(await blocked('kicked')).toBe(false);
  });

  // regression: the block was written straight after the membership delete, so
  // a failed write skipped releaseLateBookings and left a late booking that
  // nobody could release.
  it('regression: a failed block write still frees a booking that landed during the kick', async () => {
    const item = await Item.findOne({ wishlist: listId });
    const realDelete = WishlistMember.deleteOne.bind(WishlistMember);
    vi.spyOn(WishlistMember, 'deleteOne').mockImplementation(((filter: object) =>
      realDelete(filter).then(async (result) => {
        // A booking that checked their membership before the delete lands now.
        await Item.updateOne(
          { _id: item!._id },
          { $set: { status: 'booked', bookedBy: ids.kicked } }
        );
        return result;
      })) as never);
    vi.spyOn(WishlistLinkBlock, 'updateOne').mockRejectedValue(new Error('db down') as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await kick('kicked');

    expect(res.status).toBe(500);
    const after = await Item.findById(item!._id).lean();
    expect(after!.status).toBe('available');
    expect(after!.bookedBy ?? null).toBeNull();
  });

  it('two kicks at once leave one block and no error', async () => {
    await Promise.all([
      blockFromShareLinks(listId, ids.kicked),
      blockFromShareLinks(listId, ids.kicked),
      blockFromShareLinks(listId, ids.kicked),
    ]);
    expect(await WishlistLinkBlock.countDocuments({ wishlist: listId, user: ids.kicked })).toBe(1);
  });

  it('a block that lands after a link was resolved is still found by the next read', async () => {
    // The re-check a link join (WIS-337) makes after its upsert: the block is
    // visible to any read once the kick's write has landed.
    expect(await blocked('kicked')).toBe(false);
    await kick('kicked');
    expect(await blocked('kicked')).toBe(true);
  });
});

describe('only a kick blocks', () => {
  it('leaving of your own accord writes no block', async () => {
    as('kicked');
    const res = await LEAVE(
      req(`/api/wishlists/${listId}/members/me`, { method: 'DELETE' }),
      params({ id: listId })
    );
    expect(res.status).toBe(200);
    expect(await blocked('kicked')).toBe(false);
    expect(await WishlistLinkBlock.countDocuments()).toBe(0);
  });

  it('making an owner a member writes no block', async () => {
    as('owner');
    const res = await DEMOTE(
      req(`/api/wishlists/${listId}/owners/${ids.coOwner}`, { method: 'PATCH' }),
      params({ id: listId, userId: ids.coOwner })
    );
    expect(res.status).toBe(200);
    expect(await WishlistLinkBlock.countDocuments()).toBe(0);
  });

  it('removing an owner writes no block, and their links keep working for them', async () => {
    const token = await link();
    as('owner');
    const res = await REMOVE_OWNER(
      req(`/api/wishlists/${listId}/owners/${ids.coOwner}`, { method: 'DELETE' }),
      params({ id: listId, userId: ids.coOwner })
    );
    expect(res.status).toBe(200);
    expect(await WishlistLinkBlock.countDocuments()).toBe(0);
    as('coOwner');
    const read = await GET_WISHLIST(
      req(`/api/wishlists/${listId}`, { token }),
      params({ id: listId })
    );
    expect(read.status).toBe(200);
  });
});

describe('an owner’s invite brings a kicked person back', () => {
  for (const role of ['member', 'owner'] as const) {
    it(`accepting a ${role} invite lifts the block, and the link works again`, async () => {
      const token = await link('join');
      await kick('kicked');
      const invite = await WishlistInvite.create({
        wishlist: listId,
        invitedBy: ids.owner,
        invitedUser: ids.kicked,
        role,
        status: 'pending',
      });
      as('kicked');
      const res = await ANSWER_INVITE(
        req(`/api/invites/${invite._id}`, { method: 'PATCH', body: { action: 'accept' } }),
        params({ inviteId: invite._id.toString() })
      );
      expect(res.status).toBe(200);
      expect(await blocked('kicked')).toBe(false);

      as('kicked');
      const read = await GET_WISHLIST(
        req(`/api/wishlists/${listId}`, { token }),
        params({ id: listId })
      );
      expect(read.status).toBe(200);
      expect((await read.json()).data.userRole).toBe(role);
    });
  }

  it('declining an invite keeps the block', async () => {
    await kick('kicked');
    const invite = await WishlistInvite.create({
      wishlist: listId,
      invitedBy: ids.owner,
      invitedUser: ids.kicked,
      role: 'member',
      status: 'pending',
    });
    as('kicked');
    await ANSWER_INVITE(
      req(`/api/invites/${invite._id}`, { method: 'PATCH', body: { action: 'decline' } }),
      params({ inviteId: invite._id.toString() })
    );
    expect(await blocked('kicked')).toBe(true);
  });
});

describe('cascades', () => {
  it('deleting the list deletes its blocks, and no other list’s', async () => {
    const other = await Wishlist.create({
      name: 'Other',
      owners: [ids.owner],
      visibility: 'private',
    });
    await blockFromShareLinks(listId, ids.kicked);
    await blockFromShareLinks(other._id, ids.kicked);

    expect(await deleteOwnedWishlist(listId, ids.owner)).not.toBeNull();

    expect(await WishlistLinkBlock.countDocuments({ wishlist: listId })).toBe(0);
    expect(await WishlistLinkBlock.countDocuments({ wishlist: other._id })).toBe(1);
  });

  it('deleting an account deletes the blocks about it, and nobody else’s', async () => {
    await blockFromShareLinks(listId, ids.kicked);
    await blockFromShareLinks(listId, ids.other);

    expect(await deleteAccount(ids.kicked, { agreedListIds: [] })).toBe('deleted');

    expect(await WishlistLinkBlock.countDocuments({ user: ids.kicked })).toBe(0);
    expect(await WishlistLinkBlock.countDocuments({ user: ids.other })).toBe(1);
  });
});
