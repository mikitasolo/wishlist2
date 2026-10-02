import { describe, it, expect } from 'vitest';
import {
  createWishlistSchema,
  updateWishlistSchema,
  updateProfileSchema,
  inviteMemberSchema,
  createItemSchema,
  updateItemSchema,
  magicLinkRequestSchema,
  occasionSchema,
} from '@/lib/validations';

describe('createWishlistSchema', () => {
  it('requires a non-empty name and defaults visibility to everyone', () => {
    const ok = createWishlistSchema.safeParse({ name: 'Birthday' });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.visibility).toBe('everyone');
  });
  it('rejects empty name and >100 chars', () => {
    expect(createWishlistSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createWishlistSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
  });
  it('uppercases and validates currency codes', () => {
    const ok = createWishlistSchema.safeParse({ name: 'x', currency: 'pln' });
    expect(ok.success && ok.data.currency).toBe('PLN');
    expect(createWishlistSchema.safeParse({ name: 'x', currency: 'zz' }).success).toBe(false);
  });
});

describe('wishlist name on createWishlistSchema and updateWishlistSchema', () => {
  const schemas = [
    ['create', createWishlistSchema],
    ['update', updateWishlistSchema],
  ] as const;
  const NAME_ERROR = "Name can't contain line breaks or control characters";

  function nameIssues(schema: (typeof schemas)[number][1], name: string) {
    const res = schema.safeParse({ name });
    return res.success ? [] : res.error.issues.map((i) => ({ path: i.path, message: i.message }));
  }

  // regression: both schemas only bounded the name's length and trimmed its
  // ends, so an API call could save a name with an inner CR/LF. It goes raw into
  // the invite email's plain-text part (new paragraphs under our branding) and
  // the console transport's log (a forged `Link:` line).
  it.each(schemas)('regression: %s rejects a name with an inner CR or LF', (_, schema) => {
    for (const name of [
      'Birthday\n\nACTION REQUIRED: verify your account at https://evil.example',
      'Birthday\r\nLink: https://evil.example',
      'Birthday\rList',
    ]) {
      expect(nameIssues(schema, name)).toEqual([{ path: ['name'], message: NAME_ERROR }]);
    }
  });

  it.each(schemas)(
    '%s rejects any other control character and the Unicode line separators',
    (_, schema) => {
      for (const char of [
        '\t',
        '\u0000', // NUL
        '\u001b', // ESC
        '\u007f', // DEL
        '\u0085', // NEL (next line)
        '\u2028', // line separator
        '\u2029', // paragraph separator
      ]) {
        expect(nameIssues(schema, `Birthday${char}List`)).toEqual([
          { path: ['name'], message: NAME_ERROR },
        ]);
      }
    }
  );

  // regression: the name was checked for length before it was trimmed, so
  // `min(1)` saw "   ", passed it, and the trim left "". The model's `required`
  // then refused the empty name, which the routes answered as a 500.
  it.each(schemas)('regression: %s rejects a name that is only whitespace', (_, schema) => {
    for (const name of ['   ', '\t\n ', '  ']) {
      expect(nameIssues(schema, name)).toEqual([
        { path: ['name'], message: 'Wishlist name is required' },
      ]);
    }
  });

  it.each(schemas)('%s counts the 100-character limit after trimming', (_, schema) => {
    const res = schema.safeParse({ name: `  ${'x'.repeat(100)}  ` });
    expect(res.success && res.data.name).toBe('x'.repeat(100));
    expect(nameIssues(schema, `  ${'x'.repeat(101)}  `)).toEqual([
      { path: ['name'], message: 'Name must be 100 characters or less' },
    ]);
  });

  it.each(schemas)('%s still just trims a line break at either end', (_, schema) => {
    const res = schema.safeParse({ name: '\r\n  Birthday \n' });
    expect(res.success && res.data.name).toBe('Birthday');
  });

  it.each(schemas)('%s keeps ordinary Unicode text, emoji sequences included', (_, schema) => {
    for (const name of ['Café & crème', 'День рождения', '誕生日 🎂', '👨‍👩‍👧 Family (2026)']) {
      const res = schema.safeParse({ name });
      expect(res.success && res.data.name).toBe(name);
    }
  });
});

describe('item name on createItemSchema and updateItemSchema', () => {
  const schemas = [
    ['create', createItemSchema],
    ['update', updateItemSchema],
  ] as const;

  function nameIssues(schema: (typeof schemas)[number][1], name: string) {
    const res = schema.safeParse({ name });
    return res.success ? [] : res.error.issues.map((i) => ({ path: i.path, message: i.message }));
  }

  // regression: same check-before-trim order as the wishlist name: "   " passed
  // `min(1)`, trimmed to "", and the model's `required` turned it into a 500.
  it.each(schemas)('regression: %s rejects a name that is only whitespace', (_, schema) => {
    for (const name of ['   ', '\t\n ']) {
      expect(nameIssues(schema, name)).toEqual([
        { path: ['name'], message: 'Item name is required' },
      ]);
    }
  });

  it.each(schemas)('%s counts the 200-character limit after trimming', (_, schema) => {
    const res = schema.safeParse({ name: `  ${'x'.repeat(200)}  ` });
    expect(res.success && res.data.name).toBe('x'.repeat(200));
    expect(nameIssues(schema, `  ${'x'.repeat(201)}  `)).toEqual([
      { path: ['name'], message: 'Name must be 200 characters or less' },
    ]);
  });
});

// The free-text fields trim before they check their length, so padding around a
// value that fits doesn't push it over the limit.
describe('length limits on trimmed free-text fields', () => {
  const fields = [
    ['wishlist description (create)', createWishlistSchema, { name: 'x' }, 'description', 500],
    ['wishlist description (update)', updateWishlistSchema, {}, 'description', 500],
    ['item notes (create)', createItemSchema, { name: 'x' }, 'notes', 100],
    ['item notes (update)', updateItemSchema, {}, 'notes', 100],
    ['profile bio', updateProfileSchema, {}, 'bio', 300],
  ] as const;

  it.each(fields)('%s counts its limit after trimming', (_, schema, base, field, max) => {
    const fits = schema.safeParse({ ...base, [field]: `  ${'x'.repeat(max)}  ` });
    expect(fits.success && (fits.data as Record<string, unknown>)[field]).toBe('x'.repeat(max));
    const tooLong = schema.safeParse({ ...base, [field]: `  ${'x'.repeat(max + 1)}  ` });
    expect(tooLong.success).toBe(false);
  });
});

describe('updateWishlistSchema', () => {
  it('requires at least one field', () => {
    expect(updateWishlistSchema.safeParse({}).success).toBe(false);
  });
  it('validates slug format', () => {
    expect(updateWishlistSchema.safeParse({ slug: 'my-list' }).success).toBe(true);
    expect(updateWishlistSchema.safeParse({ slug: 'ab' }).success).toBe(false); // < 3
    expect(updateWishlistSchema.safeParse({ slug: '-bad' }).success).toBe(false);
    expect(updateWishlistSchema.safeParse({ slug: 'Bad Slug' }).success).toBe(false);
  });
});

describe('occasion on updateWishlistSchema', () => {
  const yearly = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' } as const;
  const once = { kind: 'wedding', date: '2027-06-12', recurrence: null } as const;
  const parse = (value: unknown) => updateWishlistSchema.safeParse({ occasion: value });
  const issues = (value: unknown) => {
    const res = parse(value);
    return res.success ? [] : res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };

  it('accepts a yearly occasion, a one-off (recurrence null), and null, which clears it', () => {
    expect(parse(yearly).data).toEqual({ occasion: yearly });
    expect(parse(once).data).toEqual({ occasion: once });
    expect(parse(null).data).toEqual({ occasion: null });
  });

  it('accepts every kind', () => {
    for (const kind of ['birthday', 'holiday', 'wedding', 'other']) {
      expect(occasionSchema.safeParse({ ...once, kind }).success).toBe(true);
    }
  });

  // A yearly occasion keeps only its day and month: whatever year it's sent
  // with (a birth year, say) is replaced, so no real year is ever stored.
  it("replaces a yearly occasion's year with the placeholder year", () => {
    for (const date of ['1990-10-14', '2027-10-14', '2000-10-14']) {
      expect(parse({ ...yearly, date }).data).toEqual({
        occasion: { ...yearly, date: '2000-10-14' },
      });
    }
  });

  it('accepts Feb 29 as a yearly date, whatever year it comes with, and refuses Feb 30', () => {
    expect(parse({ ...yearly, date: '1990-02-29' }).data?.occasion?.date).toBe('2000-02-29');
    expect(parse({ ...yearly, date: '2027-02-29' }).data?.occasion?.date).toBe('2000-02-29');
    expect(issues({ ...yearly, date: '1990-02-30' })).toEqual(['occasion.date: Pick a real date']);
    expect(issues({ ...yearly, date: '1990-04-31' })).toEqual(['occasion.date: Pick a real date']);
  });

  it("keeps a one-off's real year, and accepts its Feb 29 only in a leap year", () => {
    expect(parse({ ...once, date: '2028-02-29' }).data?.occasion?.date).toBe('2028-02-29');
    expect(issues({ ...once, date: '2027-02-29' })).toEqual(['occasion.date: Pick a real date']);
  });

  // The server can't know the viewer's date, and every one-off ends up past.
  it('accepts a one-off whose date has passed', () => {
    expect(parse({ ...once, date: '2020-06-12' }).data).toEqual({
      occasion: { ...once, date: '2020-06-12' },
    });
  });

  it('refuses a date that does not exist or is not a plain YYYY-MM-DD date', () => {
    for (const occasion of [yearly, once]) {
      for (const date of [
        '2026-02-30',
        '2026-13-01',
        '2026-1-5',
        '2026-10-14T00:00:00.000Z',
        '14/10/2026',
        '10-14',
        '',
      ]) {
        expect(issues({ ...occasion, date })).toEqual(['occasion.date: Pick a real date']);
      }
      expect(issues({ ...occasion, date: 1791936000000 })).toHaveLength(1);
    }
  });

  it('refuses an occasion without a kind, or with one it does not know', () => {
    expect(issues({ date: once.date, recurrence: null })).toEqual([
      'occasion.kind: Pick an occasion',
    ]);
    expect(issues({ ...once, kind: 'anniversary' })).toEqual(['occasion.kind: Pick an occasion']);
  });

  it('refuses an occasion without a date or a recurrence', () => {
    expect(issues({ kind: 'birthday', recurrence: null })).toHaveLength(1);
    expect(issues({ kind: 'birthday', date: once.date })).toEqual([
      expect.stringMatching(/^occasion\.recurrence: /),
    ]);
    expect(issues({ ...yearly, recurrence: 'monthly' })).toEqual([
      expect.stringMatching(/^occasion\.recurrence: /),
    ]);
  });

  it('drops fields an occasion does not have', () => {
    const res = occasionSchema.safeParse({ ...once, remindDaysBefore: 3 });
    expect(res.data).toEqual(once);
  });
});

describe('updateProfileSchema', () => {
  it('accepts a bio up to 300 chars and rejects longer', () => {
    expect(updateProfileSchema.safeParse({ bio: 'hello' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ bio: 'x'.repeat(301) }).success).toBe(false);
  });
  it('lowercases username and enforces the format', () => {
    const ok = updateProfileSchema.safeParse({ username: 'John_Doe' });
    expect(ok.success && ok.data.username).toBe('john_doe');
    expect(updateProfileSchema.safeParse({ username: 'ab' }).success).toBe(false);
  });
  // The settings page sends only the privacy settings it changed, and the route
  // writes only those, so the schema mustn't fill in the others.
  it.each([{ searchable: false }, { whoCanInvite: 'nobody' }, { profileVisibility: 'friends' }])(
    'accepts a single privacy setting, and adds none it was not sent (%o)',
    (privacy) => {
      const ok = updateProfileSchema.safeParse({ privacy });
      expect(ok.success && ok.data).toEqual({ privacy });
    }
  );
  it('refuses a privacy setting outside its options', () => {
    expect(updateProfileSchema.safeParse({ privacy: { whoCanInvite: 'admins' } }).success).toBe(
      false
    );
    expect(
      updateProfileSchema.safeParse({ privacy: { profileVisibility: 'nobody' } }).success
    ).toBe(false);
    expect(updateProfileSchema.safeParse({ privacy: { searchable: 'no' } }).success).toBe(false);
  });
});

describe('inviteMemberSchema', () => {
  it('accepts a username and defaults role to member', () => {
    const ok = inviteMemberSchema.safeParse({ username: 'mikita' });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.role).toBe('member');
  });

  it('accepts an explicit owner role', () => {
    const ok = inviteMemberSchema.safeParse({ username: 'mikita', role: 'owner' });
    expect(ok.success && ok.data.role).toBe('owner');
  });

  // The admin tier is gone: a wishlist has owners and members, nothing between.
  it('rejects the retired admin role', () => {
    expect(inviteMemberSchema.safeParse({ username: 'mikita', role: 'admin' }).success).toBe(false);
  });

  // Regression: invites are registered-users-only now. Email must be required as
  // username and NOT accepted as an invite target.
  it('regression: requires username; email alone is rejected', () => {
    expect(inviteMemberSchema.safeParse({}).success).toBe(false);
    expect(inviteMemberSchema.safeParse({ email: 'someone@example.com' }).success).toBe(false);
  });
});

describe('createItemSchema', () => {
  it('requires a name and defaults status to available', () => {
    const ok = createItemSchema.safeParse({ name: 'Toy' });
    expect(ok.success && ok.data.status).toBe('available');
  });
  it('validates the price object (integer cents, currency)', () => {
    expect(
      createItemSchema.safeParse({ name: 'x', price: { value: 999, currency: 'USD' } }).success
    ).toBe(true);
    expect(
      createItemSchema.safeParse({ name: 'x', price: { value: 9.99, currency: 'usd' } }).success
    ).toBe(false); // non-integer cents
  });

  // regression: the create schema accepted `booked` / `completed`, so a create
  // could make an item that is already booked with no Reservation behind it.
  it('regression: only allows draft, available and proposed as a status', () => {
    for (const status of ['draft', 'available', 'proposed']) {
      expect(createItemSchema.safeParse({ name: 'Toy', status }).success).toBe(true);
    }
    for (const status of ['booked', 'completed', 'bogus']) {
      expect(createItemSchema.safeParse({ name: 'Toy', status }).success).toBe(false);
    }
  });

  // regression: the create schema passed `bookedBy` through to the route, which
  // stored it as given.
  it('regression: drops a client-sent bookedBy', () => {
    const parsed = createItemSchema.safeParse({ name: 'Toy', bookedBy: 'someone' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'bookedBy' in parsed.data).toBe(false);
  });

  // regression: the create schema accepted a `proposedBy` the route ignores (it
  // sets the proposer from the session), a dead client-controlled field.
  it('regression: drops a client-sent proposedBy', () => {
    const parsed = createItemSchema.safeParse({
      name: 'Toy',
      status: 'proposed',
      proposedBy: 'someone',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'proposedBy' in parsed.data).toBe(false);
  });
});

describe('mostWanted on the item schemas', () => {
  it('is optional on create and accepts a boolean', () => {
    const omitted = createItemSchema.safeParse({ name: 'Toy' });
    expect(omitted.success && omitted.data.mostWanted).toBeUndefined();
    const set = createItemSchema.safeParse({ name: 'Toy', mostWanted: true });
    expect(set.success && set.data.mostWanted).toBe(true);
  });

  it('rejects a non-boolean value', () => {
    for (const mostWanted of ['true', 1, null]) {
      expect(createItemSchema.safeParse({ name: 'Toy', mostWanted }).success).toBe(false);
      expect(updateItemSchema.safeParse({ mostWanted }).success).toBe(false);
    }
  });

  it('counts as the one field an update needs, including false', () => {
    const cleared = updateItemSchema.safeParse({ mostWanted: false });
    expect(cleared.success && cleared.data.mostWanted).toBe(false);
  });
});

describe('updateItemSchema', () => {
  it('requires at least one field', () => {
    expect(updateItemSchema.safeParse({}).success).toBe(false);
  });

  // Regression: the item-coupled `gifted` flag was removed (gifting moved to the
  // Reservation/GiftLog flow). It must not survive parsing as a recognised field.
  it('regression: does not accept a `gifted` field', () => {
    const res = updateItemSchema.safeParse({ status: 'available', gifted: true });
    expect(res.success).toBe(true);
    expect(res.success && res.data).not.toHaveProperty('gifted');
  });

  // regression: the update schema passed `bookedBy` through, and the owner branch
  // stored it as given: a booking with no Reservation behind it.
  it('regression: drops a client-sent bookedBy and proposedBy', () => {
    const res = updateItemSchema.safeParse({ name: 'Toy', bookedBy: 'a', proposedBy: 'b' });
    expect(res.success).toBe(true);
    expect(res.success && res.data).toEqual({ name: 'Toy' });
    // With nothing else, there's no field left to update.
    expect(updateItemSchema.safeParse({ bookedBy: 'a' }).success).toBe(false);
    expect(updateItemSchema.safeParse({ bookedBy: null }).success).toBe(false);
  });
});

describe('magicLinkRequestSchema', () => {
  it('trims the email and defaults callbackUrl to /', () => {
    const ok = magicLinkRequestSchema.safeParse({ email: '  me@example.com ' });
    expect(ok.success && ok.data).toEqual({ email: 'me@example.com', callbackUrl: '/' });
  });

  it('turns an empty or absurdly long callbackUrl into /', () => {
    for (const callbackUrl of ['', '   ', `/${'x'.repeat(2048)}`]) {
      const ok = magicLinkRequestSchema.safeParse({ email: 'me@example.com', callbackUrl });
      expect(ok.success && ok.data.callbackUrl).toBe('/');
    }
  });

  it('keeps a callbackUrl and a token', () => {
    const ok = magicLinkRequestSchema.safeParse({
      email: 'me@example.com',
      callbackUrl: '/invites',
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    });
    expect(ok.success && ok.data).toEqual({
      email: 'me@example.com',
      callbackUrl: '/invites',
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    });
  });

  it('rejects a missing, blank, non-string or over-long email', () => {
    for (const email of [undefined, '', '   ', 42, `${'a'.repeat(243)}@example.com`]) {
      expect(magicLinkRequestSchema.safeParse({ email }).success).toBe(false);
    }
  });

  it('rejects a non-string callbackUrl or token', () => {
    const email = 'me@example.com';
    expect(magicLinkRequestSchema.safeParse({ email, callbackUrl: 42 }).success).toBe(false);
    expect(magicLinkRequestSchema.safeParse({ email, turnstileToken: 42 }).success).toBe(false);
  });

  // The token's own checks (missing, too long) belong to verifyTurnstileToken,
  // which answers them as a failed check rather than as bad input.
  it('lets a null, empty or long token through to the Turnstile check', () => {
    const email = 'me@example.com';
    for (const turnstileToken of [null, '', 'x'.repeat(5000)]) {
      expect(magicLinkRequestSchema.safeParse({ email, turnstileToken }).success).toBe(true);
    }
  });
});
