import { describe, it, expect } from 'vitest';
import { GROUP_LIMIT, groupLimitNote, groupNameKey } from '@/lib/utils/groupRules';
import { groupNameSchema } from '@/lib/validations';

// WIS-27: what makes two group names the same, and when New group is held.

describe('groupNameKey', () => {
  it('folds case, spacing and compatibility forms', () => {
    expect(groupNameKey('Family')).toBe(groupNameKey(' family '));
    expect(groupNameKey('Close  friends')).toBe(groupNameKey('close friends'));
    expect(groupNameKey('Ｆａｍｉｌｙ')).toBe(groupNameKey('family'));
    expect(groupNameKey('Family')).not.toBe(groupNameKey('Families'));
  });
});

describe('groupLimitNote', () => {
  it('says nothing until the limit, then why New group is held', () => {
    expect(groupLimitNote(GROUP_LIMIT - 1)).toBeNull();
    expect(groupLimitNote(GROUP_LIMIT)).toBe('You have 20 groups, the most you can have.');
  });
});

describe('groupNameSchema', () => {
  it('takes a trimmed visible line of up to 40 characters', () => {
    expect(groupNameSchema.parse({ name: '  Family ' })).toEqual({ name: 'Family' });
    expect(groupNameSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(groupNameSchema.safeParse({ name: 'x'.repeat(41) }).success).toBe(false);
    expect(groupNameSchema.safeParse({ name: 'Fam\nily' }).success).toBe(false);
  });
});
