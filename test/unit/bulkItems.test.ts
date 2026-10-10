import { describe, it, expect } from 'vitest';
import {
  applyBulkAction,
  bulkActionApplies,
  bulkDoneMessage,
  bulkFailedMessage,
  bulkItemUpdate,
  bulkTargets,
  isSelectableItem,
} from '@/lib/utils/bulkItems';
import { bulkItemActionSchema } from '@/lib/validations';

// WIS-386: which picked items each bulk action changes, and what it says.

const item = (id: string, status: string, mostWanted?: boolean) => ({
  _id: id,
  status,
  mostWanted,
});

describe('bulk item actions: which items each applies to', () => {
  const picked = [
    item('d', 'draft'),
    item('a', 'available', true),
    item('b', 'booked'),
    item('c', 'completed'),
    item('p', 'proposed'),
  ];
  const ids = (action: Parameters<typeof bulkTargets>[0]) =>
    bulkTargets(action, picked).map((i) => i._id);

  it('publishes drafts only', () => expect(ids('publish')).toEqual(['d']));

  it('moves live items to draft and marks them as received, booked or not alike', () => {
    expect(ids('draft')).toEqual(['a', 'b']);
    expect(ids('received')).toEqual(['a', 'b']);
  });

  it('marks as most wanted only those not already, and unmarks only those that are', () => {
    expect(ids('mostWanted')).toEqual(['d', 'b', 'c']);
    expect(ids('notMostWanted')).toEqual(['a']);
  });

  it('deletes anything but a proposal', () => expect(ids('delete')).toEqual(['d', 'a', 'b', 'c']));

  it('never touches a proposal, nor lets one be picked', () => {
    for (const action of ['publish', 'draft', 'received', 'mostWanted', 'delete'] as const) {
      expect(bulkActionApplies(action, item('p', 'proposed'))).toBe(false);
    }
    expect(isSelectableItem({ status: 'proposed' })).toBe(false);
    expect(isSelectableItem({ status: 'draft' })).toBe(true);
  });
});

describe('bulk item actions: the change each stands for', () => {
  it('maps to the single-item change', () => {
    expect(bulkItemUpdate('publish')).toEqual({ status: 'available' });
    expect(bulkItemUpdate('draft')).toEqual({ status: 'draft' });
    expect(bulkItemUpdate('received')).toEqual({ status: 'completed' });
    expect(bulkItemUpdate('mostWanted')).toEqual({ mostWanted: true });
    expect(bulkItemUpdate('notMostWanted')).toEqual({ mostWanted: false });
  });

  it('shows the change on the item, leaving the rest', () => {
    expect(applyBulkAction('received', { _id: 'x', status: 'available', name: 'Mug' })).toEqual({
      _id: 'x',
      status: 'completed',
      name: 'Mug',
    });
  });

  it('says what was done with a count that agrees, and a failure with no reason', () => {
    expect(bulkDoneMessage('publish', 1)).toBe('1 item published');
    expect(bulkDoneMessage('delete', 3)).toBe('3 items deleted');
    expect(bulkDoneMessage('received', 2)).toBe('2 items marked as received');
    expect(bulkFailedMessage(2)).toBe('2 items couldn’t be changed. Try again.');
  });
});

describe('bulkItemActionSchema', () => {
  const id = 'a'.repeat(24);
  it('takes an action and up to 100 ids, deduplicated and lowercased', () => {
    const parsed = bulkItemActionSchema.parse({
      action: 'delete',
      itemIds: [id.toUpperCase(), id],
    });
    expect(parsed).toEqual({ action: 'delete', itemIds: [id] });
  });

  it('refuses no ids, more than 100, a malformed id and an unknown action', () => {
    expect(bulkItemActionSchema.safeParse({ action: 'publish', itemIds: [] }).success).toBe(false);
    expect(
      bulkItemActionSchema.safeParse({ action: 'publish', itemIds: Array(101).fill(id) }).success
    ).toBe(false);
    expect(bulkItemActionSchema.safeParse({ action: 'publish', itemIds: ['x'] }).success).toBe(
      false
    );
    expect(bulkItemActionSchema.safeParse({ action: 'reserve', itemIds: [id] }).success).toBe(
      false
    );
  });
});
