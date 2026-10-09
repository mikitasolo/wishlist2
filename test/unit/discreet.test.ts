import { describe, it, expect } from 'vitest';
import { parseDiscreet, withoutReservation } from '@/lib/utils/discreet';
import type { ApiItem } from '@/types/api';

const item = (fields: Partial<ApiItem>) =>
  ({ _id: 'i1', wishlist: 'w1', name: 'Lamp', status: 'available', ...fields }) as ApiItem;

describe('parseDiscreet', () => {
  it('is on only for the stored "1"', () => {
    expect(parseDiscreet('1')).toBe(true);
    for (const v of [null, undefined, '', '0', 'true']) expect(parseDiscreet(v)).toBe(false);
  });
});

describe('withoutReservation', () => {
  it('draws a reserved item as plain available, with no reserver or given mark', () => {
    for (const bookedBy of ['me', 'someone-else', undefined]) {
      const shown = withoutReservation(item({ status: 'booked', bookedBy, givenByMe: true }));
      expect(shown.status).toBe('available');
      expect(shown.bookedBy).toBeNull();
      expect(shown.givenByMe).toBeUndefined();
    }
  });

  it('hides a group gift like any reservation (WIS-361)', () => {
    const shown = withoutReservation(
      item({
        status: 'booked',
        groupGift: { contributing: false, percentFunded: 40, target: { currency: 'EUR' } },
      })
    );
    expect(shown.status).toBe('available');
    expect(shown.groupGift).toBeUndefined();
  });

  it('keeps the rest of the item, and never mutates it', () => {
    const original = item({ status: 'booked', bookedBy: 'me', name: 'Kettle' });
    expect(withoutReservation(original).name).toBe('Kettle');
    expect(original.status).toBe('booked');
  });

  it('returns any other item as it is', () => {
    for (const status of ['available', 'draft', 'proposed', 'completed'] as const) {
      const i = item({ status });
      expect(withoutReservation(i)).toBe(i);
    }
  });
});
