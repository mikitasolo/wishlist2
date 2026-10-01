import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { canCopyItem } from '@/lib/utils/itemCopy';

describe('canCopyItem', () => {
  const me = new mongoose.Types.ObjectId().toString();
  const someoneElse = new mongoose.Types.ObjectId().toString();

  it('allows a published item, booked or completed ones included', () => {
    for (const status of ['available', 'booked', 'completed']) {
      expect(canCopyItem({ status }, me)).toBe(true);
    }
  });

  it('never allows a draft', () => {
    expect(canCopyItem({ status: 'draft' }, me)).toBe(false);
  });

  it('allows a proposal only to its proposer, as a string id or an ObjectId', () => {
    expect(canCopyItem({ status: 'proposed', proposedBy: me }, me)).toBe(true);
    expect(
      canCopyItem({ status: 'proposed', proposedBy: new mongoose.Types.ObjectId(me) }, me)
    ).toBe(true);
    expect(canCopyItem({ status: 'proposed', proposedBy: someoneElse }, me)).toBe(false);
    // An owner's view of a proposal hides the proposer.
    expect(canCopyItem({ status: 'proposed', proposedBy: undefined }, me)).toBe(false);
    expect(canCopyItem({ status: 'proposed', proposedBy: null }, me)).toBe(false);
  });

  it('allows nothing to a signed-out viewer', () => {
    expect(canCopyItem({ status: 'available' }, null)).toBe(false);
    expect(canCopyItem({ status: 'available' }, undefined)).toBe(false);
    expect(canCopyItem({ status: 'proposed', proposedBy: '' }, '')).toBe(false);
  });
});
