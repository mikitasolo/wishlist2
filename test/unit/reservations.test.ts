import { describe, it, expect } from 'vitest';
import {
  needsConfirmation,
  reservationNote,
  partitionReservations,
  groupByOccasion,
  NO_DATE_GROUP,
  changedCardPrimary,
  totalInCurrency,
} from '@/lib/utils/reservations';
import type { Occasion } from '@/lib/utils/occasion';

const active = { itemStatus: 'booked', stillReserved: true, listOpen: true, listArchived: false };
const completed = {
  itemStatus: 'completed',
  stillReserved: false,
  listOpen: true,
  listArchived: false,
};
const deleted = {
  itemStatus: 'deleted',
  stillReserved: false,
  listOpen: true,
  listArchived: false,
};
const draft = { itemStatus: 'draft', stillReserved: false, listOpen: true, listArchived: false };
// Detached but the item still exists as "available" (owner reopened / someone else took it).
const detachedAvailable = {
  itemStatus: 'available',
  stillReserved: false,
  listOpen: true,
  listArchived: false,
};
// On a list they can no longer open (left, and made private since, say): frozen
// like an archived one's (WIS-295), so the read says nothing live of the item.
const listClosed = {
  itemStatus: null,
  stillReserved: null,
  listOpen: false,
  listArchived: false,
};
// On an archived list: frozen, so the read says nothing live of the item.
const archived = { itemStatus: null, stillReserved: null, listOpen: false, listArchived: true };

describe('needsConfirmation', () => {
  it('is false only while still reserved by the gifter, on a list they can open', () => {
    expect(needsConfirmation(active)).toBe(false);
    expect(needsConfirmation(completed)).toBe(true);
    expect(needsConfirmation(deleted)).toBe(true);
    expect(needsConfirmation(draft)).toBe(true);
    expect(needsConfirmation(detachedAvailable)).toBe(true);
    // Release can't reach a list they can't open, so it needs their confirmation.
    expect(needsConfirmation(listClosed)).toBe(true);
    // Nor can it reach an archived one, whatever the item's state.
    expect(needsConfirmation(archived)).toBe(true);
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

  // regression: a booking still theirs, on a list they could no longer open,
  // said "No longer reserved to you", which isn't so. It says only that the
  // list isn't available to them, never why (an archived list says so on its
  // own: see below).
  it('regression: says a still-reserved gift is on a list no longer available to them', () => {
    expect(reservationNote(listClosed)).toBe('This list is no longer available to you');
    expect(reservationNote(listClosed)).not.toMatch(/archiv|reserved/i);
  });

  // regression (WIS-295): on a list they'd lost access to, the note went on
  // saying what its owners did to the item since (received, drafted, removed,
  // someone else's now). Such a reservation is frozen: the note says only that
  // the list isn't available to them, whatever the item's state.
  it('regression: says nothing of the item on a list they can no longer open', () => {
    for (const item of [active, deleted, completed, draft, detachedAvailable]) {
      expect(reservationNote({ ...item, listOpen: false })).toBe(
        'This list is no longer available to you'
      );
    }
  });

  // regression (WIS-124): a reservation on an archived list kept hinting at what
  // its owners did to the item since (received, drafted, removed), though the
  // list is theirs alone. It's frozen: the note says only that the list was
  // archived, whatever the item's state.
  it('regression: says only that the list was archived, never anything of the item', () => {
    expect(reservationNote(archived)).toBe('This list was archived');
    // Even were a status to come with it, it isn't shown.
    for (const item of [deleted, completed, draft, detachedAvailable, listClosed]) {
      expect(reservationNote({ ...item, listOpen: false, listArchived: true })).toBe(
        'This list was archived'
      );
    }
  });
});

describe('partitionReservations', () => {
  it('splits into needsConfirm and active, preserving order', () => {
    const list = [active, completed, active, listClosed, archived, deleted];
    const { needsConfirm, active: stillActive } = partitionReservations(list);
    expect(needsConfirm).toEqual([completed, listClosed, archived, deleted]);
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

describe('changedCardPrimary (WIS-263)', () => {
  const changed = { stillReserved: false, listOpen: true, listArchived: false };
  it.each([
    ['completed', 'gave'],
    ['deleted', 'dismiss'],
    ['draft', 'dismiss'],
    ['booked', 'dismiss'],
    ['available', 'dismiss'],
  ] as const)('an item now %s → %s', (itemStatus, expected) => {
    expect(changedCardPrimary({ ...changed, itemStatus })).toBe(expected);
  });

  // Leaving or being removed frees the booking, so a gift on a list they've
  // lost (and that says nothing of its item: WIS-295) most likely didn't go
  // ahead; an archived one most likely still did.
  it('frozen on a list they can’t open → dismiss, or gave when it was archived', () => {
    expect(
      changedCardPrimary({
        itemStatus: null,
        stillReserved: null,
        listOpen: false,
        listArchived: false,
      })
    ).toBe('dismiss');
    // Even were a live status to come with it, it isn't read.
    expect(
      changedCardPrimary({
        itemStatus: 'completed',
        stillReserved: true,
        listOpen: false,
        listArchived: false,
      })
    ).toBe('dismiss');
    expect(
      changedCardPrimary({
        itemStatus: null,
        stillReserved: null,
        listOpen: false,
        listArchived: true,
      })
    ).toBe('gave');
  });
});

describe('totalInCurrency (D9)', () => {
  const rates = { eur: 0.9, gbp: 0.8 };

  it('sums prices already in the currency exactly, whatever their case', () => {
    expect(
      totalInCurrency(
        [{ value: 1000, currency: 'eur' }, null, { value: 250, currency: 'EUR' }],
        'EUR',
        null
      )
    ).toEqual({ price: { value: 1250, currency: 'EUR' }, approx: false });
  });

  it('converts the others, and says the total is approximate', () => {
    expect(
      totalInCurrency(
        [
          { value: 5000, currency: 'eur' },
          { value: 8000, currency: 'gbp' },
        ],
        'EUR',
        rates
      )
    ).toEqual({ price: { value: 14000, currency: 'EUR' }, approx: true });
  });

  it('gives no total when nothing is priced, or when a price can’t be converted', () => {
    expect(totalInCurrency([null], 'EUR', rates)).toBeNull();
    expect(totalInCurrency([], 'EUR', rates)).toBeNull();
    expect(totalInCurrency([{ value: 100, currency: 'gbp' }], 'EUR', null)).toBeNull();
    expect(totalInCurrency([{ value: 100, currency: 'xyz' }], 'EUR', rates)).toBeNull();
  });
});
