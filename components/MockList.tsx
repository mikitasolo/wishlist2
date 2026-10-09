import { coverGradient, coverInitial } from '@/lib/utils/cover';
import { formatPrice } from '@/lib/utils/currency';

/**
 * The made-up list the landing page's mock and the guided walkthrough's
 * illustrations draw (WIS-371): no real account's data, ever.
 */
export const MOCK_ITEMS = [
  { name: 'Ceramic pour-over set', cents: 4800 },
  { name: 'Linen apron', cents: 3200 },
  { name: 'Hiking day pack', cents: 8900 },
];
export const MOCK_RESERVED = MOCK_ITEMS[0];

export const mockPrice = (cents: number) => formatPrice({ value: cents, currency: 'usd' });

/** A made-up item's thumbnail: its initial on its gradient, as `Cover` draws a missing image. */
export function MockThumb({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={`flex flex-shrink-0 items-center justify-center rounded-lg font-semibold text-white/90 ${
        size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'
      }`}
      style={{ background: coverGradient(name) }}
    >
      {coverInitial(name)}
    </span>
  );
}
