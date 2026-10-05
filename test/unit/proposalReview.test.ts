import { describe, it, expect } from 'vitest';
import { isNewerVersion, proposalReviewState } from '@/lib/utils/proposalReview';

describe('proposalReviewState', () => {
  const items = [
    { _id: 'p', status: 'proposed' },
    { _id: 'a', status: 'available' },
    { _id: 'd', status: 'draft' },
    // An owner's list never reads `booked`, but a reviewed item is reviewed whatever it became.
    { _id: 'b', status: 'booked' },
  ];

  it('is proposed while the list still reads it as a proposal', () => {
    expect(proposalReviewState(items, 'p')).toBe('proposed');
  });

  it.each(['a', 'd', 'b'])('is reviewed once it has any other status (%s)', (id) => {
    expect(proposalReviewState(items, id)).toBe('reviewed');
  });

  it('is gone once the list no longer has it', () => {
    expect(proposalReviewState(items, 'x')).toBe('gone');
  });
});

describe('isNewerVersion', () => {
  const at = (iso: string) => `2026-10-05T${iso}Z`;

  it('is true only for a later updatedAt', () => {
    expect(isNewerVersion(at('10:00:01.000'), at('10:00:00.000'))).toBe(true);
    expect(isNewerVersion(at('10:00:00.000'), at('10:00:00.000'))).toBe(false);
    // An older poll never replaces what the dialog holds.
    expect(isNewerVersion(at('09:59:59.000'), at('10:00:00.000'))).toBe(false);
  });

  it('never takes a version it cannot read', () => {
    expect(isNewerVersion(undefined, at('10:00:00.000'))).toBe(false);
    expect(isNewerVersion('garbage', at('10:00:00.000'))).toBe(false);
    expect(isNewerVersion(at('10:00:00.000'), undefined)).toBe(true);
  });
});
