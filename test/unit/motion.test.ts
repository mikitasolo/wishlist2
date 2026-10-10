import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  cardMotionFor,
  MOTION_MS,
  prefersReducedMotion,
  STAGGER_MAX_STEPS,
  STAGGER_STEP_MS,
  STAGGER_TOTAL_MS,
  CARD_IN_MS,
  waitForMotion,
  type CardMotion,
} from '@/lib/utils/motion';

const viewer = { isOwner: false, discreet: false, reducedMotion: false };

describe('cardMotionFor (WIS-407)', () => {
  it("plays every moment for a member's own action", () => {
    for (const motion of ['reserve', 'release', 'given', 'cue'] as CardMotion[]) {
      expect(cardMotionFor(motion, viewer)).toBe(motion);
    }
  });

  // Owners are booking-blind: a reservation's motion would tell them about it.
  it('never plays reservation motion for an owner', () => {
    for (const motion of ['reserve', 'release', 'given'] as CardMotion[]) {
      expect(cardMotionFor(motion, { ...viewer, isOwner: true })).toBeNull();
    }
    expect(cardMotionFor('cue', { ...viewer, isOwner: true })).toBe('cue');
  });

  it('never plays reservation motion in discreet mode', () => {
    for (const motion of ['reserve', 'release', 'given'] as CardMotion[]) {
      expect(cardMotionFor(motion, { ...viewer, discreet: true })).toBeNull();
    }
    expect(cardMotionFor('cue', { ...viewer, discreet: true })).toBe('cue');
  });

  it('plays nothing under reduced motion', () => {
    for (const motion of ['reserve', 'release', 'given', 'cue'] as CardMotion[]) {
      expect(cardMotionFor(motion, { ...viewer, reducedMotion: true })).toBeNull();
    }
  });

  it('keeps the given moment subtle, at about 600ms', () => {
    expect(MOTION_MS.given).toBe(600);
  });

  it('times the stagger to the CSS: eight steps, then the last card’s entrance', () => {
    expect(STAGGER_TOTAL_MS).toBe(STAGGER_STEP_MS * STAGGER_MAX_STEPS + CARD_IN_MS);
  });
});

describe('prefersReducedMotion', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is false where it cannot be known (no window)', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('follows the media query', () => {
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }),
    });
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe('waitForMotion', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves at once with no moment playing', async () => {
    await expect(waitForMotion(null)).resolves.toBeUndefined();
  });

  it('waits out the moment', async () => {
    vi.useFakeTimers();
    let done = false;
    const waiting = waitForMotion('given').then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(MOTION_MS.given - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(done).toBe(true);
  });
});
