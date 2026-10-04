import { describe, it, expect } from 'vitest';
import { proposalReviewState } from '@/lib/utils/proposalReview';

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
