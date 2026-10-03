// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import GiftHistory, { YEAR_HEADER_THRESHOLD, type GiftEntry } from '@/components/GiftHistory';

const gift: GiftEntry = {
  _id: 'g1',
  itemName: 'Record player',
  itemImage: null,
  itemPrice: { value: 4999, currency: 'gbp' },
  recipientUsername: 'ben',
  wishlistName: 'Ben’s 30th',
  wishlistId: 'w1',
  giftedAt: '2026-08-24T12:00:00.000Z',
};

const date = new Date(gift.giftedAt).toLocaleDateString(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

function show(gifts: GiftEntry[]) {
  return render(<GiftHistory gifts={gifts} busy={() => false} onDelete={vi.fn()} />);
}

/** The lines under an entry's name: who it went to, then when and for how much. */
function lines(itemName: string) {
  const row = screen.getByText(itemName).closest('li') as HTMLElement;
  const paragraphs = Array.from(row.querySelectorAll('p')).map((p) => p.textContent);
  return { row, paragraphs };
}

beforeEach(() => cleanup());

describe('GiftHistory entry', () => {
  it('reads on two lines: recipient · list, then date · price', () => {
    show([gift]);
    expect(lines('Record player').paragraphs).toEqual([
      'Record player',
      'to @ben · Ben’s 30th',
      `${date} · £49.99`,
    ]);
  });

  it('links the recipient’s public profile, and leaves the list name as text', () => {
    show([gift]);
    const { row } = lines('Record player');
    expect(within(row).getByRole('link', { name: 'to @ben' }).getAttribute('href')).toBe(
      '/users/ben'
    );
    expect(within(row).queryByRole('link', { name: /30th/ })).toBeNull();
  });

  // regression: an unknown recipient printed the word "gift" in their place.
  it('regression: leaves the recipient out when it is unknown, with no placeholder', () => {
    show([{ ...gift, recipientUsername: null }]);
    const { row, paragraphs } = lines('Record player');
    expect(paragraphs[1]).toBe('Ben’s 30th');
    expect(within(row).queryByRole('link')).toBeNull();
    expect(row.textContent).not.toMatch(/\bgift\b/i);
  });

  // regression: the price was printed as `${CODE} ${toFixed(2)}` with no locale (WIS-232).
  it('regression: writes the price the way the viewer’s locale does', () => {
    const language = vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    try {
      show([gift]);
      expect(lines('Record player').paragraphs[2]).toContain('49,99 £');
    } finally {
      language.mockRestore();
    }
  });

  it('keeps the date line, and drops the first, when nothing else is known', () => {
    show([{ ...gift, itemPrice: null, recipientUsername: null, wishlistName: null }]);
    expect(lines('Record player').paragraphs).toEqual(['Record player', date]);
  });
});

describe('GiftHistory year headers', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...gift,
      _id: `g${i}`,
      itemName: `Item ${i}`,
      giftedAt: i < 2 ? '2026-08-24T12:00:00.000Z' : '2025-03-01T12:00:00.000Z',
    }));

  it('has none up to the threshold', () => {
    show(many(YEAR_HEADER_THRESHOLD));
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('adds one per year past it', () => {
    show(many(YEAR_HEADER_THRESHOLD + 1));
    const years = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(years).toEqual(['2026', '2025']);
  });
});
