import { describe, it, expect } from 'vitest';
import {
  GROUP_GIFT_MAX_CENTS,
  isFunded,
  percentFunded,
  summarizeGroupGift,
} from '@/lib/utils/groupGiftSummary';
import { pledgeGroupGiftSchema, startGroupGiftSchema } from '@/lib/validations';

describe('percentFunded / isFunded', () => {
  it('rounds down, caps at 100, and is funded from the target on', () => {
    expect(percentFunded(0, 10000)).toBe(0);
    expect(percentFunded(3333, 10000)).toBe(33);
    expect(percentFunded(9999, 10000)).toBe(99);
    expect(percentFunded(10000, 10000)).toBe(100);
    expect(percentFunded(25000, 10000)).toBe(100);
    expect(isFunded(9999, 10000)).toBe(false);
    expect(isFunded(10000, 10000)).toBe(true);
  });

  it('treats a target of 0 or less as funded rather than dividing by it', () => {
    expect(percentFunded(0, 0)).toBe(100);
  });
});

describe('summarizeGroupGift', () => {
  const gift = {
    organizer: 'a',
    target: { value: 10000, currency: 'USD' },
    contributors: [
      { user: 'a', pledged: 6000 },
      { user: 'b', pledged: 2000 },
    ],
  };
  const names = new Map([
    ['a', 'anna'],
    ['b', 'ben'],
  ]);

  it('a member who isn’t in it gets only the percent funded and the currency to pledge in', () => {
    expect(summarizeGroupGift(gift, 'c', names)).toEqual({
      contributing: false,
      percentFunded: 80,
      // The currency only: never the target's amount.
      target: { currency: 'USD' },
    });
  });

  it('a contributor gets names and pledges in join order, never user ids', () => {
    const summary = summarizeGroupGift(gift, 'b', names);
    expect(summary).toEqual({
      contributing: true,
      organizer: false,
      status: 'open',
      target: { value: 10000, currency: 'USD' },
      pledgedTotal: 8000,
      percentFunded: 80,
      contributors: [
        { name: 'anna', pledged: 6000, organizer: true, you: false },
        { name: 'ben', pledged: 2000, organizer: false, you: true },
      ],
    });
    expect(JSON.stringify(summary)).not.toMatch(/"(a|b)"/);
  });

  it('the organizer is told so, and a name it lacks reads "Someone"', () => {
    const summary = summarizeGroupGift(gift, 'a', new Map());
    expect(summary).toMatchObject({ organizer: true, contributing: true });
    if (summary.contributing) expect(summary.contributors[1].name).toBe('Someone');
  });
});

describe('group gift schemas', () => {
  it('take whole, positive cents within the cap', () => {
    expect(pledgeGroupGiftSchema.safeParse({ pledged: 1 }).success).toBe(true);
    for (const pledged of [0, -5, 1.5, GROUP_GIFT_MAX_CENTS + 1, '100']) {
      expect(pledgeGroupGiftSchema.safeParse({ pledged }).success).toBe(false);
    }
  });

  it('upper-cases a target’s currency and lets the target be left out', () => {
    expect(startGroupGiftSchema.parse({ pledged: 5 })).toEqual({ pledged: 5 });
    expect(
      startGroupGiftSchema.parse({ pledged: 5, target: { value: 100, currency: ' eur ' } }).target
    ).toEqual({ value: 100, currency: 'EUR' });
  });
});
