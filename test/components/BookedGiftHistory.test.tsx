// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';

const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
// The header has its own fetches and tests; this file is about the history's rows.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import BookedPage from '@/app/booked/page';
import { formatPriceFromObject } from '@/lib/utils/currency';

const gift = {
  itemImage: null,
  itemPrice: { value: 4999, currency: 'gbp' },
  recipientUsername: 'ben',
  wishlistName: 'Ben’s 30th',
  wishlistId: 'w1',
  wishlistSlug: 'bens-30th',
  giftedAt: '2026-08-24T12:00:00.000Z',
};

function serve(gifts: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const data =
        url === '/api/users/me/gifts' ? gifts : url === '/api/users/me/reservations' ? [] : null;
      if (!data) throw new Error(`unexpected fetch ${url}`);
      return { ok: true, status: 200, json: async () => ({ success: true, data }) };
    })
  );
}

/** The line under a gift-history entry's name: price, recipient, list and date. */
async function metaLine(itemName: string) {
  const row = (await screen.findByText(itemName)).closest('li') as HTMLElement;
  return within(row).getByText(itemName).nextElementSibling?.textContent;
}

const price = formatPriceFromObject(gift.itemPrice); // "GBP 49.99"
const date = new Date(gift.giftedAt).toLocaleDateString(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

beforeEach(() => cleanup());
afterEach(() => vi.unstubAllGlobals());

describe('BookedPage — a gift-history entry', () => {
  it('reads price · recipient · list · date', async () => {
    serve([{ ...gift, _id: 'g1', itemName: 'Record player' }]);
    render(<BookedPage />);

    expect(await metaLine('Record player')).toBe(`${price} · to @ben · Ben’s 30th · ${date}`);
  });

  // regression: an entry whose recipient is unknown (an account with no
  // username, or one that's gone) printed the word "gift" in their place:
  // "GBP 49.99 · gift · Ben's 30th · Aug 24, 2026".
  it('regression: leaves the recipient out when it is unknown, with no placeholder', async () => {
    serve([{ ...gift, _id: 'g1', itemName: 'Record player', recipientUsername: null }]);
    render(<BookedPage />);

    const meta = await metaLine('Record player');
    expect(meta).toBe(`${price} · Ben’s 30th · ${date}`);
    expect(meta).not.toMatch(/\bgift\b/i);
  });

  it('leaves out whatever else it lacks too, with no stray separator', async () => {
    serve([
      {
        ...gift,
        _id: 'g1',
        itemName: 'Record player',
        itemPrice: null,
        recipientUsername: null,
        wishlistName: null,
      },
    ]);
    render(<BookedPage />);

    expect(await metaLine('Record player')).toBe(date);
  });
});
