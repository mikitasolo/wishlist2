import { describe, it, expect } from 'vitest';
import {
  activityBump,
  isReturnAfterGap,
  TOUR_VERSION,
  tourDone,
  walkthroughDue,
  walkthroughWrite,
} from '@/lib/utils/walkthrough';
import { countedSteps, tourAllowedOn, tourSteps } from '@/lib/utils/tourSteps';
import { placeTourPopover } from '@/lib/utils/tourPlacement';
import { ANALYTICS_EVENTS } from '@/lib/analytics';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-09T12:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * DAY);

describe('walkthroughDue', () => {
  it('has the tour due for a new account', () => {
    expect(walkthroughDue(undefined)).toBe('tour');
    expect(walkthroughDue({})).toBe('tour');
  });

  it('has nothing due once finished or skipped', () => {
    expect(walkthroughDue({ version: TOUR_VERSION, completedAt: ago(1) })).toBeNull();
    expect(walkthroughDue({ version: TOUR_VERSION, skippedAt: ago(1) })).toBeNull();
  });

  it('shows a new version to people who finished an older one', () => {
    expect(walkthroughDue({ version: TOUR_VERSION - 1, completedAt: ago(1) })).toBe('tour');
    expect(tourDone({ completedAt: ago(1) })).toBe(false);
  });

  it('offers it once offered and not answered since', () => {
    const done = { version: TOUR_VERSION, completedAt: ago(200) };
    expect(walkthroughDue({ ...done, offeredAt: ago(0) })).toBe('offer');
    expect(walkthroughDue({ ...done, offeredAt: ago(1), offerAnsweredAt: ago(0) })).toBeNull();
    // Dismissed, then another gap: offered again.
    expect(walkthroughDue({ ...done, offeredAt: ago(0), offerAnsweredAt: ago(95) })).toBe('offer');
  });

  it('the tour wins over an offer', () => {
    expect(walkthroughDue({ offeredAt: ago(0) })).toBe('tour');
  });
});

describe('isReturnAfterGap', () => {
  it('is 90 days, not 89', () => {
    expect(isReturnAfterGap(ago(89), now)).toBe(false);
    expect(isReturnAfterGap(new Date(now.getTime() - 90 * DAY + 1), now)).toBe(false);
    expect(isReturnAfterGap(ago(90), now)).toBe(true);
  });

  it('never for an account with no last visit', () => {
    expect(isReturnAfterGap(undefined, now)).toBe(false);
  });
});

describe('activityBump', () => {
  it('matches only a visit not recorded in the last day, and bumps it', () => {
    const { filter, update } = activityBump(now);
    expect(filter).toEqual({ $or: [{ lastActiveAt: null }, { lastActiveAt: { $lte: ago(1) } }] });
    expect(update.at(-1)).toEqual({ $set: { lastActiveAt: now } });
  });
});

describe('walkthroughWrite', () => {
  it('marks this version done on finish or skip, answering any offer', () => {
    expect(walkthroughWrite('completed', now).$set).toMatchObject({
      'walkthrough.completedAt': now,
      'walkthrough.version': TOUR_VERSION,
      'walkthrough.offerAnsweredAt': now,
    });
    expect(walkthroughWrite('skipped', now).$set).toMatchObject({
      'walkthrough.skippedAt': now,
      'walkthrough.version': TOUR_VERSION,
    });
  });

  it('restart clears done', () => {
    expect(walkthroughWrite('restart', now)).toMatchObject({
      $unset: { 'walkthrough.completedAt': '', 'walkthrough.skippedAt': '' },
    });
  });
});

describe('tourSteps', () => {
  it('is one tour: six steps on a desktop, five without the bookmarklet, then a closing card', () => {
    const desktop = tourSteps({ desktop: true, ownsList: true });
    const phone = tourSteps({ desktop: false, ownsList: true });
    expect(desktop.map((s) => s.key)).toEqual([
      'lists',
      'items',
      'sharing',
      'reserving',
      'reserved',
      'bookmarklet',
      'closing',
    ]);
    expect(countedSteps(desktop)).toBe(6);
    expect(countedSteps(phone)).toBe(5);
    expect(phone.some((s) => s.key === 'bookmarklet')).toBe(false);
  });

  it('offers Create a list at the end only to someone who owns no list', () => {
    expect(tourSteps({ desktop: true, ownsList: false }).at(-1)).toMatchObject({
      closing: true,
      createList: true,
    });
    expect(tourSteps({ desktop: true, ownsList: true }).at(-1)?.createList).toBeFalsy();
    // The same steps either way: nothing depends on having a list.
    expect(tourSteps({ desktop: true, ownsList: false }).map((s) => s.key)).toEqual(
      tourSteps({ desktop: true, ownsList: true }).map((s) => s.key)
    );
  });

  it('gives every step about a feature a made-up picture', () => {
    for (const key of ['lists', 'items', 'sharing', 'reserving']) {
      const step = tourSteps({ desktop: true, ownsList: true }).find((s) => s.key === key);
      expect(step?.illustration, key).toBeDefined();
    }
  });

  it('can report every skippable step to analytics', () => {
    const allowed: readonly string[] = ANALYTICS_EVENTS.tour_skipped.step;
    for (const step of tourSteps({ desktop: true, ownsList: false })) {
      if (!step.closing) expect(allowed).toContain(step.key);
    }
  });

  it('says reserve, never book (D1)', () => {
    const copy = tourSteps({ desktop: true, ownsList: false })
      .map((s) => `${s.title} ${s.body}`)
      .join(' ');
    expect(copy).not.toMatch(/\bbook(ed|ing)?\b/i);
  });
});

describe('tourAllowedOn', () => {
  it('stays off the sign-in flow, Welcome, the bookmarklet page, share links and unsubscribe', () => {
    for (const path of ['/auth/signin', '/welcome', '/items/new', '/l/abc', '/unsubscribe']) {
      expect(tourAllowedOn(path), path).toBe(false);
    }
    for (const path of ['/', '/settings', '/items', '/wishlists/x', '/booked', '/notifications']) {
      expect(tourAllowedOn(path), path).toBe(true);
    }
  });
});

describe('placeTourPopover', () => {
  const viewport = { width: 390, height: 800 };
  const popover = { width: 320, height: 160 };

  it('goes below the target when it fits, centred on it and inside the gutter', () => {
    const p = placeTourPopover({ top: 100, left: 300, width: 80, height: 40 }, popover, viewport);
    expect(p.side).toBe('below');
    expect(p.top).toBe(152);
    // Centred would overflow the right edge: held at the 16px gutter.
    expect(p.left).toBe(390 - 16 - 320);
  });

  it('goes above when there is no room below', () => {
    const p = placeTourPopover({ top: 700, left: 20, width: 80, height: 40 }, popover, viewport);
    expect(p.side).toBe('above');
    expect(p.top).toBe(700 - 12 - 160);
    expect(p.left).toBe(16);
  });

  it('stays on screen when neither side has room', () => {
    const p = placeTourPopover({ top: 20, left: 20, width: 350, height: 760 }, popover, viewport);
    expect(p.top).toBeGreaterThanOrEqual(16);
    expect(p.top + popover.height).toBeLessThanOrEqual(800 - 16);
  });
});
