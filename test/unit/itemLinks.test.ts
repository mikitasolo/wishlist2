import { describe, it, expect } from 'vitest';
import {
  ITEM_LINKS_MAX,
  applyLinkChanges,
  isLinkableStatus,
  linkChanges,
  linkedItemRefs,
  remapLinks,
  syncPartnerChips,
  visiblePartnerStatuses,
} from '@/lib/utils/itemLinks';

// The pure rules of linked items (WIS-29).

type Src = { _id: string; name: string; status: string; relatedItems?: string[] };
const item = (id: string, relatedItems: string[] = [], status = 'available'): Src => ({
  _id: id,
  name: id.toUpperCase(),
  status,
  relatedItems,
});

describe('linkChanges', () => {
  it('sends only what was added and removed', () => {
    expect(linkChanges(['a', 'b'], ['b', 'c'])).toEqual({ linkItems: ['c'], unlinkItems: ['a'] });
    expect(linkChanges([], ['a'])).toEqual({ linkItems: ['a'] });
    expect(linkChanges(['a'], [])).toEqual({ unlinkItems: ['a'] });
  });

  it('is empty when nothing changed, whatever the order', () => {
    expect(linkChanges(['a', 'b'], ['b', 'a'])).toEqual({});
  });
});

describe('applyLinkChanges', () => {
  it('drops the removed, appends the added it can name, and never repeats one', () => {
    const names = new Map([
      ['c', 'Case'],
      ['b', 'Bits'],
    ]);
    expect(
      applyLinkChanges(
        [
          { id: 'a', name: 'Drill' },
          { id: 'b', name: 'Bits' },
        ],
        { unlinkItems: ['a'], linkItems: ['b', 'c', 'unknown'] },
        names
      )
    ).toEqual([
      { id: 'b', name: 'Bits' },
      { id: 'c', name: 'Case' },
    ]);
  });
});

describe('statuses', () => {
  it('never links a proposal', () => {
    expect(isLinkableStatus('proposed')).toBe(false);
    for (const s of ['draft', 'available', 'booked', 'completed']) {
      expect(isLinkableStatus(s)).toBe(true);
    }
  });

  it('shows a draft partner to owners only', () => {
    expect(visiblePartnerStatuses(true)).toContain('draft');
    expect(visiblePartnerStatuses(false)).not.toContain('draft');
    expect(visiblePartnerStatuses(false)).not.toContain('proposed');
    expect(visiblePartnerStatuses(true)).not.toContain('proposed');
  });
});

describe('linkedItemRefs', () => {
  it('shows a link only where both sides record it, as { id, name }', () => {
    const refs = linkedItemRefs([item('a', ['b', 'c']), item('b', ['a']), item('c', [])]);
    expect(refs.get('a')).toEqual([{ id: 'b', name: 'B' }]);
    expect(refs.get('b')).toEqual([{ id: 'a', name: 'A' }]);
    expect(refs.get('c')).toEqual([]);
  });

  it('ignores partners the viewer wasn’t given, proposals, itself, and repeats', () => {
    const refs = linkedItemRefs([
      item('a', ['gone', 'p', 'a', 'b', 'b']),
      item('b', ['a']),
      item('p', ['a'], 'proposed'),
    ]);
    expect(refs.get('a')).toEqual([{ id: 'b', name: 'B' }]);
    expect(refs.get('p')).toEqual([]);
  });

  it('never gives more than the cap', () => {
    const ids = Array.from({ length: ITEM_LINKS_MAX + 2 }, (_, i) => `x${i}`);
    const refs = linkedItemRefs([item('a', ids), ...ids.map((id) => item(id, ['a']))]);
    expect(refs.get('a')).toHaveLength(ITEM_LINKS_MAX);
  });
});

describe('remapLinks', () => {
  it('keeps links between copied items, on the copies, and drops the rest', () => {
    const items = [item('a', ['b', 'c']), item('b', ['a']), item('d', ['a'])];
    const copies = new Map([
      ['a', 'A2'],
      ['b', 'B2'],
      ['d', 'D2'],
    ]);
    const out = remapLinks(items, copies);
    expect(out.get('a')).toEqual(['B2']); // c wasn't copied
    expect(out.get('b')).toEqual(['A2']);
    expect(out.get('d')).toEqual([]); // a doesn't record d
  });
});

describe('syncPartnerChips', () => {
  it('adds, renames and removes other items’ chips for the edited item, leaving the rest as they are', () => {
    const untouched = { _id: 'd', relatedItems: [] };
    const items = [
      { _id: 'a', relatedItems: [{ id: 'b', name: 'Bits' }] },
      { _id: 'b', relatedItems: [{ id: 'a', name: 'Old name' }] },
      { _id: 'c', relatedItems: [{ id: 'a', name: 'Old name' }] },
      untouched,
      { _id: 'e' },
    ];
    const out = syncPartnerChips(items, {
      _id: 'a',
      name: 'Drill',
      relatedItems: [
        { id: 'b', name: 'Bits' },
        { id: 'e', name: 'E' },
      ],
    });
    expect(out[0]).toBe(items[0]);
    expect(out[1].relatedItems).toEqual([{ id: 'a', name: 'Drill' }]);
    expect(out[2].relatedItems).toEqual([]);
    expect(out[3]).toBe(untouched);
    expect(out[4].relatedItems).toEqual([{ id: 'a', name: 'Drill' }]);
  });
});
