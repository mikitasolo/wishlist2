import { describe, it, expect } from 'vitest';
import { GROUP_LIMIT, groupLimitNote, groupNameKey, personMatches } from '@/lib/utils/groupRules';
import { groupNameSchema } from '@/lib/validations';

// WIS-425: the filter over a group's people and the Add people picker.
describe('personMatches', () => {
  const p = { username: 'bo_k', displayName: 'Bohdan K' };
  it('matches username or display name, ignoring case and a leading @', () => {
    expect(personMatches(p, '')).toBe(true);
    expect(personMatches(p, '@BO_')).toBe(true);
    expect(personMatches(p, ' bohdan ')).toBe(true);
    expect(personMatches(p, 'zed')).toBe(false);
  });
  it('copes with no display name', () => {
    expect(personMatches({ username: 'cy' }, 'cy')).toBe(true);
    expect(personMatches({ username: 'cy', displayName: null }, 'x')).toBe(false);
  });
});

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
