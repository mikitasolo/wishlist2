import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { getWishlistViewAccess } from '@/lib/utils/wishlistAccess';
import {
  linkAudience,
  LINK_AUDIENCE_TEXT,
  shareLinksAudienceText,
  type LinkAudience,
} from '@/lib/utils/shareLink';
import ShareLink from '@/models/ShareLink';
import { generateShareToken } from '@/lib/utils/shareLinks';

/**
 * The Share popover tells a list's owners who its link opens for
 * (`linkAudience`). This table pins that to `getWishlistViewAccess`: for every
 * visibility, archived or not, the people the popover names are exactly the
 * people the list opens for. It only informs the owner; access is decided by
 * `getWishlistViewAccess` alone.
 */

const VIEWERS = [
  'signedOut',
  'owner',
  'coOwner',
  'member',
  'friendOfOwner',
  'friendOfCoOwner',
  'follower',
  'stranger',
] as const;
type Viewer = (typeof VIEWERS)[number];

/** Whom each audience's text promises the link opens for. */
const PROMISED: Record<LinkAudience, Viewer[]> = {
  // "Anyone with the link can view."
  anyone: [...VIEWERS],
  // "Only friends of the owners, and people on the list, can open it."
  'friends-and-members': ['owner', 'coOwner', 'member', 'friendOfOwner', 'friendOfCoOwner'],
  // "Only people on the list can open it."
  members: ['owner', 'coOwner', 'member'],
  // "Archived: the link won't open for anyone but the owners."
  owners: ['owner', 'coOwner'],
};

const ids = {} as Record<Exclude<Viewer, 'signedOut'>, mongoose.Types.ObjectId>;

beforeAll(async () => {
  await connectTestDB();
  for (const name of VIEWERS) {
    if (name === 'signedOut') continue;
    const u = await User.create({ email: `${name}@x.com`, username: name.toLowerCase() });
    ids[name] = u._id;
  }
  const befriend = (a: mongoose.Types.ObjectId, b: mongoose.Types.ObjectId) =>
    Follow.create([
      { follower: a, following: b },
      { follower: b, following: a },
    ]);
  await befriend(ids.owner, ids.friendOfOwner);
  await befriend(ids.coOwner, ids.friendOfCoOwner);
  // Follows the owner, who doesn't follow back: not a friend.
  await Follow.create({ follower: ids.follower, following: ids.owner });
});

afterAll(disconnectTestDB);

describe("the Share popover's text matches getWishlistViewAccess", () => {
  it.each([
    ['everyone', false],
    ['friends', false],
    ['private', false],
    ['everyone', true],
    ['friends', true],
    ['private', true],
  ] as const)('a %s list, archived: %s', async (visibility, archived) => {
    const wishlist = await Wishlist.create({
      name: 'List',
      owners: [ids.owner, ids.coOwner],
      visibility,
      archived,
    });
    await WishlistMember.create({ wishlist: wishlist._id, user: ids.member });

    const opensFor: Viewer[] = [];
    for (const viewer of VIEWERS) {
      const viewerId = viewer === 'signedOut' ? null : ids[viewer].toString();
      if ((await getWishlistViewAccess(wishlist, viewerId)).allowed) opensFor.push(viewer);
    }

    const audience = linkAudience(wishlist);
    expect(opensFor).toEqual(PROMISED[audience]);
    expect(LINK_AUDIENCE_TEXT[audience]).toBeTruthy();
  });
});

// WIS-335: `LINK_AUDIENCE_TEXT` stays about the list's own URL. While the list
// has live share links, the popover and the visibility setting add who else
// gets in, which is everyone holding one, whatever the visibility.
describe('the extra line about share links', () => {
  it('names the live links, and nothing without one', () => {
    expect(shareLinksAudienceText(0)).toBeNull();
    expect(shareLinksAudienceText(1)).toBe('Also anyone with your share link.');
    expect(shareLinksAudienceText(3)).toBe('Also anyone with one of your 3 share links.');
  });

  it.each(['everyone', 'friends', 'private'] as const)(
    'is true on a %s list: a live link opens it for every viewer',
    async (visibility) => {
      const wishlist = await Wishlist.create({
        name: 'Linked',
        owners: [ids.owner, ids.coOwner],
        visibility,
      });
      const link = (
        await ShareLink.create({
          wishlist: wishlist._id,
          token: generateShareToken(),
          level: 'view',
          createdBy: ids.owner,
        })
      ).toObject();
      for (const viewer of VIEWERS) {
        const viewerId = viewer === 'signedOut' ? null : ids[viewer].toString();
        expect((await getWishlistViewAccess(wishlist, viewerId, { link })).allowed).toBe(true);
      }
    }
  );
});
