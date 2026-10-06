import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// The same account has its settings open in two tabs. The settings page fills
// its form when it loads, so these tests fill each tab's form the same way
// (from the GET), save from one, then save from the other the way the page
// does: only what `profileChanges` says that form changed.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
// A share card purge is a CDN call; these tests are about what's stored.
vi.mock('@vercel/functions', () => ({ dangerouslyDeleteByTag: vi.fn() }));

import { auth } from '@/lib/auth';
import { GET, PATCH } from '@/app/api/users/me/route';
import {
  profileChanges,
  profileSettings,
  rebaseProfileForm,
  type ProfileSettings,
} from '@/lib/utils/profileSettings';
import User from '@/models/User';

const session = vi.mocked(auth);
let alice: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  alice = (
    await User.create({ email: 'a@x.com', username: 'alice', bio: 'I collect mugs.' })
  )._id.toString();
  session.mockResolvedValue({ user: { id: alice } } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function patch(body: unknown) {
  return PATCH(
    new NextRequest('http://localhost/api/users/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

/** Open the settings in a tab: the form filled from the profile as the GET returns it. */
async function openSettings() {
  const res = await GET();
  expect(res.status).toBe(200);
  const saved = profileSettings((await res.json()).data);
  return { saved, form: saved };
}

type Tab = Awaited<ReturnType<typeof openSettings>>;

/**
 * Save `change` from a tab the way the page does: only what its form changed,
 * then refill the form from the answer.
 */
async function save(tab: Tab, change: Partial<ProfileSettings>) {
  const sent = { ...tab.form, ...change };
  const body = profileChanges(sent, tab.saved);
  const res = await patch(body);
  expect(res.status).toBe(200);
  const stored = profileSettings((await res.json()).data);
  tab.form = rebaseProfileForm(sent, sent, stored);
  tab.saved = stored;
  return { body, stored };
}

const privacyOf = async () => (await User.findById(alice).lean())?.privacy;

describe('saving the account settings leaves a change saved from another tab alone', () => {
  // regression: the page sent the whole `privacy` object with every save, as
  // its form loaded it, and the route rebuilt all three settings from its read,
  // so a save from a tab opened before the profile was made friends-only made
  // it public again.
  it('regression: a save from an older tab keeps the visibility the other tab just set', async () => {
    const older = await openSettings();
    const newer = await openSettings();

    await save(newer, { profileVisibility: 'friends' });
    const { body } = await save(older, { searchable: false });

    expect(body).toEqual({ privacy: { searchable: false } });
    expect(await privacyOf()).toEqual({
      searchable: false,
      whoCanInvite: 'everyone',
      profileVisibility: 'friends',
      birthdayVisibility: 'friends',
    });
  });

  it('keeps every other setting the other tab saved: invites, bio, currency, the rest of privacy', async () => {
    const older = await openSettings();
    const newer = await openSettings();

    await save(newer, {
      bio: 'Mugs and plants.',
      defaultCurrency: 'GBP',
      whoCanInvite: 'nobody',
      searchable: false,
    });
    await save(older, { profileVisibility: 'friends' });

    expect(await User.findById(alice).lean()).toMatchObject({
      username: 'alice',
      bio: 'Mugs and plants.',
      defaultCurrency: 'GBP',
      privacy: { searchable: false, whoCanInvite: 'nobody', profileVisibility: 'friends' },
    });
  });

  it("answers with the profile as stored, so the form's next save doesn't send the other tab's change back", async () => {
    const older = await openSettings();
    const newer = await openSettings();

    await save(newer, { profileVisibility: 'friends' });
    const { stored } = await save(older, { searchable: false });
    // The answer carries the other tab's visibility, and the form takes it in.
    expect(stored.profileVisibility).toBe('friends');
    expect(older.form.profileVisibility).toBe('friends');

    const { body } = await save(older, { bio: 'Plants.' });
    expect(body).toEqual({ bio: 'Plants.' });
    expect((await privacyOf())?.profileVisibility).toBe('friends');
  });
});

describe('PATCH /api/users/me — the privacy settings it writes', () => {
  // regression: the route merged what it was sent over the privacy it had read
  // and wrote all three settings back, so a change landing between its read
  // and its write was undone even when the request didn't send that setting.
  it("regression: writes only the setting it's sent, even over a change landing after its read", async () => {
    const findById = User.findById.bind(User);
    // Another tab's save lands just after this request has read the profile.
    vi.spyOn(User, 'findById').mockImplementationOnce(((id: string) =>
      findById(id).then(async (user) => {
        await User.updateOne({ _id: id }, { $set: { 'privacy.profileVisibility': 'friends' } });
        return user;
      })) as never);

    const res = await patch({ privacy: { searchable: false } });

    expect(res.status).toBe(200);
    expect(await privacyOf()).toEqual({
      searchable: false,
      whoCanInvite: 'everyone',
      profileVisibility: 'friends',
      birthdayVisibility: 'friends',
    });
    expect((await res.json()).data.privacy).toMatchObject({ profileVisibility: 'friends' });
  });

  it.each([
    ['searchable', { searchable: false }],
    ['whoCanInvite', { whoCanInvite: 'friends' }],
    ['profileVisibility', { profileVisibility: 'friends' }],
    ['birthdayVisibility', { birthdayVisibility: 'everyone' }],
  ] as const)('writes %s on its own, keeping the others as they are', async (_, privacy) => {
    const stored = {
      searchable: true,
      whoCanInvite: 'nobody',
      profileVisibility: 'everyone',
      birthdayVisibility: 'nobody',
    };
    await User.updateOne({ _id: alice }, { $set: { privacy: stored } });

    expect((await patch({ privacy })).status).toBe(200);
    expect(await privacyOf()).toEqual({ ...stored, ...privacy });
  });

  // A tab still running the previous settings page sends every privacy setting.
  it('still writes all three when sent all three', async () => {
    const privacy = { searchable: false, whoCanInvite: 'nobody', profileVisibility: 'friends' };
    const res = await patch({ privacy });

    expect(res.status).toBe(200);
    // The birthday setting (WIS-323) wasn't sent, so it stays at its default.
    expect(await privacyOf()).toEqual({ ...privacy, birthdayVisibility: 'friends' });
    expect((await res.json()).data.privacy).toEqual({ ...privacy, birthdayVisibility: 'friends' });
  });

  it('writes a privacy setting into a profile stored without any', async () => {
    await User.collection.updateOne({ username: 'alice' }, { $unset: { privacy: '' } });

    expect((await patch({ privacy: { profileVisibility: 'friends' } })).status).toBe(200);
    expect((await User.collection.findOne({ username: 'alice' }))?.privacy).toEqual({
      profileVisibility: 'friends',
    });
  });

  it('refuses a privacy setting outside its options, and writes nothing', async () => {
    const res = await patch({ bio: 'Changed', privacy: { profileVisibility: 'nobody' } });

    expect(res.status).toBe(400);
    expect(await User.findById(alice).lean()).toMatchObject({
      bio: 'I collect mugs.',
      privacy: { profileVisibility: 'everyone' },
    });
  });
});
