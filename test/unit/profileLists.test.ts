import { describe, it, expect } from 'vitest';
import { profileCoOwnerLabel, visitorLine } from '@/lib/utils/profileLists';

describe('visitorLine', () => {
  it('says how many of your lists visitors see', () => {
    expect(visitorLine(3, 5)).toBe('Visitors see 3 of your 5 lists');
    expect(visitorLine(1, 2)).toBe('Visitors see 1 of your 2 lists');
  });

  it('says all, none, or your one list in words', () => {
    expect(visitorLine(5, 5)).toBe('Visitors see all 5 of your lists');
    expect(visitorLine(0, 4)).toBe('Visitors see none of your 4 lists');
    expect(visitorLine(1, 1)).toBe('Visitors see your list');
    expect(visitorLine(0, 1)).toBe('Visitors don’t see your list');
  });

  it('says nothing without lists or without a count', () => {
    expect(visitorLine(0, 0)).toBeNull();
    expect(visitorLine(null, 3)).toBeNull();
    expect(visitorLine(undefined, 3)).toBeNull();
  });
});

describe('profileCoOwnerLabel', () => {
  it('is nothing on a list the profile’s person owns alone', () => {
    expect(profileCoOwnerLabel({ owners: ['p'], ownerUsernames: ['pat'] }, 'p')).toBeNull();
  });

  it('names the other owners, never the profile’s person', () => {
    expect(
      profileCoOwnerLabel({ owners: ['p', 'c'], ownerUsernames: ['pat', 'chloe_r'] }, 'p')
    ).toBe('with @chloe_r');
    expect(
      profileCoOwnerLabel({ owners: ['d', 'p', 'c'], ownerUsernames: ['dan', 'pat', 'chloe'] }, 'p')
    ).toBe('with @dan +1');
  });

  it('names an owner with no username as Someone', () => {
    expect(profileCoOwnerLabel({ owners: ['p', 'c'], ownerUsernames: ['pat'] }, 'p')).toBe(
      'with Someone'
    );
  });
});
