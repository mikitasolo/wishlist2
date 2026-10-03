import { describe, it, expect } from 'vitest';
import { plural, pluralNoun } from '@/lib/utils/plural';

describe('plural', () => {
  // regression: the dashboard's Featured card read "Public · 1 items", and
  // profiles and the follow dialog "1 followers": each wrote its count with a
  // hard-coded plural noun.
  it('regression: uses the singular for exactly one', () => {
    expect(plural(1, 'item')).toBe('1 item');
    expect(plural(1, 'follower')).toBe('1 follower');
  });

  it('uses the plural for zero and for more than one', () => {
    expect(plural(0, 'item')).toBe('0 items');
    expect(plural(2, 'list')).toBe('2 lists');
    expect(plural(12, 'gift')).toBe('12 gifts');
    expect(plural(1000, 'member')).toBe('1000 members');
  });

  it('uses the plural for a fraction or a negative number', () => {
    expect(plural(1.5, 'item')).toBe('1.5 items');
    expect(plural(-1, 'item')).toBe('-1 items');
  });

  it('spells regular plurals by their ending', () => {
    expect(plural(2, 'entry')).toBe('2 entries');
    expect(plural(2, 'day')).toBe('2 days'); // a vowel before the y
    expect(plural(2, 'box')).toBe('2 boxes');
    expect(plural(2, 'wish')).toBe('2 wishes');
    expect(plural(2, 'match')).toBe('2 matches');
    expect(plural(2, 'class')).toBe('2 classes');
  });

  it('knows the irregulars it is used with', () => {
    expect(plural(1, 'person')).toBe('1 person');
    expect(plural(3, 'person')).toBe('3 people');
    expect(plural(1, 'following')).toBe('1 following');
    expect(plural(3, 'following')).toBe('3 following');
  });

  it('takes a plural from the caller over its own', () => {
    expect(plural(1, 'mouse', 'mice')).toBe('1 mouse');
    expect(plural(2, 'mouse', 'mice')).toBe('2 mice');
  });
});

describe('pluralNoun', () => {
  it('is the noun alone, for a count set apart from it', () => {
    expect(pluralNoun(1, 'follower')).toBe('follower');
    expect(pluralNoun(0, 'follower')).toBe('followers');
    expect(pluralNoun(5, 'following')).toBe('following');
    expect(pluralNoun(2, 'mouse', 'mice')).toBe('mice');
  });
});
