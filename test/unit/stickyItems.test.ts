import { describe, it, expect } from 'vitest';
import { addPin, keepPinnedInPlace } from '@/lib/utils/stickyItems';

type Item = { _id: string; status: string };
const it_ = (id: string, status = 'available'): Item => ({ _id: id, status });
const ids = (items: Item[]) => items.map((i) => i._id);

describe('keepPinnedInPlace', () => {
  it('returns the fresh order untouched when nothing is pinned', () => {
    const fresh = [it_('a'), it_('b')];
    expect(ids(keepPinnedInPlace(fresh, fresh, [], ['a', 'b']))).toEqual(['a', 'b']);
  });

  it('keeps a pinned item the chip no longer matches, in its slot', () => {
    const all = [it_('a'), it_('b', 'booked'), it_('c')];
    // b was reserved on Available: the chip would drop it.
    const fresh = [all[0], all[2]];
    expect(ids(keepPinnedInPlace(fresh, all, ['b'], ['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
  });

  it('keeps a pinned item in its slot when the order would move it (All)', () => {
    const all = [it_('a'), it_('b', 'booked'), it_('c')];
    // Under All, b would now go after c, into the reserved group.
    const fresh = [all[0], all[2], all[1]];
    expect(ids(keepPinnedInPlace(fresh, all, ['b'], ['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
  });

  it('puts a pinned first card first', () => {
    const all = [it_('a', 'booked'), it_('b'), it_('c')];
    const fresh = [all[1], all[2]];
    expect(ids(keepPinnedInPlace(fresh, all, ['a'], ['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
  });

  it('keeps several pinned items in their slots and their order', () => {
    const all = [it_('a'), it_('b', 'booked'), it_('c', 'booked'), it_('d')];
    const fresh = [all[0], all[3]];
    expect(ids(keepPinnedInPlace(fresh, all, ['c', 'b'], ['a', 'b', 'c', 'd']))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('places a pinned item after the nearest card before it that is still shown', () => {
    const all = [it_('a'), it_('b'), it_('c', 'booked'), it_('d')];
    // b has since left the chip (someone else reserved it): c follows a.
    const fresh = [all[0], all[3]];
    expect(ids(keepPinnedInPlace(fresh, all, ['c'], ['a', 'b', 'c', 'd']))).toEqual([
      'a',
      'c',
      'd',
    ]);
  });

  it('shows the pinned item as last read, so a poll lands on the card in place', () => {
    const polled = { _id: 'b', status: 'available', name: 'Renamed' };
    const all = [it_('a'), polled];
    const out = keepPinnedInPlace([all[0]], all, ['b'], ['a', 'b']);
    expect(out[1]).toBe(polled);
  });

  it('leaves out a pinned item that is gone (deleted or declined), never pinning it', () => {
    const all = [it_('a'), it_('c')];
    expect(ids(keepPinnedInPlace(all, all, ['b'], ['a', 'b', 'c']))).toEqual(['a', 'c']);
  });

  it('places a pinned item that was never on screen as the fresh order does', () => {
    const all = [it_('a'), it_('x', 'booked')];
    expect(ids(keepPinnedInPlace([all[0]], all, ['x'], ['a']))).toEqual(['a']);
    expect(ids(keepPinnedInPlace([all[1], all[0]], all, ['x'], ['a']))).toEqual(['x', 'a']);
  });

  it('lets new and other items move by the fresh order around the pinned one', () => {
    const all = [it_('n'), it_('a'), it_('b', 'booked'), it_('c')];
    const fresh = [all[0], all[3], all[1]];
    expect(ids(keepPinnedInPlace(fresh, all, ['b'], ['a', 'b', 'c']))).toEqual([
      'n',
      'c',
      'a',
      'b',
    ]);
  });
});

describe('addPin', () => {
  it('adds the id once and takes the order on screen as the anchor', () => {
    expect(addPin(['b'], 'c', ['a', 'b', 'c'])).toEqual({
      pinned: ['b', 'c'],
      anchor: ['a', 'b', 'c'],
    });
    expect(addPin(['b'], 'b', ['b', 'a'])).toEqual({ pinned: ['b'], anchor: ['b', 'a'] });
  });
});
