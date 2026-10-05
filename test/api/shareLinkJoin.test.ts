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
import { sendNotificationEmail } from '@/lib/email';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import { POST as JOIN } from '@/app/api/wishlists/[id]/join/route';
import { GET as LINKS } from '@/app/api/wishlists/[id]/links/route';
import { DELETE as KICK } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { PATCH as BOOK } from '@/app/api/items/[id]/route';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import WishlistJoinRequest from '@/models/WishlistJoinRequest';
import WishlistLinkBlock from '@/models/WishlistLinkBlock';
import Notification from '@/models/Notification';
import NotificationEmailClaim from '@/models/NotificationEmailClaim';
import Item from '@/models/Item';
import ShareLink from '@/models/ShareLink';
import { generateShareToken } from '@/lib/utils/shareLinks';
import { SHARE_TOKEN_HEADER } from '@/lib/utils/shareLinkFields';
import { blockFromShareLinks } from '@/lib/utils/linkBlocks';
import { addWishlistOwner, promoteMemberToOwner } from '@/lib/utils/wishlistOwnership';

/**
 * Joining a list straight from a Join share link (WIS-337):
 * `POST /api/wishlists/[id]/join` with `X-Share-Token`. Who may join through
 * which link, what a join settles, who's told, and the races with an archive,
 * a kick and a grant of ownership.
 */

const session = vi.mocked(auth);
const sendEmail = vi.mocked(sendNotificationEmail);

const NAMES = [
  'owner',
  'coOwner',
  'stranger',
  'friend',
  'member',
  'memberInvitee',
  'ownerInvitee',
  'requester',
  'declined',
  'kicked',
] as const;
type Name = (typeof NAMES)[number];
const ids = {} as Record<Name, string>;
let listId: string;
let otherListId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

const counted: string[] = [];
let refuse = new Set<string>();
const LIMITERS = [
  'shareLinkInvalid',
  'linkJoin',
  'linkJoin:new',
  'emailLinkJoin',
  'booking',
  'booking:new',
];
const countingLimiters = (): Partial<Record<string, RateLimiter>> =>
  Object.fromEntries(
    LIMITERS.map((name) => [
      name,
      {
        async limit() {
          counted.push(name);
          return {
            success: !refuse.has(name),
            reset: Date.now() + 60_000,
            limit: 30,
            remaining: 29,
          };
        },
      },
    ])
  );

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue(undefined);
  counted.length = 0;
  refuse = new Set();
  __setRateLimiters(countingLimiters());
  for (const name of NAMES) {
    const u = await User.create({ email: `${name}@x.com`, username: name });
    ids[name] = u._id.toString();
  }
  // Invite only: nobody outside it could open it without a link.
  const wl = await Wishlist.create({
    name: 'Wedding',
    slug: 'wedding',
    owners: [ids.owner, ids.coOwner],
    visibility: 'private',
  });
  listId = wl._id.toString();
  const other = await Wishlist.create({
    name: 'Other',
    owners: [ids.owner],
    visibility: 'private',
  });
  otherListId = other._id.toString();
  await WishlistMember.create({ wishlist: listId, user: ids.member });
  await Follow.create([
    { follower: ids.friend, following: ids.owner },
    { follower: ids.owner, following: ids.friend },
  ]);
  await WishlistInvite.create([
    { wishlist: listId, invitedBy: ids.owner, invitedUser: ids.memberInvitee, role: 'member' },
    { wishlist: listId, invitedBy: ids.owner, invitedUser: ids.ownerInvitee, role: 'owner' },
  ]);
  await WishlistJoinRequest.create([
    { wishlist: listId, user: ids.requester, status: 'pending' },
    { wishlist: listId, user: ids.declined, status: 'declined', declinedAt: new Date() },
  ]);
  await blockFromShareLinks(listId, ids.kicked);
  await Item.create({ wishlist: listId, name: 'Kettle', status: 'available' });
});

afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

async function link(
  level: 'view' | 'join' = 'join',
  {
    wishlist = listId,
    label = null,
    expiresAt = null,
  }: { wishlist?: string; label?: string | null; expiresAt?: Date | null } = {}
) {
  return ShareLink.create({
    wishlist,
    token: generateShareToken(),
    level,
    label,
    expiresAt,
    createdBy: ids.owner,
  });
}

function as(name: Name | null, extra: { newAccount?: boolean } = {}) {
  session.mockResolvedValue(
    name ? ({ user: { id: ids[name], username: name, ...extra } } as never) : (null as never)
  );
}

const params = <T>(p: T) => ({ params: Promise.resolve(p) });

async function join(token: string | null, id = listId) {
  const res = await JOIN(
    new NextRequest(`http://localhost/api/wishlists/${id}/join`, {
      method: 'POST',
      headers: token === null ? {} : { [SHARE_TOKEN_HEADER]: token },
    }),
    params({ id })
  );
  return { status: res.status, cache: res.headers.get('Cache-Control'), body: await res.json() };
}

const isMember = async (name: Name) =>
  !!(await WishlistMember.exists({ wishlist: listId, user: ids[name] }));

const NOT_FOUND = { success: false, error: 'Wishlist not found' };

type LinkState = 'liveJoin' | 'liveView' | 'revoked' | 'expired' | 'archived' | 'otherList';
const LINK_STATES: LinkState[] = [
  'liveJoin',
  'liveView',
  'revoked',
  'expired',
  'archived',
  'otherList',
];

async function tokenIn(state: LinkState): Promise<string> {
  switch (state) {
    case 'liveJoin':
      return (await link('join')).token;
    case 'liveView':
      return (await link('view')).token;
    case 'revoked': {
      const l = await link('join');
      await ShareLink.deleteOne({ _id: l._id });
      return l.token;
    }
    case 'expired':
      return (await link('join', { expiresAt: new Date(Date.now() - 1000) })).token;
    case 'archived': {
      const l = await link('join');
      await Wishlist.updateOne({ _id: listId }, { $set: { archived: true } });
      return l.token;
    }
    case 'otherList':
      return (await link('join', { wishlist: otherListId })).token;
  }
}

describe('who may join through which link', () => {
  const JOINERS: Name[] = [
    'stranger',
    'friend',
    'memberInvitee',
    'ownerInvitee',
    'requester',
    'declined',
  ];

  for (const state of LINK_STATES) {
    it(`signed out: 401 before any lookup (${state})`, async () => {
      const token = await tokenIn(state);
      as(null);
      const res = await join(token);
      expect(res.status).toBe(401);
      expect(res.cache).toBe('private, no-store');
      expect(counted).toEqual([]);
    });
  }

  for (const name of [...JOINERS, 'member', 'owner', 'kicked'] as Name[]) {
    for (const state of LINK_STATES.filter((s) => s !== 'liveJoin')) {
      it(`${name} through a ${state} link: the dead link's 404, nothing written`, async () => {
        const token = await tokenIn(state);
        const membersBefore = await WishlistMember.countDocuments();
        as(name);
        const res = await join(token);
        expect(res.status).toBe(404);
        expect(res.body).toEqual(NOT_FOUND);
        expect(res.cache).toBe('private, no-store');
        expect(await WishlistMember.countDocuments()).toBe(membersBefore);
        expect(await Notification.countDocuments({ type: 'link_join' })).toBe(0);
      });
    }
  }

  for (const name of JOINERS) {
    it(`${name} through a live Join link: joins as a member`, async () => {
      const { token, _id } = await link('join');
      as(name);
      const res = await join(token);
      expect(res.status).toBe(200);
      expect(res.cache).toBe('private, no-store');
      expect(res.body.data).toEqual({
        joined: true,
        alreadyMember: false,
        wishlistId: listId,
        wishlistSlug: 'wedding',
      });
      const row = await WishlistMember.findOne({ wishlist: listId, user: ids[name] }).lean();
      expect(row?.viaLink?.toString()).toBe(_id.toString());
      // Never an owner.
      const list = await Wishlist.findById(listId).lean();
      expect(list!.owners.map(String)).toEqual([ids.owner, ids.coOwner]);
    });
  }

  it('a member: 200, already on the list, nothing written or announced', async () => {
    const { token } = await link('join');
    as('member');
    const res = await join(token);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('You’re already on this list');
    expect(res.body.data.alreadyMember).toBe(true);
    const row = await WishlistMember.findOne({ wishlist: listId, user: ids.member }).lean();
    expect(row?.viaLink).toBeUndefined();
    expect(await Notification.countDocuments({ type: 'link_join' })).toBe(0);
    expect(counted).not.toContain('linkJoin');
  });

  it('an owner: 409, and no membership row', async () => {
    const { token } = await link('join');
    as('coOwner');
    const res = await join(token);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('You already own this list');
    expect(await isMember('coOwner')).toBe(false);
  });

  it('a kicked person: the dead link’s 404, spending the failed-lookup budget', async () => {
    const { token } = await link('join');
    as('kicked');
    const res = await join(token);
    expect(res).toMatchObject({ status: 404, body: NOT_FOUND });
    expect(counted).toEqual(['shareLinkInvalid']);
    expect(await isMember('kicked')).toBe(false);
  });

  it('a View link opens the list but never joins it', async () => {
    const { token } = await link('view');
    as('stranger');
    expect((await join(token)).status).toBe(404);
    expect(await isMember('stranger')).toBe(false);
  });

  it('no header, or a token of the wrong shape, is the 404 before any link lookup', async () => {
    as('stranger');
    expect(await join(null)).toMatchObject({ status: 404, body: NOT_FOUND });
    expect(counted).toEqual([]);
    const findOne = vi.spyOn(ShareLink, 'findOne');
    expect(await join('{"$ne":null}')).toMatchObject({ status: 404, body: NOT_FOUND });
    expect(findOne).not.toHaveBeenCalled();
    expect(counted).toEqual(['shareLinkInvalid']);
  });

  it('list A’s token on list B is the 404', async () => {
    const { token } = await link('join');
    as('stranger');
    expect((await join(token, otherListId)).status).toBe(404);
    expect(await WishlistMember.exists({ user: ids.stranger })).toBeNull();
  });

  it('is limited as linkJoin, on the new-account tier for a new account', async () => {
    const { token } = await link('join');
    as('stranger', { newAccount: true });
    refuse.add('linkJoin:new');
    const res = await join(token);
    expect(res.status).toBe(429);
    expect(res.cache).toBe('private, no-store');
    expect(await isMember('stranger')).toBe(false);
    as('friend', { newAccount: false });
    expect((await join(token)).status).toBe(200);
    expect(counted.filter((n) => n.startsWith('linkJoin'))).toEqual(['linkJoin:new', 'linkJoin']);
  });

  it('joining twice is idempotent: one row, one notification per owner', async () => {
    const { token } = await link('join');
    as('stranger');
    expect((await join(token)).body.data.alreadyMember).toBe(false);
    expect((await join(token)).body.data.alreadyMember).toBe(true);
    expect(await WishlistMember.countDocuments({ wishlist: listId, user: ids.stranger })).toBe(1);
    expect(await Notification.countDocuments({ type: 'link_join' })).toBe(2);
  });

  it('two joins at once make one row', async () => {
    const { token } = await link('join');
    as('stranger');
    const answers = await Promise.all([join(token), join(token)]);
    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(answers.filter((a) => a.body.data.alreadyMember === false)).toHaveLength(1);
    expect(await WishlistMember.countDocuments({ wishlist: listId, user: ids.stranger })).toBe(1);
  });
});

describe('what a join settles', () => {
  it('a pending member invite goes, with its notification, and nobody is told it was accepted', async () => {
    await Notification.create({
      user: ids.memberInvitee,
      type: 'wishlist_invite',
      wishlist: listId,
      wishlistName: 'Wedding',
    });
    const { token } = await link('join');
    as('memberInvitee');
    expect((await join(token)).status).toBe(200);
    expect(await WishlistInvite.exists({ invitedUser: ids.memberInvitee })).toBeNull();
    expect(
      await Notification.exists({ user: ids.memberInvitee, type: 'wishlist_invite' })
    ).toBeNull();
    expect(await Notification.exists({ type: 'invite_accepted' })).toBeNull();
  });

  it('a pending owner invite stays pending: a link never grants ownership', async () => {
    const { token } = await link('join');
    as('ownerInvitee');
    expect((await join(token)).status).toBe(200);
    const invite = await WishlistInvite.findOne({ invitedUser: ids.ownerInvitee }).lean();
    expect(invite?.status).toBe('pending');
    expect(invite?.role).toBe('owner');
    const list = await Wishlist.findById(listId).lean();
    expect(list!.owners.map(String)).not.toContain(ids.ownerInvitee);
  });

  it('a pending request to join ends, with the owners’ notifications about it', async () => {
    await Notification.create({
      user: ids.owner,
      type: 'join_request',
      actor: ids.requester,
      actorUsername: 'requester',
      wishlist: listId,
    });
    const { token } = await link('join');
    as('requester');
    expect((await join(token)).status).toBe(200);
    expect(await WishlistJoinRequest.exists({ user: ids.requester })).toBeNull();
    expect(await Notification.exists({ type: 'join_request' })).toBeNull();
  });

  it('a declined request doesn’t hold them off, and is marked withdrawn', async () => {
    const { token } = await link('join');
    as('declined');
    expect((await join(token)).status).toBe(200);
    expect(await isMember('declined')).toBe(true);
    const row = await WishlistJoinRequest.findOne({ user: ids.declined }).lean();
    expect(row?.withdrawn).toBe(true);
  });

  it('a new member can then reserve an item', async () => {
    const { token } = await link('join');
    as('stranger');
    await join(token);
    const item = await Item.findOne({ wishlist: listId });
    const res = await BOOK(
      new NextRequest(`http://localhost/api/items/${item!._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'booked' }),
      }),
      params({ id: item!._id.toString() })
    );
    expect(res.status).toBe(200);
    expect((await Item.findById(item!._id).lean())?.bookedBy?.toString()).toBe(ids.stranger);
  });
});

describe('booking on the new-account tier (WIS-337)', () => {
  const patch = (itemId: string, body: unknown) =>
    BOOK(
      new NextRequest(`http://localhost/api/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
      params({ id: itemId })
    );

  it('a new account’s reservation spends the stricter tier, and is refused over it', async () => {
    const item = await Item.findOne({ wishlist: listId });
    as('member', { newAccount: true });
    refuse.add('booking:new');
    expect((await patch(item!._id.toString(), { status: 'booked' })).status).toBe(429);
    expect((await Item.findById(item!._id).lean())?.status).toBe('available');
    expect(counted).toEqual(['booking:new']);
  });

  it('an owner editing their own item never does, however new the account', async () => {
    const item = await Item.findOne({ wishlist: listId });
    as('owner', { newAccount: true });
    refuse.add('booking:new');
    expect((await patch(item!._id.toString(), { name: 'Teapot' })).status).toBe(200);
    expect(counted).toEqual(['booking']);
  });
});

describe('the owners are told', () => {
  it('in-app, every owner, naming the joiner and the link’s label', async () => {
    const { token } = await link('join', { label: 'Family <b>chat</b>' });
    as('stranger');
    await join(token);
    const rows = await Notification.find({ type: 'link_join' }).lean();
    expect(rows.map((r) => r.user.toString()).sort()).toEqual([ids.owner, ids.coOwner].sort());
    for (const row of rows) {
      expect(row).toMatchObject({
        actorUsername: 'stranger',
        wishlistName: 'Wedding',
        wishlistSlug: 'wedding',
        linkLabel: 'Family <b>chat</b>',
      });
      expect(row.actor?.toString()).toBe(ids.stranger);
    }
    // Never the joiner, never a member.
    expect(await Notification.exists({ user: { $in: [ids.stranger, ids.member] } })).toBeNull();
  });

  it('by email at most once per list per owner a day, however many join', async () => {
    const { token } = await link('join');
    as('stranger');
    await join(token);
    as('friend');
    await join(token);
    // Two joins, two in-app rows each, but one email per owner.
    expect(await Notification.countDocuments({ type: 'link_join' })).toBe(4);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const [, details] = sendEmail.mock.calls[0];
    expect(details).toMatchObject({ type: 'link_join', actorUsername: 'stranger' });
    expect(await NotificationEmailClaim.countDocuments({ kind: 'link_join' })).toBe(2);
    expect(counted.filter((n) => n === 'emailLinkJoin')).toHaveLength(2);

    // A day later the next one goes out.
    await NotificationEmailClaim.updateMany(
      {},
      { $set: { sentAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } }
    );
    as('declined');
    await join(token);
    expect(sendEmail).toHaveBeenCalledTimes(4);
  });

  it('as each owner chose: off in app, off by email', async () => {
    await User.updateOne(
      { _id: ids.owner },
      { $set: { 'notificationPrefs.link_join.inApp': false } }
    );
    await User.updateOne(
      { _id: ids.coOwner },
      { $set: { 'notificationPrefs.link_join.email': false } }
    );
    const { token } = await link('join');
    as('stranger');
    await join(token);
    const rows = await Notification.find({ type: 'link_join' }).lean();
    expect(rows.map((r) => r.user.toString())).toEqual([ids.coOwner]);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][1]).toMatchObject({ recipientId: ids.owner });
  });

  it('nobody, for someone already on the list', async () => {
    const { token } = await link('join');
    as('member');
    await join(token);
    expect(await Notification.countDocuments({ type: 'link_join' })).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('the joined count', () => {
  it('counts the members each link brought, and only those still on the list', async () => {
    const a = await link('join', { label: 'A' });
    const b = await link('join', { label: 'B' });
    await link('view', { label: 'C' });
    as('stranger');
    await join(a.token);
    as('friend');
    await join(a.token);
    as('requester');
    await join(b.token);
    // One leaves: no longer counted.
    await WishlistMember.deleteOne({ wishlist: listId, user: ids.requester });

    as('owner');
    const res = await LINKS(
      new NextRequest(`http://localhost/api/wishlists/${listId}/links`),
      params({ id: listId })
    );
    const body = await res.json();
    const counts = Object.fromEntries(
      body.data.map((l: { label: string; joinedCount: number }) => [l.label, l.joinedCount])
    );
    expect(counts).toEqual({ A: 2, B: 0, C: 0 });
  });
});

describe('races: re-read after the membership is written', () => {
  /** Run `race` right after the join's membership upsert lands. */
  function afterUpsert(race: () => Promise<unknown>) {
    const original = WishlistMember.updateOne.bind(WishlistMember);
    vi.spyOn(WishlistMember, 'updateOne').mockImplementationOnce(((...args: unknown[]) =>
      (original as (...a: unknown[]) => Promise<unknown>)(...args).then(async (result) => {
        await race();
        return result;
      })) as never);
  }

  it('the list archived meanwhile: the row it made goes, 404', async () => {
    const { token } = await link('join');
    afterUpsert(() => Wishlist.updateOne({ _id: listId }, { $set: { archived: true } }));
    as('stranger');
    expect(await join(token)).toMatchObject({ status: 404, body: NOT_FOUND });
    expect(await isMember('stranger')).toBe(false);
    expect(await Notification.countDocuments({ type: 'link_join' })).toBe(0);
  });

  it('kicked meanwhile (block written before the re-read): the row goes, 404', async () => {
    const { token } = await link('join');
    afterUpsert(() => blockFromShareLinks(listId, ids.stranger));
    as('stranger');
    expect(await join(token)).toMatchObject({ status: 404, body: NOT_FOUND });
    expect(await isMember('stranger')).toBe(false);
  });

  // regression: WIS-338 left the join-vs-kick race open; a join that passed
  // the block check before the kick wrote it put the kicked member back.
  it('kicked meanwhile (block written after the join): the kick takes the row', async () => {
    const { token } = await link('join');
    const kicked = await WishlistMember.create({ wishlist: listId, user: ids.stranger });
    // The kick has deleted their membership; before its block is written, a
    // join through the link lands in full.
    const originalBlock = WishlistLinkBlock.updateOne.bind(WishlistLinkBlock);
    let joinAnswer: Awaited<ReturnType<typeof join>> | null = null;
    vi.spyOn(WishlistLinkBlock, 'updateOne').mockImplementationOnce(((...args: unknown[]) => {
      return (async () => {
        as('stranger');
        joinAnswer = await join(token);
        as('owner');
        return (originalBlock as (...a: unknown[]) => Promise<unknown>)(...args);
      })();
    }) as never);
    as('owner');
    const res = await KICK(
      new NextRequest(`http://localhost/api/wishlists/${listId}/members/${kicked._id}`, {
        method: 'DELETE',
      }),
      params({ id: listId, memberId: kicked._id.toString() })
    );
    expect(res.status).toBe(200);
    expect(joinAnswer!.status).toBe(200);
    expect(await isMember('stranger')).toBe(false);
    expect(await WishlistLinkBlock.exists({ wishlist: listId, user: ids.stranger })).not.toBeNull();
    // And they can't come back through it.
    as('stranger');
    expect((await join(token)).status).toBe(404);
  });

  it('a kick’s sweep never takes a membership from an invite', async () => {
    const membership = await WishlistMember.create({ wishlist: listId, user: ids.stranger });
    as('owner');
    await KICK(
      new NextRequest(`http://localhost/api/wishlists/${listId}/members/${membership._id}`, {
        method: 'DELETE',
      }),
      params({ id: listId, memberId: membership._id.toString() })
    );
    // `member` holds a row from an invite: untouched by anyone's kick.
    expect(await isMember('member')).toBe(true);
  });

  it('made an owner meanwhile by addWishlistOwner: the row goes, 409', async () => {
    const { token } = await link('join');
    // Only the ownership write, as a grant whose membership cleanup came first.
    afterUpsert(() => Wishlist.updateOne({ _id: listId }, { $addToSet: { owners: ids.stranger } }));
    as('stranger');
    const res = await join(token);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('You already own this list');
    expect(await isMember('stranger')).toBe(false);
    expect(await Notification.countDocuments({ type: 'link_join' })).toBe(0);
  });

  it('made an owner meanwhile by a full addWishlistOwner: no member row left', async () => {
    const { token } = await link('join');
    afterUpsert(async () => addWishlistOwner((await Wishlist.findById(listId))!, ids.stranger));
    as('stranger');
    expect((await join(token)).status).toBe(409);
    expect(await isMember('stranger')).toBe(false);
    const list = await Wishlist.findById(listId).lean();
    expect(list!.owners.map(String)).toContain(ids.stranger);
  });

  it('promoted meanwhile by promoteMemberToOwner: an owner, no member row, 409', async () => {
    const { token } = await link('join');
    afterUpsert(async () => promoteMemberToOwner((await Wishlist.findById(listId))!, ids.stranger));
    as('stranger');
    expect((await join(token)).status).toBe(409);
    expect(await isMember('stranger')).toBe(false);
    const list = await Wishlist.findById(listId).lean();
    expect(list!.owners.map(String)).toContain(ids.stranger);
  });

  it('the list deleted meanwhile: the row goes, 404', async () => {
    const { token } = await link('join');
    afterUpsert(() => Wishlist.deleteOne({ _id: listId }));
    as('stranger');
    expect((await join(token)).status).toBe(404);
    expect(await WishlistMember.exists({ user: ids.stranger })).toBeNull();
  });

  it('only ever takes the row it made', async () => {
    // A membership that appeared between the checks and the upsert (an invite
    // accepted in another tab) is theirs, not this join's.
    const { token } = await link('join');
    const original = WishlistMember.updateOne.bind(WishlistMember);
    vi.spyOn(WishlistMember, 'updateOne').mockImplementationOnce(((...args: unknown[]) =>
      WishlistMember.create({ wishlist: listId, user: ids.stranger }).then(() =>
        (original as (...a: unknown[]) => Promise<unknown>)(...args)
      )) as never);
    as('stranger');
    const res = await join(token);
    expect(res.body.data?.alreadyMember).toBe(true);
    expect(await isMember('stranger')).toBe(true);
  });
});
