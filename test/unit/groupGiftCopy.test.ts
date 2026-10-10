import { describe, expect, it } from 'vitest';
import { GROUP_GIFT_TOASTS, leaveGroupGiftToast } from '@/lib/utils/groupGiftCopy';
import type { GroupGiftSummary } from '@/lib/utils/groupGiftSummary';

function gift(organizer: boolean, people: number): GroupGiftSummary {
  return {
    contributing: true,
    organizer,
    status: 'open',
    target: { value: 10000, currency: 'EUR' },
    pledgedTotal: 5000,
    percentFunded: 50,
    contributors: Array.from({ length: people }, (_, i) => ({
      name: `Person ${i}`,
      you: i === 0,
    })) as never,
  };
}

// WIS-387: the Undo toast says what a leave does, as the confirmation it
// replaced did, and names no one.
describe('leaveGroupGiftToast', () => {
  it('says the last one out ends it', () => {
    expect(leaveGroupGiftToast(gift(true, 1))).toMatch(/has ended.*available again/);
  });
  it('says an organizer hands it on, naming no one', () => {
    const line = leaveGroupGiftToast(gift(true, 3));
    expect(line).toMatch(/joined first is organizer now/);
    expect(line).not.toMatch(/Person/);
  });
  it('is the plain line for a contributor, or without a summary', () => {
    expect(leaveGroupGiftToast(gift(false, 3))).toBe(GROUP_GIFT_TOASTS.leave);
    expect(leaveGroupGiftToast(undefined)).toBe(GROUP_GIFT_TOASTS.leave);
  });
});
