import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// WIS-323: a birthday on the profile, and who may see it. One helper decides
// (`canSeeBirthday`, lib/utils/birthday.ts), its query form agrees with it, and
// anyone it excludes gets the same answer as for someone with no birthday.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/og/purge', () => ({ purgeShareCards: vi.fn().mockResolvedValue(undefined) }));

import { auth } from '@/lib/auth';
import { GET as BY_USERNAME } from '@/app/api/users/by-username/[username]/route';
import { GET as GET_ME, PATCH as PATCH_ME } from '@/app/api/users/me/route';
import { GET as SEARCH } from '@/app/api/search/route';
import { GET as USER_WISHLISTS } from '@/app/api/users/[id]/wishlists/route';
import { GET as GET_WISHLIST } from '@/app/api/wishlists/[id]/route';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import {
  BIRTHDAY_VISIBILITIES,
  birthdayVisibleFilter,
  canSeeBirthday,
  type BirthdayVisibility,
} from '@/lib/utils/birthday';

const session = vi.mocked(auth);

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
});

function signIn(id?: string) {
  session.mockResolvedValue(id ? ({ user: { id } } as never) : (null as never));
}

type ProfileVis = 'everyone' | 'friends';

async function person(
  username: string,
  {
    birthday,
    birthdayVisibility,
    profileVisibility,
  }: {
    birthday?: string | null;
    birthdayVisibility?: BirthdayVisibility;
    profileVisibility?: ProfileVis;
  } = {}
) {
  const u = await User.create({
    email: `${username}@x.com`,
    username,
    ...(birthday !== undefined && { birthday }),
    privacy: {
      ...(birthdayVisibility && { birthdayVisibility }),
      ...(profileVisibility && { profileVisibility }),
    },
  });
  return u._id.toString();
}

async function befriend(a: string, b: string) {
  await Follow.create([
    { follower: a, following: b },
    { follower: b, following: a },
  ]);
}

async function profileOf(username: string, viewer?: string) {
  signIn(viewer);
  const res = await BY_USERNAME(new NextRequest(`http://localhost/api/users/by-username/x`), {
    params: Promise.resolve({ username }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).data as Record<string, unknown>;
}

describe('birthdayVisibleFilter agrees with canSeeBirthday', () => {
  // Every birthday setting (and none saved) × profile visibility (and none
  // saved) × a friend or anyone else: the query matches exactly the people the
  // helper shows it to. Change both together.
  const settings: (BirthdayVisibility | undefined)[] = [...BIRTHDAY_VISIBILITIES, undefined];
  const profiles: (ProfileVis | undefined)[] = ['everyone', 'friends', undefined];

  it('matches exactly whom the helper admits, for each relationship', async () => {
    const cases: { username: string; privacy: Record<string, string | undefined> }[] = [];
    let n = 0;
    for (const birthdayVisibility of settings) {
      for (const profileVisibility of profiles) {
        const username = `p${n++}`;
        // Written raw, so a setting never saved is really absent, as on an
        // account from before WIS-323.
        await User.collection.insertOne({
          email: `${username}@x.com`,
          username,
          birthday: '2000-03-14',
          privacy: {
            ...(birthdayVisibility && { birthdayVisibility }),
            ...(profileVisibility && { profileVisibility }),
          },
        });
        cases.push({ username, privacy: { birthdayVisibility, profileVisibility } });
      }
    }
    // And people with no birthday, who never match.
    await User.collection.insertOne({
      email: 'none@x.com',
      username: 'none',
      privacy: { birthdayVisibility: 'everyone' },
    });
    await User.collection.insertOne({
      email: 'nulled@x.com',
      username: 'nulled',
      birthday: null,
      privacy: { birthdayVisibility: 'everyone' },
    });

    for (const viewer of ['friend', 'other'] as const) {
      const matched = (await User.find(birthdayVisibleFilter(viewer)).select('username').lean())
        .map((u) => u.username)
        .sort();
      const expected = cases
        .filter((c) => canSeeBirthday(c.privacy as Parameters<typeof canSeeBirthday>[0], viewer))
        .map((c) => c.username)
        .sort();
      expect(matched).toEqual(expected);
    }
  });
});

describe('GET /api/users/by-username: the birthday per viewer', () => {
  it.each([
    // setting, profile visibility, who's looking, sees it
    ['friends', 'everyone', 'self', true],
    ['friends', 'everyone', 'friend', true],
    ['friends', 'everyone', 'stranger', false],
    ['friends', 'everyone', 'signed out', false],
    ['everyone', 'everyone', 'stranger', true],
    ['everyone', 'everyone', 'signed out', true],
    ['everyone', 'friends', 'friend', true],
    ['everyone', 'friends', 'stranger', false],
    ['everyone', 'friends', 'signed out', false],
    ['nobody', 'everyone', 'friend', false],
    ['nobody', 'everyone', 'stranger', false],
    ['nobody', 'everyone', 'self', true],
  ] as const)(
    'birthdayVisibility %s, profileVisibility %s: %s sees it → %s',
    async (birthdayVisibility, profileVisibility, who, sees) => {
      const anna = await person('anna', {
        birthday: '2000-03-14',
        birthdayVisibility,
        profileVisibility,
      });
      const friend = await person('fred');
      const stranger = await person('stan');
      await befriend(anna, friend);
      const viewer =
        who === 'self'
          ? anna
          : who === 'friend'
            ? friend
            : who === 'stranger'
              ? stranger
              : undefined;

      const data = await profileOf('anna', viewer);
      if (sees) expect(data.birthday).toBe('2000-03-14');
      else expect(data).not.toHaveProperty('birthday');
    }
  );

  it('defaults to friends for an account that never saved the setting', async () => {
    const anna = await person('anna', { birthday: '2000-03-14' });
    const friend = await person('fred');
    const stranger = await person('stan');
    await befriend(anna, friend);
    expect((await profileOf('anna', friend)).birthday).toBe('2000-03-14');
    expect(await profileOf('anna', stranger)).not.toHaveProperty('birthday');
  });

  it('gives an excluded viewer the same answer for a hidden birthday as for none', async () => {
    await person('hidden', { birthday: '2000-03-14', birthdayVisibility: 'nobody' });
    await person('unset', { birthdayVisibility: 'nobody' });
    await person('cleared', { birthday: null, birthdayVisibility: 'everyone' });
    const stranger = await person('stan');

    const shape = (d: Record<string, unknown>) => {
      const { _id, username, ...rest } = d;
      void _id;
      void username;
      return rest;
    };
    for (const viewer of [stranger, undefined]) {
      const hidden = shape(await profileOf('hidden', viewer));
      expect(hidden).toEqual(shape(await profileOf('unset', viewer)));
      expect(hidden).toEqual(shape(await profileOf('cleared', viewer)));
      expect(hidden).not.toHaveProperty('birthday');
      expect(hidden).not.toHaveProperty('birthdayAudience');
    }
  });

  it('tells you who sees your own birthday, capped by a friends-only profile', async () => {
    const anna = await person('anna', {
      birthday: '2000-02-29',
      birthdayVisibility: 'everyone',
      profileVisibility: 'friends',
    });
    const data = await profileOf('anna', anna);
    expect(data.birthday).toBe('2000-02-29');
    expect(data.birthdayAudience).toBe('friends');
  });
});

describe('/api/users/me: saving a birthday', () => {
  async function patch(id: string, body: unknown) {
    signIn(id);
    return PATCH_ME(
      new NextRequest('http://localhost/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    );
  }

  it('stores the day and month only, and answers it back', async () => {
    const anna = await person('anna');
    const res = await patch(anna, { birthday: '1990-02-29' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.birthday).toBe('2000-02-29');
    const row = await User.findById(anna).lean();
    expect(row?.birthday).toBe('2000-02-29');

    signIn(anna);
    expect((await (await GET_ME()).json()).data.birthday).toBe('2000-02-29');
  });

  it('refuses a day that doesn’t exist, and changes nothing', async () => {
    const anna = await person('anna', { birthday: '2000-03-14' });
    const res = await patch(anna, { birthday: '1990-04-31' });
    expect(res.status).toBe(400);
    expect((await User.findById(anna).lean())?.birthday).toBe('2000-03-14');
  });

  it('clears it with null', async () => {
    const anna = await person('anna', { birthday: '2000-03-14' });
    expect((await patch(anna, { birthday: null })).status).toBe(200);
    expect((await User.findById(anna).lean())?.birthday).toBeNull();
  });

  it('saves who can see it on its own, leaving the other privacy settings alone', async () => {
    const anna = await person('anna', { profileVisibility: 'friends' });
    const res = await patch(anna, { privacy: { birthdayVisibility: 'nobody' } });
    expect(res.status).toBe(200);
    const row = await User.findById(anna).lean();
    expect(row?.privacy?.birthdayVisibility).toBe('nobody');
    expect(row?.privacy?.profileVisibility).toBe('friends');
  });

  it('regression: a save of the birthday alone leaves its visibility as another tab set it', async () => {
    const anna = await person('anna', { birthdayVisibility: 'nobody' });
    await patch(anna, { birthday: '2000-03-14' });
    expect((await User.findById(anna).lean())?.privacy?.birthdayVisibility).toBe('nobody');
  });
});

describe('the birthday stays out of every other answer', () => {
  it('is never in search results, a profile’s lists or a list', async () => {
    const anna = await person('anna', {
      birthday: '2000-03-14',
      birthdayVisibility: 'everyone',
    });
    const friend = await person('fred');
    await befriend(anna, friend);
    const list = await Wishlist.create({
      name: 'Anna party',
      slug: 'anna-party',
      owners: [anna],
      visibility: 'everyone',
    });

    signIn(friend);
    const search = await SEARCH(new NextRequest('http://localhost/api/search?q=anna'));
    const searchJson = await search.json();
    expect(searchJson.data.users.map((u: { username: string }) => u.username)).toContain('anna');
    expect(JSON.stringify(searchJson)).not.toMatch(/birthday"|03-14/);

    signIn(friend);
    const lists = await USER_WISHLISTS(
      new NextRequest(`http://localhost/api/users/${anna}/wishlists`),
      {
        params: Promise.resolve({ id: anna }),
      }
    );
    expect(JSON.stringify(await lists.json())).not.toMatch(/birthday"|03-14/);

    signIn(friend);
    const one = await GET_WISHLIST(new NextRequest(`http://localhost/api/wishlists/${list._id}`), {
      params: Promise.resolve({ id: list._id.toString() }),
    });
    expect(one.status).toBe(200);
    expect(JSON.stringify(await one.json())).not.toMatch(/birthday"|03-14/);
  });
});
