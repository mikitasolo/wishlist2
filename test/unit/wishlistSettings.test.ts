import { describe, it, expect } from 'vitest';
import {
  rebaseSettingsForm,
  settingsChanges,
  settingsFormFor,
  wishlistSettings,
  type WishlistSettings,
  type WishlistSettingsForm,
} from '@/lib/utils/wishlistSettings';
import { occasionToDraft, type Occasion } from '@/lib/utils/occasion';

const BIRTHDAY: Occasion = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' };
const WEDDING: Occasion = { kind: 'wedding', date: '2027-06-12', recurrence: null };
const BANNER = 'https://store.public.blob.vercel-storage.com/uploads/u1/banner.webp';
const OTHER_BANNER = 'https://store.public.blob.vercel-storage.com/uploads/u2/banner.webp';

// The list as the settings form was filled from it.
const saved: WishlistSettings = {
  name: 'Birthday',
  slug: 'birthday',
  description: 'Things I would like',
  visibility: 'everyone',
  bannerUrl: BANNER,
  currency: 'EUR',
  occasion: BIRTHDAY,
};

/** The form as filled from `saved`, with `change` typed into it. */
const edited = (change: Partial<WishlistSettingsForm> = {}): WishlistSettingsForm => ({
  ...settingsFormFor(saved),
  ...change,
});

describe('wishlistSettings', () => {
  it("reads a list's settings the way the form edits them", () => {
    expect(
      wishlistSettings({
        name: 'Birthday',
        slug: 'birthday',
        description: 'Things',
        visibility: 'friends',
        bannerUrl: BANNER,
        currency: 'EUR',
        occasion: WEDDING,
      })
    ).toEqual({
      name: 'Birthday',
      slug: 'birthday',
      description: 'Things',
      visibility: 'friends',
      bannerUrl: BANNER,
      currency: 'EUR',
      occasion: WEDDING,
    });
  });

  it('reads no description or banner as empty, no currency as USD and no occasion as none', () => {
    expect(
      wishlistSettings({
        name: 'Birthday',
        slug: null,
        description: null,
        visibility: 'everyone',
        bannerUrl: null,
      })
    ).toEqual({
      name: 'Birthday',
      slug: '',
      description: '',
      visibility: 'everyone',
      bannerUrl: '',
      currency: 'USD',
      occasion: null,
    });
  });

  it('uppercases the currency, and reads a missing visibility as private (fails closed)', () => {
    const settings = wishlistSettings({ name: 'Birthday', currency: 'eur' });
    expect(settings.currency).toBe('EUR');
    expect(settings.visibility).toBe('private');
  });
});

describe('settingsFormFor', () => {
  it('fills the form with the settings, the occasion as a draft', () => {
    expect(settingsFormFor(saved)).toEqual({ ...saved, occasion: occasionToDraft(BIRTHDAY) });
  });
});

describe('settingsChanges', () => {
  it('is empty when nothing was changed', () => {
    expect(settingsChanges(edited(), saved)).toEqual({});
  });

  // regression: the form sent every setting on each save, filled once when the
  // page loaded, so a co-owner's change made meanwhile (the list made private)
  // was written back to what the form had loaded.
  it('regression: a save that only edits the description sends only the description', () => {
    expect(settingsChanges(edited({ description: 'Updated' }), saved)).toEqual({
      description: 'Updated',
    });
  });

  // A name stored before the schema refused bidi overrides (WIS-119) isn't
  // migrated. Left alone, it stays out of the save, so the server never
  // re-checks it and the list's other settings still save.
  it("leaves out a stored name the schema would now refuse, when it isn't edited", () => {
    const legacy = { ...saved, name: 'Birthday \u202Etsil' };
    const form = { ...settingsFormFor(legacy), visibility: 'private' as const };
    expect(settingsChanges(form, legacy)).toEqual({ visibility: 'private' });
  });

  it('sends each changed setting, and only those', () => {
    expect(settingsChanges(edited({ name: 'Turning 37' }), saved)).toEqual({ name: 'Turning 37' });
    expect(settingsChanges(edited({ slug: 'turning-37' }), saved)).toEqual({ slug: 'turning-37' });
    expect(settingsChanges(edited({ visibility: 'private' }), saved)).toEqual({
      visibility: 'private',
    });
    expect(settingsChanges(edited({ currency: 'GBP' }), saved)).toEqual({ currency: 'GBP' });
    expect(settingsChanges(edited({ bannerUrl: OTHER_BANNER }), saved)).toEqual({
      bannerUrl: OTHER_BANNER,
    });
    expect(settingsChanges(edited({ name: 'Turning 37', visibility: 'friends' }), saved)).toEqual({
      name: 'Turning 37',
      visibility: 'friends',
    });
  });

  it('sends a cleared description or banner as empty', () => {
    expect(settingsChanges(edited({ description: '' }), saved)).toEqual({ description: '' });
    expect(settingsChanges(edited({ bannerUrl: '' }), saved)).toEqual({ bannerUrl: '' });
  });

  it("doesn't count what the server would store as it is as a change", () => {
    expect(
      settingsChanges(
        edited({
          name: '  Birthday ',
          slug: ' Birthday ',
          description: 'Things I would like\n',
          currency: 'eur',
        }),
        saved
      )
    ).toEqual({});
    // A list with no description: whitespace typed into the empty field.
    const bare = { ...saved, description: '' };
    expect(settingsChanges({ ...settingsFormFor(bare), description: '   ' }, bare)).toEqual({});
  });

  it('sends a changed setting as typed, for the server to trim and check', () => {
    expect(settingsChanges(edited({ name: ' Turning 37 ' }), saved)).toEqual({
      name: ' Turning 37 ',
    });
    // Refused by the API (a name is required) rather than quietly not sent.
    expect(settingsChanges(edited({ name: '   ' }), saved)).toEqual({ name: '   ' });
  });

  it("sends the occasion only when it's changed, and null when it's cleared", () => {
    expect(settingsChanges(edited({ occasion: occasionToDraft(WEDDING) }), saved)).toEqual({
      occasion: WEDDING,
    });
    expect(settingsChanges(edited({ occasion: occasionToDraft(null) }), saved)).toEqual({
      occasion: null,
    });
    const none = { ...saved, occasion: null };
    expect(settingsChanges(settingsFormFor(none), none)).toEqual({});
  });
});

describe('rebaseSettingsForm, when a save lands', () => {
  // A co-owner made the list private and renamed it while this owner edited
  // the description; the server answers the save with the list as it is now.
  const answer: WishlistSettings = {
    ...saved,
    name: 'Family birthday',
    description: 'Updated',
    visibility: 'private',
  };

  it("refills the form from the list as saved, normalized, a co-owner's changes included", () => {
    const sent = edited({ description: 'Updated ' });
    expect(rebaseSettingsForm(sent, sent, answer)).toEqual(settingsFormFor(answer));
  });

  // regression: a form left as it was loaded after a save would count the
  // co-owner's change as one of its own, and send it back on the next save.
  it('regression: makes the next save diff against the list as saved, not as first loaded', () => {
    const sent = edited({ description: 'Updated' });
    const form = rebaseSettingsForm(sent, sent, answer);
    expect(settingsChanges(form, answer)).toEqual({});
    expect(settingsChanges({ ...form, currency: 'GBP' }, answer)).toEqual({ currency: 'GBP' });
  });

  it('keeps an edit made while the save was in flight', () => {
    const sent = edited({ description: 'Updated' });
    // A banner upload started before the save finished during it.
    const form = { ...sent, bannerUrl: OTHER_BANNER };
    const rebased = rebaseSettingsForm(form, sent, answer);
    expect(rebased).toEqual({ ...settingsFormFor(answer), bannerUrl: OTHER_BANNER });
    expect(settingsChanges(rebased, answer)).toEqual({ bannerUrl: OTHER_BANNER });
  });

  it('keeps an occasion edited while the save was in flight', () => {
    const sent = edited({ description: 'Updated' });
    const form = { ...sent, occasion: occasionToDraft(WEDDING) };
    const rebased = rebaseSettingsForm(form, sent, answer);
    expect(rebased.occasion).toEqual(occasionToDraft(WEDDING));
    expect(settingsChanges(rebased, answer)).toEqual({ occasion: WEDDING });
  });
});

describe('rebaseSettingsForm, when the list is read again', () => {
  // The list as it is now: a co-owner made it private and set an occasion.
  const reread: WishlistSettings = { ...saved, visibility: 'private', occasion: WEDDING };
  /** The form as filled from `saved`: what an edit is measured against. */
  const base = settingsFormFor(saved);

  it('refills an untouched form entirely', () => {
    expect(rebaseSettingsForm(base, base, reread)).toEqual(settingsFormFor(reread));
  });

  it("refills every field the owner hasn't edited, and keeps the ones they have", () => {
    const form = edited({ description: 'Updated', name: 'Turning 37' });
    const rebased = rebaseSettingsForm(form, base, reread);
    expect(rebased).toEqual({
      ...settingsFormFor(reread),
      description: 'Updated',
      name: 'Turning 37',
    });
    // The co-owner's changes are now the baseline: only the owner's go.
    expect(settingsChanges(rebased, reread)).toEqual({
      description: 'Updated',
      name: 'Turning 37',
    });
  });

  it('compares an occasion draft by its fields, not by identity', () => {
    // A fresh draft object with the same fields: not an edit.
    const form = edited({ occasion: occasionToDraft(BIRTHDAY) });
    expect(rebaseSettingsForm(form, base, reread).occasion).toEqual(occasionToDraft(WEDDING));
    // A draft the owner changed (a half-filled one, even) is kept.
    const half = { ...occasionToDraft(null), kind: 'holiday' as const };
    expect(rebaseSettingsForm(edited({ occasion: half }), base, reread).occasion).toEqual(half);
  });
});
