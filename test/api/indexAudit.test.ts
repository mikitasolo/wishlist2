import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB } from '../db';

// WIS-377: the hot queries must each be answered from an index, never a full
// collection scan. Rather than copy every query into this file (where it would
// drift from the code), each scenario runs the real code path (route handlers,
// helpers, crons) against seeded data with MongoDB's profiler on, then reads
// back the plan summary of every operation it ran: any `COLLSCAN` fails the
// scenario, naming the collection and the filter. The profiler records the
// same plan `explain()` picks, for every find, aggregate, count, distinct,
// update and delete the code sent.
//
// What it doesn't see: the inner reads of an aggregation's `$lookup` (only the
// outer plan is recorded; every `$lookup` today joins on `_id`), and an index
// read end to end (an unanchored regex, such as search's username match, walks
// the whole username index: no documents, but every key).

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendNotificationEmail: vi.fn(),
  sendBirthdayNudgeEmail: vi.fn(),
  sendWishlistInvitationEmail: vi.fn(),
}));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({
    rates: new Map([
      ['usd', 1],
      ['eur', 0.9],
    ]),
  }),
  convertToUsdCents: vi.fn(),
}));
vi.mock('@/lib/og/purge', () => ({ purgeShareCards: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: vi.fn() }));
vi.mock('@vercel/blob', () => ({ copy: vi.fn(), del: vi.fn(), list: vi.fn(), put: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET as SEARCH } from '@/app/api/search/route';
import { GET as ITEMS } from '@/app/api/wishlists/[id]/items/route';
import { GET as WISHLIST } from '@/app/api/wishlists/[id]/route';
import { GET as MY_WISHLISTS } from '@/app/api/wishlists/route';
import { GET as BIRTHDAYS } from '@/app/api/users/me/birthdays/route';
import { GET as MY_INVITES } from '@/app/api/users/me/invites/route';
import { GET as ME } from '@/app/api/users/me/route';
import { GET as MY_ITEMS } from '@/app/api/users/me/items/route';
import { GET as MY_GIFTS } from '@/app/api/users/me/gifts/route';
import { GET as PROFILE_LISTS } from '@/app/api/users/[id]/wishlists/route';
import { GET as FEED } from '@/app/api/notifications/route';
import { GET as RESERVATIONS } from '@/app/api/users/me/reservations/route';
import { GET as RESERVATION_SUMMARY } from '@/app/api/users/me/reservations/summary/route';
import { PATCH as PATCH_ITEM } from '@/app/api/items/[id]/route';
import { POST as START_GIFT } from '@/app/api/items/[id]/group-gift/route';
import { PUT as JOIN_GIFT } from '@/app/api/items/[id]/group-gift/me/route';
import { viewableWishlistsFilter } from '@/lib/utils/wishlistAccess';
import { generateShareToken, resolveShareLink } from '@/lib/utils/shareLinks';
import { sendOccasionReminders } from '@/lib/utils/occasionReminders';
import { sendGiftReminders } from '@/lib/utils/giftReminders';
import { runBirthdayTasks } from '@/lib/utils/birthdayCron';
import { liveGiftOf, holdsItem, readGroupGiftSummaries } from '@/lib/utils/groupGifts';
import {
  ITEM_BATCH_STALE_MS,
  settleAllDeadMoves,
  settleDeadMoves,
} from '@/lib/utils/bulkItemActions';
import ItemBatch from '@/models/ItemBatch';
import { fitItemTags, listTagsOverCap } from '@/lib/utils/itemTagWrites';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Item from '@/models/Item';
import ShareLink from '@/models/ShareLink';
import Notification from '@/models/Notification';
import '@/models/GroupGift';
import '@/models/Reservation';
import '@/models/GiftLog';
import '@/models/NotificationEmailClaim';
import '@/models/WishlistJoinRequest';
import '@/models/WishlistAsk';
import '@/models/WishlistLinkBlock';
import '@/models/PeopleGroup';

const session = vi.mocked(auth);

// Monday 5 Oct 2026, 06:00 UTC: the occasion and the owner's birthday are a
// week ahead (occasion, gift and friend birthday reminders all fire), and
// alice's birthday is three weeks ahead (her birthday nudge fires).
const NOW = new Date('2026-10-05T06:00:00Z');

const as = (user: string | null) =>
  session.mockResolvedValue((user ? { user: { id: user } } : null) as never);
const req = (url: string, init: { method?: string; body?: unknown; headers?: HeadersInit } = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

interface World {
  owner: string;
  alice: string;
  bob: string;
  carol: string;
  /** No relation to the owner or the list. */
  stranger: string;
  listId: string;
  publicListId: string;
  bookedItem: string;
  giftItem: string;
  token: string;
}
let w: World;

// ---- profiler plumbing ----------------------------------------------------

interface ProfileEntry {
  op: string;
  ns: string;
  planSummary?: string;
  command?: Record<string, unknown>;
}

const db = () => mongoose.connection.db!;

async function startProfiling() {
  await db().command({ profile: 0 });
  await db()
    .collection('system.profile')
    .drop()
    .catch(() => undefined);
  await db().command({ profile: 2 });
}

async function stopProfiling(): Promise<ProfileEntry[]> {
  await db().command({ profile: 0 });
  return db().collection<ProfileEntry>('system.profile').find({}).toArray();
}

/** What a profile entry asked for, short enough for a failure message. */
function describeOp(e: ProfileEntry): string {
  const c = e.command ?? {};
  const shape = c.filter ?? c.q ?? c.query ?? c.pipeline ?? c.updates ?? c.deletes ?? c;
  return `${e.op} ${e.ns}: ${JSON.stringify(shape).slice(0, 300)}`;
}

/** Every operation `scenario` ran, as the profiler recorded it. */
async function profiled(scenario: () => Promise<unknown>): Promise<ProfileEntry[]> {
  await startProfiling();
  let entries: ProfileEntry[];
  try {
    await scenario();
  } finally {
    entries = await stopProfiling();
  }
  return entries.filter((e) => !e.ns.endsWith('.system.profile'));
}

/** The operations in `scenario` that ran without an index: a collection scan in their plan. */
async function collectionScans(scenario: () => Promise<unknown>): Promise<string[]> {
  return (await profiled(scenario))
    .filter((e) => e.planSummary?.includes('COLLSCAN'))
    .map(describeOp);
}

/** Runs `scenario` and fails, listing them, if any of its queries scanned a collection. */
async function expectIndexed(scenario: () => Promise<unknown>) {
  const scans = await collectionScans(scenario);
  expect(scans, `collection scans:\n${scans.join('\n')}`).toEqual([]);
}

async function ok(response: Response | Promise<Response>) {
  const res = await response;
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  return res;
}

// ---- seed -------------------------------------------------------------------

async function seed(): Promise<World> {
  const [owner, alice, bob, carol] = await User.create([
    {
      email: 'o@x.com',
      username: 'owner',
      birthday: '2000-10-12',
      privacy: { birthdayVisibility: 'friends' },
    },
    { email: 'a@x.com', username: 'alice', birthday: '2000-10-26' },
    { email: 'b@x.com', username: 'bob' },
    { email: 'c@x.com', username: 'carol' },
  ]);
  // Filler, so no collection is near-empty and every index has competition.
  const filler = await User.create(
    Array.from({ length: 30 }, (_, i) => ({
      email: `f${i}@x.com`,
      username: `filler${i}`,
      birthday: `2000-0${(i % 9) + 1}-1${i % 9}`,
    }))
  );
  const fillerLists = await Wishlist.create(
    filler.map((u, i) => ({
      name: `Filler list ${i}`,
      owners: [u._id],
      visibility: (['everyone', 'friends', 'private'] as const)[i % 3],
      archived: i % 7 === 0,
      ...(i % 2 ? { occasion: { kind: 'other', date: `2027-0${(i % 9) + 1}-01` } } : {}),
    }))
  );
  await Item.create(
    fillerLists.flatMap((l, i) =>
      Array.from({ length: 3 }, (_, j) => ({ wishlist: l._id, name: `Thing ${i}.${j}` }))
    )
  );
  await Follow.create(
    filler.slice(1).map((u, i) => ({ follower: u._id, following: filler[i]._id }))
  );

  // The owner is friends with alice and carol; bob only follows the owner.
  await Follow.create([
    { follower: owner._id, following: alice._id },
    { follower: alice._id, following: owner._id },
    { follower: owner._id, following: carol._id },
    { follower: carol._id, following: owner._id },
    { follower: bob._id, following: owner._id },
  ]);
  const list = await Wishlist.create({
    name: 'Birthday',
    owners: [owner._id],
    visibility: 'friends',
    occasion: { kind: 'birthday', date: '2026-10-12' },
  });
  const publicList = await Wishlist.create({
    name: 'Birthday ideas',
    owners: [owner._id],
    visibility: 'everyone',
    occasion: { kind: 'birthday', date: '2000-10-12', recurrence: 'yearly' },
  });
  await WishlistMember.create([
    { wishlist: list._id, user: alice._id },
    { wishlist: list._id, user: bob._id },
  ]);
  await WishlistInvite.create({
    wishlist: publicList._id,
    invitedUser: alice._id,
    invitedBy: owner._id,
    role: 'member',
    status: 'pending',
  });
  const [booked, gift] = await Item.create([
    { wishlist: list._id, name: 'Camera', price: { value: 10000, currency: 'USD' } },
    { wishlist: list._id, name: 'Bike', price: { value: 50000, currency: 'USD' } },
    { wishlist: list._id, name: 'Book' },
    { wishlist: publicList._id, name: 'Lamp' },
  ]);
  const token = generateShareToken();
  await ShareLink.create({
    wishlist: list._id,
    token,
    level: 'view',
    createdBy: owner._id,
  });
  await ShareLink.create(
    fillerLists.slice(0, 10).map((l) => ({
      wishlist: l._id,
      token: generateShareToken(),
      level: 'join',
      createdBy: l.owners[0],
    }))
  );

  const world: World = {
    owner: owner._id.toString(),
    alice: alice._id.toString(),
    bob: bob._id.toString(),
    carol: carol._id.toString(),
    stranger: filler[0]._id.toString(),
    listId: list._id.toString(),
    publicListId: publicList._id.toString(),
    bookedItem: booked._id.toString(),
    giftItem: gift._id.toString(),
    token,
  };

  // Alice books one item and starts a group gift on another, which bob joins:
  // a Reservation each, a GroupGift, and their notifications.
  as(world.alice);
  await ok(
    PATCH_ITEM(
      req(`/api/items/${world.bookedItem}`, { method: 'PATCH', body: { status: 'booked' } }),
      params(world.bookedItem)
    )
  );
  await ok(
    START_GIFT(
      req(`/api/items/${world.giftItem}/group-gift`, { method: 'POST', body: { pledged: 20000 } }),
      params(world.giftItem)
    )
  );
  as(world.bob);
  await ok(
    JOIN_GIFT(
      req(`/api/items/${world.giftItem}/group-gift/me`, {
        method: 'PUT',
        body: { pledged: 10000 },
      }),
      params(world.giftItem)
    )
  );
  await Notification.create(
    filler.map((u) => ({ user: u._id, type: 'follow', actorUsername: 'filler0' }))
  );
  return world;
}

beforeAll(async () => {
  await connectTestDB();
  // Build every model's indexes, as a deploy's autoIndex does on first connect.
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  w = await seed();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await disconnectTestDB();
});

// ---- the hot queries --------------------------------------------------------

describe('index audit (WIS-377): the hot queries never scan a collection', () => {
  it('records plans for the queries it runs (the harness itself works)', async () => {
    const entries = await profiled(() => Wishlist.find({ name: 'no such list' }).lean());
    const find = entries.find((e) => e.ns.endsWith('.wishlists') && e.op === 'query');
    expect(find?.planSummary).toBe('COLLSCAN');
    expect(await collectionScans(() => Wishlist.find({ name: 'x' }).lean())).toHaveLength(1);
  });

  // regression: no index covered a list's `visibility`, so the signed-out
  // filter, and the signed-in one's `$or` (whose `everyone` branch nothing
  // indexed), scanned every list: search and the Booked page did so per read.
  it('viewableWishlistsFilter, signed out and signed in', async () => {
    await expectIndexed(async () => {
      await Wishlist.find(viewableWishlistsFilter(null)).lean();
      await Wishlist.find(
        viewableWishlistsFilter({ id: w.alice, memberOf: [w.listId], friendIds: [w.owner] })
      ).lean();
    });
  });

  it('search: people and lists, signed out and signed in', async () => {
    await expectIndexed(async () => {
      as(null);
      await ok(SEARCH(req('/api/search?q=birth')));
      as(w.alice);
      await ok(SEARCH(req('/api/search?q=birth')));
      await ok(SEARCH(req('/api/search?q=@own&sections=users')));
    });
  });

  it('a list and its items: owner, member, signed out, and through a share link', async () => {
    await expectIndexed(async () => {
      for (const viewer of [w.owner, w.alice]) {
        as(viewer);
        await ok(WISHLIST(req(`/api/wishlists/${w.listId}`), params(w.listId)));
        await ok(ITEMS(req(`/api/wishlists/${w.listId}/items`), params(w.listId)));
      }
      as(null);
      await ok(ITEMS(req(`/api/wishlists/${w.publicListId}/items`), params(w.publicListId)));
      as(w.stranger);
      const viaLink = { headers: { 'X-Share-Token': w.token } };
      await ok(WISHLIST(req(`/api/wishlists/${w.listId}`, viaLink), params(w.listId)));
      await ok(ITEMS(req(`/api/wishlists/${w.listId}/items`, viaLink), params(w.listId)));
    });
  });

  it('resolveShareLink', async () => {
    await expectIndexed(async () => {
      expect(await resolveShareLink(w.token, NOW)).not.toBeNull();
      expect(await resolveShareLink(generateShareToken(), NOW)).toBeNull();
    });
  });

  it('the dashboard and Coming up', async () => {
    await expectIndexed(async () => {
      for (const viewer of [w.owner, w.alice]) {
        as(viewer);
        await ok(ME());
        await ok(MY_WISHLISTS(req('/api/wishlists')));
        await ok(BIRTHDAYS());
        await ok(MY_INVITES());
      }
    });
  });

  it("a profile's lists, and your own items and gifts", async () => {
    await expectIndexed(async () => {
      for (const viewer of [w.owner, w.alice, w.stranger, null]) {
        as(viewer);
        await ok(PROFILE_LISTS(req(`/api/users/${w.owner}/wishlists`), params(w.owner)));
      }
      for (const viewer of [w.owner, w.alice]) {
        as(viewer);
        await ok(MY_ITEMS(req('/api/users/me/items')));
        await ok(MY_GIFTS());
      }
    });
  });

  it('the Activity feed', async () => {
    await expectIndexed(async () => {
      for (const viewer of [w.owner, w.alice, w.bob]) {
        as(viewer);
        await ok(FEED(req('/api/notifications')));
        await ok(FEED(req('/api/notifications?actors=1')));
      }
    });
  });

  it('the reminder and birthday crons', async () => {
    await expectIndexed(async () => {
      const occasion = await sendOccasionReminders(NOW);
      const gifts = await sendGiftReminders(NOW);
      const birthdays = await runBirthdayTasks(NOW);
      // They found work to do, so their per-recipient queries ran too.
      expect(occasion.sent).toBeGreaterThan(0);
      expect(gifts.reminders.sent).toBeGreaterThan(0);
      expect(birthdays.ok).toBe(true);
    });
    expect(await Notification.countDocuments({ type: 'occasion_reminder' })).toBeGreaterThan(0);
    expect(await Notification.countDocuments({ type: 'gift_reminder' })).toBeGreaterThan(0);
    expect(await Notification.countDocuments({ type: 'birthday_reminder' })).toBeGreaterThan(0);
  });

  it('group gift and reservation lookups', async () => {
    await expectIndexed(async () => {
      const item = await Item.findById(w.giftItem).lean();
      expect(await liveGiftOf(item!)).not.toBeNull();
      expect(await holdsItem(w.bob, w.giftItem)).toBe(true);
      expect((await readGroupGiftSummaries(w.alice, [item!])).size).toBe(1);
      for (const viewer of [w.alice, w.bob]) {
        as(viewer);
        await ok(RESERVATIONS());
        await ok(RESERVATION_SUMMARY());
      }
    });
  });

  // WIS-385: every tagged item write reads the list's tags, before and after.
  it('a list’s tags, for an item write’s cap', async () => {
    await expectIndexed(async () => {
      await fitItemTags(w.listId, null, ['Books']);
      await listTagsOverCap(w.listId);
    });
  });

  // WIS-434: every move first looks for the caller's dead moves to settle.
  it('a move’s sweep of the caller’s dead moves', async () => {
    await expectIndexed(() => settleDeadMoves(w.owner));
  });

  // WIS-443: the gift reminders cron's sweep of everyone's dead moves.
  it('the daily sweep of dead moves', async () => {
    const old = new Date(Date.now() - ITEM_BATCH_STALE_MS - 60_000);
    const rows = await ItemBatch.create(
      Array.from({ length: 20 }, (_, i) => ({
        user: w.owner,
        key: `audit-batch-${i}`,
        wishlist: new mongoose.Types.ObjectId(),
        payload: 'x',
        // Finished batches as filler, and one dead move.
        done: i > 0,
        moves: [{ from: new mongoose.Types.ObjectId(), to: new mongoose.Types.ObjectId() }],
        expiresAt: new Date(Date.now() + 60_000),
      }))
    );
    await ItemBatch.collection.updateMany(
      { _id: { $in: rows.map((r) => r._id) } },
      { $set: { createdAt: old } }
    );
    await expectIndexed(async () => {
      expect((await settleAllDeadMoves()).settled).toBe(1);
    });
    await ItemBatch.deleteMany({ key: /^audit-batch-/ });
  });
});

describe('index audit (WIS-377): no index another one already covers', () => {
  /**
   * A plain index (not unique, partial, sparse or TTL: those do more than speed
   * a query up) whose keys are the leading keys of another full index serves
   * nothing the longer one can't, and only costs every write. Only plain
   * ascending/descending keys with no collation are compared: a text, hashed
   * or collated index serves queries the other can't.
   */
  it('declares no plain index that is a prefix of another', () => {
    const redundant: string[] = [];
    for (const name of mongoose.modelNames()) {
      const indexes = mongoose
        .model(name)
        .schema.indexes()
        .map(([fields, options]) => ({
          // A single key reads both ways, so its direction doesn't matter.
          keys: Object.entries(fields).map(([k, v], _, all) =>
            all.length === 1 && Math.abs(Number(v)) === 1 ? `${k}:1` : `${k}:${v}`
          ),
          plainKeys: Object.values(fields).every((v) => v === 1 || v === -1),
          options: (options ?? {}) as Record<string, unknown>,
        }))
        .filter((index) => index.plainKeys && !index.options.collation);
      const full = (o: Record<string, unknown>) => !o.partialFilterExpression && !o.sparse;
      for (const a of indexes) {
        const o = a.options;
        if (o.unique || !full(o) || o.expireAfterSeconds !== undefined || o.expires) continue;
        const covered = indexes.some(
          (b) =>
            b !== a &&
            full(b.options) &&
            b.keys.length > a.keys.length &&
            a.keys.every((k, i) => b.keys[i] === k)
        );
        if (covered) redundant.push(`${name} { ${a.keys.join(', ')} }`);
      }
    }
    expect(redundant).toEqual([]);
  });
});
