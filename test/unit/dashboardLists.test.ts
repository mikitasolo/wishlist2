import { describe, it, expect } from 'vitest';
import { comingUp, COMING_UP_DAYS } from '@/lib/utils/comingUp';
import { pinnedFirst, withPin } from '@/lib/utils/pinnedLists';
import type { Occasion } from '@/lib/utils/occasion';

// The dashboard's list helpers (WIS-252): Coming up, and Pin to top.

const TODAY = '2026-10-02';
const yearly = (date: string): Occasion => ({ kind: 'birthday', date, recurrence: 'yearly' });
const once = (date: string): Occasion => ({ kind: 'other', date, recurrence: null });
const list = (name: string, occasion: Occasion | null, fields: Record<string, unknown> = {}) => ({
  name,
  occasion,
  ...fields,
});

describe('comingUp', () => {
  it('keeps the next 30 days, today included, nearest first, then by name', () => {
    const own = [
      list('Zoo trip', once('2026-10-03')),
      list('Later', yearly('2000-11-02')), // 31 days
      list('Edge', once('2026-11-01')), // 30 days
      list('None', null),
    ];
    const shared = [list('Apple', once('2026-10-03')), list('Today', yearly('2000-10-02'))];
    const entries = comingUp(own, shared, TODAY);
    expect(entries.map((e) => [e.list.name, e.days, e.own])).toEqual([
      ['Today', 0, false],
      ['Apple', 1, false],
      ['Zoo trip', 1, true],
      ['Edge', COMING_UP_DAYS, true],
    ]);
  });

  it('gives a yearly occasion its next real day, never the placeholder year', () => {
    const [entry] = comingUp([list('Birthday', yearly('2000-10-16'))], [], TODAY);
    expect(entry.date).toBe('2026-10-16');
    // Rolling over the new year.
    const [january] = comingUp([list('New year', yearly('2000-01-01'))], [], '2026-12-20');
    expect(january).toMatchObject({ date: '2027-01-01', days: 12 });
  });

  it('leaves out a one-off that has passed, and archived lists', () => {
    expect(
      comingUp(
        [
          list('Past', once('2026-10-01')),
          list('Archived', once('2026-10-04'), { archived: true }),
        ],
        [list('Shared archived', yearly('2000-10-04'), { archived: true })],
        TODAY
      )
    ).toEqual([]);
  });
});

describe('Pin to top', () => {
  const lists = () => [
    { _id: 'a', featured: false },
    { _id: 'b', featured: true },
    { _id: 'c', featured: false },
  ];

  it('pinnedFirst puts the pinned list first and keeps the rest in order', () => {
    expect(pinnedFirst(lists()).map((w) => w._id)).toEqual(['b', 'a', 'c']);
    expect(pinnedFirst([{ _id: 'x' }, { _id: 'y' }]).map((w) => w._id)).toEqual(['x', 'y']);
  });

  it('withPin pins one and unpins the others, as the server does', () => {
    expect(withPin(lists(), 'c', true).map((w) => w.featured)).toEqual([false, false, true]);
  });

  it('withPin unpins only the one, and leaves the others as they were', () => {
    const before = lists();
    const after = withPin(before, 'b', false);
    expect(after.map((w) => w.featured)).toEqual([false, false, false]);
    // Untouched lists are the same objects.
    expect(after[0]).toBe(before[0]);
  });
});
