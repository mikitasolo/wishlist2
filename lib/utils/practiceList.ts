import { MOCK_ITEMS } from '@/components/MockList';
import type { ApiItem } from '@/types/api';

/**
 * The guided walkthrough's practice list (WIS-436, `app/tour`): made-up items
 * the tour's steps about reserving, group gifts and (for someone with no list
 * of their own) adding and sharing run on. It lives in the browser only:
 * nothing about it is sent or saved, and nobody real is in it.
 *
 * Two views. A friend's list (`friend`), where the viewer can reserve one item
 * and start a group gift on another, beside one someone else has reserved. And
 * one of the viewer's own (`owner`), which, as every owner's view, never shows
 * a reservation: all its items are plain live ones.
 */
export type PracticeView = 'friend' | 'owner';

/** The made-up someone else who has reserved an item on the friend's list. */
export const PRACTICE_OTHER_ID = 'practice-someone-else';
export const PRACTICE_LIST_ID = 'practice-list';

/** The friend's list items the tour points at. */
export const PRACTICE_RESERVE_ID = 'practice-0';
export const PRACTICE_GROUP_GIFT_ID = 'practice-2';

const STAMP = '2026-01-01T00:00:00.000Z';

function practiceItem(index: number, fields: Partial<ApiItem> = {}): ApiItem {
  const { name, cents } = MOCK_ITEMS[index];
  return {
    _id: `practice-${index}`,
    wishlist: PRACTICE_LIST_ID,
    name,
    price: { value: cents, currency: 'USD' },
    status: 'available',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...fields,
  };
}

/** The list's items as the view starts. */
export function practiceItems(view: PracticeView): ApiItem[] {
  if (view === 'owner') {
    return [practiceItem(0), practiceItem(1, { mostWanted: true }), practiceItem(2)];
  }
  return [
    practiceItem(0),
    practiceItem(2),
    practiceItem(1, { status: 'booked', bookedBy: PRACTICE_OTHER_ID }),
  ];
}

/** An item the viewer adds to their practice list (a live one, at the top). */
export function newPracticeItem(name: string, cents: number | null, n: number): ApiItem {
  return {
    _id: `practice-new-${n}`,
    wishlist: PRACTICE_LIST_ID,
    name,
    price: cents === null ? null : { value: cents, currency: 'USD' },
    status: 'available',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}
