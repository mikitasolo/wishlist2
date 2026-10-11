import { describe, it, expect } from 'vitest';
import {
  countListTags,
  fitTagsToList,
  LIST_TAGS_MAX,
  listTags,
  matchesTags,
  normalizeTagName,
  sameTags,
  tagKey,
  uniqueTags,
} from '@/lib/utils/itemTags';
import { createItemSchema, updateItemSchema } from '@/lib/validations';
import { itemChanges, itemToFormData } from '@/lib/utils/itemForm';
import { visibleListTags } from '@/lib/utils/listChips';
import { copiedItemFields } from '@/lib/utils/wishlistCopy';

const many = (n: number, prefix = 'T') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

describe('tag names', () => {
  it('tidies spaces and ignores case for sameness', () => {
    expect(normalizeTagName('  Gift   ideas ')).toBe('Gift ideas');
    expect(tagKey(' BOOKS ')).toBe('books');
  });

  it('keeps each tag once, as first written, in order', () => {
    expect(uniqueTags(['Books', ' books', '', 'Kitchen', 'KITCHEN '])).toEqual([
      'Books',
      'Kitchen',
    ]);
  });

  it('compares sets whatever their order or case', () => {
    expect(sameTags(['A', 'b'], ['B', 'a'])).toBe(true);
    expect(sameTags(['A'], ['A', 'B'])).toBe(false);
  });

  it('lists a list’s tags once each, alphabetically', () => {
    expect(listTags([{ tags: ['kitchen', 'Books'] }, { tags: ['books'] }, {}])).toEqual([
      'Books',
      'kitchen',
    ]);
  });

  it('matches any picked tag, and everything with none picked', () => {
    expect(matchesTags({ tags: ['Books'] }, ['kitchen', 'BOOKS'])).toBe(true);
    expect(matchesTags({ tags: ['Books'] }, ['Kitchen'])).toBe(false);
    expect(matchesTags({}, ['Kitchen'])).toBe(false);
    expect(matchesTags({}, [])).toBe(true);
  });

  it('counts different tags by key', () => {
    expect(countListTags(['A', 'a', 'B'])).toBe(2);
  });
});

describe('fitTagsToList', () => {
  it('takes the list’s spelling of a tag it has', () => {
    expect(fitTagsToList(['Books'], ['books', 'New'])).toEqual({
      ok: true,
      tags: ['Books', 'New'],
      addsNew: true,
    });
  });

  it('refuses a new tag past the cap, and takes known ones at it', () => {
    const full = many(LIST_TAGS_MAX);
    expect(fitTagsToList(full, ['Extra'])).toEqual({ ok: false });
    expect(fitTagsToList(full, ['t1', 'T2'])).toEqual({
      ok: true,
      tags: ['T1', 'T2'],
      addsNew: false,
    });
    expect(fitTagsToList(many(LIST_TAGS_MAX - 1), ['Last'])).toMatchObject({ ok: true });
  });

  it('counts an item’s own tags as the list’s, and frees the place of one it drops', () => {
    const others = many(LIST_TAGS_MAX - 1);
    // Keeping its own unique tag is never new.
    expect(fitTagsToList(many(LIST_TAGS_MAX), ['Own'], ['Own'])).toEqual({
      ok: true,
      tags: ['Own'],
      addsNew: false,
    });
    // Swapping it for another stays within the cap.
    expect(fitTagsToList(others, ['New'], ['Old'])).toMatchObject({ ok: true, addsNew: true });
    expect(fitTagsToList(others, ['Old', 'New'], ['Old'])).toEqual({ ok: false });
  });

  it('lets a list somehow past the cap keep using what it has', () => {
    expect(fitTagsToList(many(LIST_TAGS_MAX + 2), ['T21'])).toMatchObject({ ok: true });
  });
});

describe('item tag schemas', () => {
  it('tidies, de-duplicates and caps an item’s tags', () => {
    const parsed = createItemSchema.parse({ name: 'A', tags: [' Books ', 'books', 'Kitchen'] });
    expect(parsed.tags).toEqual(['Books', 'Kitchen']);
    // Six written, five once repeats go: fine.
    expect(
      createItemSchema.safeParse({ name: 'A', tags: ['a', 'b', 'c', 'd', 'e', 'E'] }).success
    ).toBe(true);
    expect(createItemSchema.safeParse({ name: 'A', tags: many(6) }).success).toBe(false);
  });

  it('refuses an empty, overlong or control-character tag', () => {
    for (const tag of ['   ', 'x'.repeat(25), 'a\u0000b', 'a‮b']) {
      expect(createItemSchema.safeParse({ name: 'A', tags: [tag] }).success).toBe(false);
    }
    expect(createItemSchema.safeParse({ name: 'A', tags: ['x'.repeat(24)] }).success).toBe(true);
  });

  it('takes tags alone as an edit, and [] to clear them', () => {
    expect(updateItemSchema.safeParse({ tags: [] }).success).toBe(true);
    expect(updateItemSchema.parse({ tags: ['A'] }).tags).toEqual(['A']);
  });
});

describe('the item form’s tag changes', () => {
  const filled = itemToFormData(
    {
      name: 'Mug',
      imageUrl: null,
      price: null,
      link: null,
      notes: null,
      status: 'available',
      tags: ['Kitchen'],
    },
    'USD'
  );

  it('sends the whole set only when it’s another set', () => {
    expect(itemChanges({ ...filled, tags: ['kitchen'] }, filled)).toEqual({});
    expect(itemChanges({ ...filled, tags: ['Kitchen', 'Mugs'] }, filled)).toEqual({
      tags: ['Kitchen', 'Mugs'],
    });
    expect(itemChanges({ ...filled, tags: [] }, filled)).toEqual({ tags: [] });
  });
});

describe('visibleListTags', () => {
  const items = [
    { status: 'draft' as const, tags: ['Draft'] },
    { status: 'proposed' as const, proposedBy: 'someone', tags: ['Theirs'] },
    { status: 'booked' as const, bookedBy: 'x', tags: ['Booked'] },
    { status: 'available' as const, tags: ['Open'] },
  ];

  it('gives a member only the tags on what they may see', () => {
    expect(visibleListTags(items, 'member', 'me')).toEqual(['Booked', 'Open']);
  });

  it('gives an owner every item’s tags', () => {
    expect(visibleListTags(items, 'owner', 'o')).toEqual(['Booked', 'Draft', 'Open', 'Theirs']);
  });
});

describe('copiedItemFields', () => {
  const source = { name: 'Mug', status: 'available', tags: ['Kitchen'] };

  it('carries tags to a new list only', () => {
    expect(copiedItemFields(source, { withTags: true }).tags).toEqual(['Kitchen']);
    expect(copiedItemFields(source, { withTags: false })).not.toHaveProperty('tags');
  });
});
