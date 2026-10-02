import { describe, it, expect } from 'vitest';
import {
  needsConfirmation,
  reservationNote,
  partitionReservations,
  groupByOccasion,
  NO_DATE_GROUP,
} from '@/lib/utils/reservations';
import type { Occasion } from '@/lib/utils/occasion';

const active = { itemStatus: 'booked', stillReserved: true };
const completed = { itemStatus: 'completed', stillReserved: false };
const deleted = { itemStatus: 'deleted', stillReserved: false };
const draft = { itemStatus: 'draft', stillReserved: false };
// Detached but the item still exists as "available" (owner reopened / someone else took it).
const detachedAvailable = { itemStatus: 'available', stillReserved: false };

describe('needsConfirmation', () => {
  it('is false only while still reserved by the gifter', () => {
    expect(needsConfirmation(active)).toBe(false);
    expect(needsConfirmation(completed)).toBe(true);
    expect(needsConfirmation(deleted)).toBe(true);
    expect(needsConfirmation(draft)).toBe(true);
    expect(needsConfirmation(detachedAvailable)).toBe(true);
  });
});

describe('reservationNote', () => {
  it('returns null for an active reservation', () => {
    expect(reservationNote(active)).toBeNull();
  });

  // regression: the durable Reservation survives owner status changes and
  // leave/kick, so each detach reason must produce a clear gifter-facing note.
  it('explains each detach reason', () => {
    expect(reservationNote(deleted)).toMatch(/removed/i);
    expect(reservationNote(completed)).toMatch(/received/i);
    expect(reservationNote(draft)).toMatch(/draft/i);
    expect(reservationNote(detachedAvailable)).toMatch(/no longer reserved/i);
  });
});

describe('partitionReservations', () => {
  it('splits into needsConfirm and active, preserving order', () => {
    const list = [active, completed, active, deleted];
    const { needsConfirm, active: stillActive } = partitionReservations(list);
    expect(needsConfirm).toEqual([completed, deleted]);
    expect(stillActive).toEqual([active, active]);
  });

  it('handles an empty list', () => {
    expect(partitionReservations([])).toEqual({ needsConfirm: [], active: [] });
  });
});

describe('groupByOccasion', () => {
  const TODAY = '2026-10-02';
  // In 12 days (yearly, stored on the placeholder year), in 3 days, today, passed.
  const birthday: Occasion = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' };
  const wedding: Occasion = { kind: 'wedding', date: '2026-10-05', recurrence: null };
  const party: Occasion = { kind: 'other', date: '2026-10-02', recurrence: null };
  const past: Occasion = { kind: 'wedding', date: '2026-01-01', recurrence: null };

  const card = (id: string, wishlistId: string, occasion?: Occasion | null, name = wishlistId) => ({
    _id: id,
    wishlistId,
    wishlistName: name,
    wishlistOccasion: occasion,
  });
  /** Each group, as its list's id (or the "No date" key) and its reservations' ids. */
  const shape = (groups: ReturnType<typeof groupByOccasion<ReturnType<typeof card>>>) =>
    groups.map((g) => [
      g.occasion ? g.reservations[0].wishlistId : g.key,
      g.reservations.map((r) => r._id),
    ]);

  it('puts the nearest occasion first, one group per list, and "No date" last', () => {
    const list = [
      card('a', 'wA', birthday),
      card('none', 'wN', null),
      card('b', 'wB', wedding),
      card('a2', 'wA', birthday),
      card('p', 'wP', party),
    ];
    const groups = groupByOccasion(list, TODAY);
    expect(shape(groups)).toEqual([
      ['wP', ['p']],
      ['wB', ['b']],
      ['wA', ['a', 'a2']],
      [NO_DATE_GROUP, ['none']],
    ]);
    expect(groups[2]).toMatchObject({ occasion: birthday, wishlistName: 'wA' });
    expect(groups[3]).toMatchObject({ occasion: null, wishlistName: null });
  });

  it('sends a list with no occasion, a passed one-off, or a hidden one (missing) to "No date", in their order', () => {
    const list = [card('x', 'wX', past), card('y', 'wY', null), card('z', 'wZ')];
    expect(shape(groupByOccasion(list, TODAY))).toEqual([[NO_DATE_GROUP, ['x', 'y', 'z']]]);
  });

  it('orders lists on the same day by name, then by id', () => {
    const list = [
      card('1', 'w3', wedding, 'Zoe'),
      card('2', 'w2', wedding, 'Anna'),
      card('3', 'w1', wedding, 'Anna'),
    ];
    expect(shape(groupByOccasion(list, TODAY))).toEqual([
      ['w1', ['3']],
      ['w2', ['2']],
      ['w3', ['1']],
    ]);
  });

  it('counts a yearly occasion from its next occurrence, rolling into next year', () => {
    // On Oct 15 the birthday was yesterday: it's next on Oct 14, 2027, after the
    // one-off on Nov 1.
    const soon: Occasion = { kind: 'holiday', date: '2026-11-01', recurrence: null };
    const list = [card('a', 'wA', birthday), card('h', 'wH', soon)];
    expect(shape(groupByOccasion(list, '2026-10-15'))).toEqual([
      ['wH', ['h']],
      ['wA', ['a']],
    ]);
  });

  // A card whose action is in flight keeps the page's copy when a read lands,
  // so its list's other cards can carry a newer occasion than it does.
  it('groups a list by its occasion too, so a card with an older copy stays under its own date', () => {
    const list = [
      card('held', 'wA', birthday),
      card('fresh', 'wA', wedding),
      card('cleared', 'wA', null),
      card('fresh2', 'wA', wedding),
    ];
    const groups = groupByOccasion(list, TODAY);
    expect(shape(groups)).toEqual([
      ['wA', ['fresh', 'fresh2']],
      ['wA', ['held']],
      [NO_DATE_GROUP, ['cleared']],
    ]);
    expect(groups.map((g) => g.occasion)).toEqual([wedding, birthday, null]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
    // The same keys from one read to the next.
    expect(groupByOccasion(list, TODAY).map((g) => g.key)).toEqual(groups.map((g) => g.key));
  });

  it('keeps everything in one "No date" group, in order, until today is known', () => {
    const list = [card('a', 'wA', birthday), card('b', 'wB', wedding), card('n', 'wN', null)];
    expect(shape(groupByOccasion(list, null))).toEqual([[NO_DATE_GROUP, ['a', 'b', 'n']]]);
  });

  it('returns no groups for no reservations', () => {
    expect(groupByOccasion([], TODAY)).toEqual([]);
  });
});
