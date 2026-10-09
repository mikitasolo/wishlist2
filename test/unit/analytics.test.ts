// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  ANALYTICS_EVENTS,
  UMAMI_BEFORE_SEND,
  UNKNOWN_PATH,
  installBeforeSend,
  normalizePath,
  resetAnalyticsForTests,
  sanitizeProps,
  scrubPayload,
  scrubReferrer,
  track,
  trackPageView,
} from '@/lib/analytics';

// A share token's shape (22 base62), an id and a username: none may ever leave.
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const ID = '665f1c2b9a1e4b0012345678';
const ORIGIN = window.location.origin;

/** Every page under app/, as its route pattern (route groups dropped). */
function appPages(dir = path.join(process.cwd(), 'app'), base = ''): string[] {
  const pages: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'api') continue;
      const segment = /^\(.*\)$/.test(entry) ? '' : `/${entry}`;
      pages.push(...appPages(full, base + segment));
    } else if (/^page\.(tsx|ts|jsx|js)$/.test(entry)) {
      pages.push(base || '/');
    }
  }
  return pages;
}

describe('normalizePath', () => {
  const pages = appPages();

  it('finds the app’s pages, dynamic ones included', () => {
    expect(pages).toEqual(
      expect.arrayContaining(['/', '/l/[token]', '/wishlists/[id]', '/users/[username]'])
    );
  });

  // Every page, so a new one that isn't taught to the normalizer fails here
  // instead of being counted as /[unknown] (or, worse, sent as it is).
  it.each(appPages())('sends %s as its own pattern, never its segment', (pattern) => {
    const sample = pattern.replace(/\[[^\]]+\]/g, TOKEN);
    expect(normalizePath(sample)).toBe(pattern);
    expect(normalizePath(`${sample}?then=ask&as=visitor#item-${ID}`)).toBe(pattern);
    expect(normalizePath(`${sample}/`)).toBe(pattern);
    // A pattern maps to itself.
    expect(normalizePath(pattern)).toBe(pattern);
  });

  it.each([
    [`/l/${TOKEN}`, '/l/[token]'],
    [`/l/${TOKEN}?then=join`, '/l/[token]'],
    [`/wishlists/${ID}?item=${ID}&show=available`, '/wishlists/[id]'],
    ['/wishlists/birthday-2026', '/wishlists/[id]'],
    ['/users/anna_m', '/users/[username]'],
    [`/welcome?callbackUrl=%2Fl%2F${TOKEN}`, '/welcome'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  // regression guard: anything that isn't a page we know could hold anything,
  // a token under a longer path included.
  it.each([
    `/l/${TOKEN}/opengraph-image`,
    `/${TOKEN}`,
    `/wishlists/${ID}/edit`,
    `https://evil.example/l/${TOKEN}`,
    '',
  ])('sends %j as unknown', (input) => {
    expect(normalizePath(input)).toBe(UNKNOWN_PATH);
  });
});

describe('scrubReferrer', () => {
  it('turns one of our pages into its pattern', () => {
    expect(scrubReferrer(`${ORIGIN}/l/${TOKEN}?then=ask`, ORIGIN)).toBe(`${ORIGIN}/l/[token]`);
  });

  it('keeps only another site’s origin', () => {
    expect(scrubReferrer('https://t.me/c/123/456?ref=abc#x', ORIGIN)).toBe('https://t.me');
  });

  it.each([undefined, null, '', 'javascript:alert(1)', 'not a url at all ::'])(
    'sends %j as none',
    (ref) => {
      const out = scrubReferrer(ref, ORIGIN);
      expect(out === '' || out === `${ORIGIN}${UNKNOWN_PATH}`).toBe(true);
    }
  );
});

describe('ANALYTICS_EVENTS', () => {
  // Coarse enums only: a prop must never be able to carry who or which list.
  it('allows no prop that could identify anyone or anything', () => {
    for (const [event, props] of Object.entries(ANALYTICS_EVENTS)) {
      for (const [key, values] of Object.entries(props) as [string, readonly string[]][]) {
        expect(key, `${event}.${key}`).not.toMatch(
          /id|name|user|email|token|slug|price|currency|title|url|list|item/i
        );
        expect(values.length).toBeGreaterThan(0);
        for (const v of values) expect(v).toMatch(/^[a-z_]{1,20}$/);
      }
    }
  });

  it('covers every event the issue lists', () => {
    expect(Object.keys(ANALYTICS_EVENTS).sort()).toEqual(
      [
        'find_a_gift',
        'invite_accepted',
        'invite_sent',
        'item_added',
        'join_requested',
        'list_created',
        'list_shared',
        'mark_given',
        'release',
        'reserve',
        'save_to_my_list',
        'share_link_opened',
      ].sort()
    );
  });
});

describe('sanitizeProps', () => {
  it('keeps allowed props with allowed values', () => {
    expect(sanitizeProps('list_created', { visibility: 'friends', source: 'copy' })).toEqual({
      visibility: 'friends',
      source: 'copy',
    });
  });

  it('drops props the event doesn’t allow, and values outside the enum', () => {
    expect(
      sanitizeProps('list_created', {
        visibility: 'secret',
        listId: ID,
        name: 'Anna’s 30th',
        userId: ID,
        source: 'new',
      })
    ).toEqual({ source: 'new' });
    expect(sanitizeProps('reserve', { itemId: ID, by: 'ivan' })).toBeUndefined();
    expect(sanitizeProps('release', { from: 7 })).toBeUndefined();
    expect(sanitizeProps('mark_given', 'oops')).toBeUndefined();
    // Not fooled by the prototype.
    expect(sanitizeProps('reserve', { toString: 'x', constructor: 'y' })).toBeUndefined();
  });
});

describe('scrubPayload', () => {
  const base = {
    website: 'site-id',
    hostname: 'wishlist.example',
    screen: '390x844',
    language: 'en-GB',
    title: 'Anna’s 30th · Wishlist',
    url: `/l/${TOKEN}?then=ask`,
    referrer: `https://t.me/c/1?x=${TOKEN}`,
    id: 'distinct-user',
    tag: 'something',
  };

  it('rebuilds a page view from the allowed fields, as patterns', () => {
    expect(scrubPayload(base, ORIGIN)).toEqual({
      website: 'site-id',
      hostname: 'wishlist.example',
      screen: '390x844',
      language: 'en-GB',
      url: '/l/[token]',
      title: '/l/[token]',
      referrer: 'https://t.me',
    });
  });

  it('keeps an event’s name and only its allowed props', () => {
    const out = scrubPayload(
      { ...base, name: 'invite_sent', data: { role: 'owner', to: 'group', username: 'anna_m' } },
      ORIGIN
    );
    expect(out).toMatchObject({ name: 'invite_sent', data: { role: 'owner', to: 'group' } });
    expect(JSON.stringify(out)).not.toMatch(new RegExp(`${TOKEN}|anna|distinct-user|30th`));
  });

  it('sends no event that isn’t ours', () => {
    expect(scrubPayload({ ...base, name: 'reserved_by_ivan' }, ORIGIN)).toBeNull();
    expect(scrubPayload(null, ORIGIN)).toBeNull();
  });
});

describe('the wrapper', () => {
  const umamiTrack = vi.fn();
  // What the real tracker hands the callback: the raw page, title and referrer.
  const tracker = {
    website: 'site-id',
    hostname: 'localhost',
    screen: '1280x800',
    language: 'en',
    title: 'Anna’s 30th · Wishlist',
    url: `/l/${TOKEN}`,
    referrer: '',
    id: 'distinct',
  };
  const sent = () => umamiTrack.mock.calls.map(([fn]) => fn(tracker));

  beforeEach(() => {
    resetAnalyticsForTests();
    umamiTrack.mockReset();
  });
  afterEach(() => {
    delete window.umami;
    delete window[UMAMI_BEFORE_SEND];
    window.history.replaceState(null, '', '/');
  });

  it('is a no-op while Umami isn’t loaded', () => {
    expect(window.umami).toBeUndefined();
    expect(track('reserve')).toBe(false);
    expect(trackPageView(`/l/${TOKEN}`)).toBe(false);
  });

  it('sends page views as patterns, each with the last one as its referrer', () => {
    window.umami = { track: umamiTrack };
    expect(trackPageView(`/l/${TOKEN}`)).toBe(true);
    expect(trackPageView(`/wishlists/${ID}`)).toBe(true);
    const [first, second] = sent();
    expect(first).toMatchObject({ url: '/l/[token]', title: '/l/[token]', referrer: '' });
    expect(first).not.toHaveProperty('id');
    expect(second).toMatchObject({
      url: '/wishlists/[id]',
      referrer: `${ORIGIN}/l/[token]`,
    });
    expect(JSON.stringify(sent())).not.toMatch(new RegExp(`${TOKEN}|${ID}|30th|distinct`));
  });

  it('sends an event on the current page’s pattern, with only its allowed props', () => {
    window.umami = { track: umamiTrack };
    window.history.replaceState(null, '', `/l/${TOKEN}?then=join`);
    // A caller that slips past the types still can't send an id.
    const sneaky = { level: 'join', listId: ID } as unknown as { level: 'join' };
    expect(track('share_link_opened', sneaky)).toBe(true);
    const [event] = sent();
    expect(event).toMatchObject({
      name: 'share_link_opened',
      data: { level: 'join' },
      url: '/l/[token]',
      referrer: '',
    });
    expect(JSON.stringify(event)).not.toMatch(new RegExp(`${TOKEN}|${ID}|30th|distinct`));
  });

  it('never lets a tracker failure reach the app', () => {
    window.umami = {
      track: () => {
        throw new Error('blocked');
      },
    };
    expect(track('reserve')).toBe(false);
  });

  it('installs a before-send hook that scrubs whatever the script sends', () => {
    installBeforeSend();
    const hook = window[UMAMI_BEFORE_SEND]!;
    expect(hook('event', { ...tracker, name: 'reserve', data: { itemId: ID } })).toEqual({
      website: 'site-id',
      hostname: 'localhost',
      screen: '1280x800',
      language: 'en',
      url: '/l/[token]',
      title: '/l/[token]',
      referrer: '',
      name: 'reserve',
    });
    // A click the tracker tracked on its own (data-umami-event) isn't ours: dropped.
    expect(hook('event', { ...tracker, name: 'Signup button' })).toBeNull();
  });
});
