import { describe, it, expect } from 'vitest';
import {
  needsConfirmation,
  reservationNote,
  partitionReservations,
} from '@/lib/utils/reservations';

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
