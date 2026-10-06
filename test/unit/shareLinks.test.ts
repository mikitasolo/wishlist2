import { describe, it, expect } from 'vitest';
import { generateShareToken, isShareLinkExpired, serializeShareLink } from '@/lib/utils/shareLinks';
import {
  isShareTokenFormat,
  SHARE_TOKEN_LENGTH,
  shareLinkTokenFromCallback,
} from '@/lib/utils/shareLinkFields';
import { createShareLinkSchema, updateShareLinkSchema } from '@/lib/validations';
import mongoose from 'mongoose';

// WIS-334: share link tokens, and the schemas the owners' link API reads.

const BASE62 = /^[0-9A-Za-z]+$/;

/** A random source that hands out `bytes` in order, then repeats the last. */
function fixedBytes(bytes: number[]) {
  let i = 0;
  return (size: number) =>
    Buffer.from(Array.from({ length: size }, () => bytes[Math.min(i++, bytes.length - 1)]));
}

describe('generateShareToken', () => {
  it('makes 22 base62 characters that pass isShareTokenFormat', () => {
    for (let n = 0; n < 200; n++) {
      const token = generateShareToken();
      expect(token).toHaveLength(SHARE_TOKEN_LENGTH);
      expect(token).toMatch(BASE62);
      expect(isShareTokenFormat(token)).toBe(true);
    }
  });

  it('makes a different token each time', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateShareToken()));
    expect(tokens.size).toBe(1000);
  });

  it('maps bytes 0–247 onto the alphabet and throws away 248–255 (no modulo bias)', () => {
    // 248..255 would map onto '0'..'7' a ninth time if kept.
    const token = generateShareToken(fixedBytes([248, 255, 0, 61, 62, 247, 250, 1]));
    expect(token.slice(0, 5)).toBe('0z0z1');
    expect(token).toHaveLength(SHARE_TOKEN_LENGTH);
  });

  it('asks for more bytes when a batch had too many thrown away', () => {
    // A whole first batch of rejected bytes, then usable ones.
    const batches = [Array(30).fill(255), Array(30).fill(10)];
    let call = 0;
    const token = generateShareToken((size) => Buffer.from(batches[call++].slice(0, size)));
    expect(call).toBe(2);
    expect(token).toBe('A'.repeat(SHARE_TOKEN_LENGTH));
  });
});

describe('isShareTokenFormat', () => {
  it.each([
    ['too short', 'a'.repeat(21)],
    ['too long', 'a'.repeat(23)],
    ['a dash', 'a'.repeat(21) + '-'],
    ['an underscore', 'a'.repeat(21) + '_'],
    ['a non-ASCII letter', 'a'.repeat(21) + 'é'],
    ['a trailing newline', 'a'.repeat(22) + '\n'],
    ['empty', ''],
  ])('refuses a string with %s', (_, value) => {
    expect(isShareTokenFormat(value)).toBe(false);
  });

  it.each([
    ['an operator object', { $ne: null }],
    ['a regex operator', { $regex: '.*' }],
    ['an array', ['a'.repeat(22)]],
    ['a number', 1234567890123456789012],
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s', (_, value) => {
    expect(isShareTokenFormat(value)).toBe(false);
  });
});

describe('isShareLinkExpired', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  it('is live without an expiry, and until the expiry passes', () => {
    expect(isShareLinkExpired({ expiresAt: null }, now)).toBe(false);
    expect(isShareLinkExpired({ expiresAt: new Date(now.getTime() + 1) }, now)).toBe(false);
  });
  it('is expired at and after the expiry', () => {
    expect(isShareLinkExpired({ expiresAt: now }, now)).toBe(true);
    expect(isShareLinkExpired({ expiresAt: new Date(now.getTime() - 1) }, now)).toBe(true);
  });
});

describe('serializeShareLink', () => {
  const link = {
    _id: new mongoose.Types.ObjectId(),
    wishlist: new mongoose.Types.ObjectId(),
    token: 'A'.repeat(22),
    level: 'view' as const,
    label: 'Family chat',
    expiresAt: null,
    createdBy: new mongoose.Types.ObjectId(),
    createdAt: new Date(),
  };

  it('carries the token only when asked, and never who made it', () => {
    const without = serializeShareLink(link, { withToken: false });
    expect(JSON.stringify(without)).not.toContain(link.token);
    expect(without).not.toHaveProperty('createdBy');
    expect(without).not.toHaveProperty('wishlist');
    expect(serializeShareLink(link, { withToken: true }).token).toBe(link.token);
  });
});

describe('createShareLinkSchema', () => {
  it('needs a level, view or join', () => {
    expect(createShareLinkSchema.safeParse({}).success).toBe(false);
    expect(createShareLinkSchema.safeParse({ level: 'owner' }).success).toBe(false);
    expect(createShareLinkSchema.parse({ level: 'join' })).toEqual({ level: 'join' });
  });

  it('trims the label, and takes a blank one as none', () => {
    expect(createShareLinkSchema.parse({ level: 'view', label: '  Wedding QR ' }).label).toBe(
      'Wedding QR'
    );
    expect(createShareLinkSchema.parse({ level: 'view', label: '   ' }).label).toBeNull();
    expect(createShareLinkSchema.parse({ level: 'view', label: '​' }).label).toBeNull();
  });

  it('refuses a label over 40 characters (after trimming), or one with a line break or bidi override', () => {
    expect(createShareLinkSchema.safeParse({ level: 'view', label: 'a'.repeat(40) }).success).toBe(
      true
    );
    expect(
      createShareLinkSchema.safeParse({ level: 'view', label: ` ${'a'.repeat(40)} ` }).success
    ).toBe(true);
    expect(createShareLinkSchema.safeParse({ level: 'view', label: 'a'.repeat(41) }).success).toBe(
      false
    );
    expect(createShareLinkSchema.safeParse({ level: 'view', label: 'a\nb' }).success).toBe(false);
    expect(createShareLinkSchema.safeParse({ level: 'view', label: 'a‮b' }).success).toBe(false);
  });

  it('takes an ISO expiry as a date, or null for never', () => {
    const parsed = createShareLinkSchema.parse({
      level: 'view',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    expect(parsed.expiresAt).toEqual(new Date('2027-01-01T00:00:00.000Z'));
    expect(createShareLinkSchema.parse({ level: 'view', expiresAt: null }).expiresAt).toBeNull();
    expect(createShareLinkSchema.safeParse({ level: 'view', expiresAt: 'soon' }).success).toBe(
      false
    );
    expect(
      createShareLinkSchema.safeParse({ level: 'view', expiresAt: 1_800_000_000 }).success
    ).toBe(false);
  });

  it('refuses a token, or anything else it does not know', () => {
    expect(createShareLinkSchema.safeParse({ level: 'view', token: 'A'.repeat(22) }).success).toBe(
      false
    );
    expect(createShareLinkSchema.safeParse({ level: 'view', wishlist: 'x' }).success).toBe(false);
  });

  it.each(['level', 'label', 'expiresAt'])('refuses an operator object as %s', (field) => {
    const body = { level: 'view', [field]: { $ne: null } };
    expect(createShareLinkSchema.safeParse(body).success).toBe(false);
  });
});

describe('updateShareLinkSchema', () => {
  it('refuses a level: it is fixed when the link is made', () => {
    expect(updateShareLinkSchema.safeParse({ level: 'join' }).success).toBe(false);
    expect(updateShareLinkSchema.safeParse({ label: 'x', level: 'view' }).success).toBe(false);
  });

  it('needs something to change', () => {
    expect(updateShareLinkSchema.safeParse({}).success).toBe(false);
  });

  it('can clear the label and the expiry', () => {
    expect(updateShareLinkSchema.parse({ label: null, expiresAt: null })).toEqual({
      label: null,
      expiresAt: null,
    });
  });

  it.each(['label', 'expiresAt'])('refuses an operator object as %s', (field) => {
    expect(updateShareLinkSchema.safeParse({ [field]: { $ne: null } }).success).toBe(false);
  });
});

describe('shareLinkTokenFromCallback (WIS-339)', () => {
  const ORIGIN = 'https://wishlist.test';
  const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

  it.each([
    [`/l/${TOKEN}`, TOKEN],
    [`/l/${TOKEN}?then=join`, TOKEN],
    [`/l/${TOKEN}/`, TOKEN],
    [`${ORIGIN}/l/${TOKEN}?then=ask#x`, TOKEN],
  ])('finds the token in %s', (raw, expected) => {
    expect(shareLinkTokenFromCallback(raw, ORIGIN)).toBe(expected);
  });

  it.each([
    null,
    '',
    '/invites',
    `/wishlists/${TOKEN}`,
    `/l/${TOKEN}/more`,
    '/l/short',
    `/l/${TOKEN.slice(0, 21)}$`,
    `https://evil.example/l/${TOKEN}`,
    `//evil.example/l/${TOKEN}`,
    'http://[bad',
  ])('finds none in %s', (raw) => {
    expect(shareLinkTokenFromCallback(raw, ORIGIN)).toBeNull();
  });
});
