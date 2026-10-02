// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import WishlistCard, { WISHLIST_CARD_COVER_SIZES } from '@/components/WishlistCard';
import { coverGradient } from '@/lib/utils/cover';
import { formatCalendarDate, type Occasion } from '@/lib/utils/occasion';

type CardWishlist = ComponentProps<typeof WishlistCard>['wishlist'];

const BANNER = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/banner.jpg';

function wishlist(overrides: Record<string, unknown> = {}): CardWishlist {
  return {
    _id: 'w1',
    slug: 'birthday',
    name: 'Birthday',
    visibility: 'everyone',
    itemCount: 3,
    ...overrides,
  } as unknown as CardWishlist;
}

// jsdom normalises the inline style, so compare against what it makes of the
// gradient rather than the raw string.
function placeholderOf(seed: string) {
  const probe = document.createElement('div');
  probe.style.background = coverGradient(seed);
  return probe.style.background;
}

// The cover band is the card link's first child.
const coverOf = (container: HTMLElement) =>
  container.querySelector('a')!.firstElementChild as HTMLElement;

describe('WishlistCard — cover', () => {
  it('shows the banner, without the placeholder behind it', () => {
    const { container } = render(<WishlistCard wishlist={wishlist({ bannerUrl: BANNER })} />);
    expect(coverOf(container).querySelector('img')).not.toBeNull();
    expect(coverOf(container).style.background).toBe('');
  });

  it('shows the placeholder when the list has no banner', () => {
    const { container } = render(<WishlistCard wishlist={wishlist({ bannerUrl: null })} />);
    expect(coverOf(container).querySelector('img')).toBeNull();
    expect(coverOf(container).style.background).toBe(placeholderOf('w1'));
  });

  // regression: the card painted the gradient only when there was no banner URL,
  // so a freed blob or a dead external banner left a blank band.
  it('regression: falls back to the placeholder when the banner fails to load', () => {
    const { container } = render(<WishlistCard wishlist={wishlist({ bannerUrl: BANNER })} />);

    fireEvent.error(coverOf(container).querySelector('img')!);

    expect(coverOf(container).querySelector('img')).toBeNull();
    expect(coverOf(container).style.background).toBe(placeholderOf('w1'));
    // The badges on the band are still there.
    expect(screen.getByText('Public')).toBeInTheDocument();
  });

  // regression: the cover passed no `sizes`, so BannerImage's `100vw` default
  // told the browser the banner spans the whole viewport, and every card in a
  // grid downloaded a viewport-wide banner for a ~300px card. `next dev` warned:
  // 'has "fill" prop and "sizes" prop of "100vw", but image is not rendered at
  // full viewport width'.
  it('regression: asks for a banner the width of a card in the grid, not of the viewport', () => {
    const { container } = render(<WishlistCard wishlist={wishlist({ bannerUrl: BANNER })} />);
    const sizes = coverOf(container).querySelector('img')!.getAttribute('sizes');
    expect(sizes).toBe(WISHLIST_CARD_COVER_SIZES);
    // Past the last breakpoint (four columns in a max-w-7xl page) it's a card's
    // width, however wide the screen.
    expect(sizes?.split(', ').at(-1)).toBe('320px');
  });
});

describe('WishlistCard — occasion', () => {
  // As stored: a yearly occasion's year is the placeholder, which must never show.
  const BIRTHDAY: Occasion = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' };

  beforeEach(() => {
    // Local noon on Oct 2, 2026, so the local date is that day in any time zone.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the occasion and its countdown on the cover, with the other badges', () => {
    const { container } = render(
      <WishlistCard wishlist={wishlist({ occasion: BIRTHDAY, featured: true })} />
    );
    const label = screen.getByText('Birthday · in 12 days');
    expect(label.tagName).toBe('TIME');
    expect(label).toHaveAttribute('dateTime', '2026-10-14');
    expect(coverOf(container)).toContainElement(label);
    expect(screen.getByText('Featured')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
    // Not the placeholder year, anywhere on the card.
    expect(container.innerHTML).not.toContain('2000');
  });

  it('shows a one-off that has passed as its kind and date, as the header does', () => {
    const wedding: Occasion = { kind: 'wedding', date: '2026-06-12', recurrence: null };
    render(<WishlistCard wishlist={wishlist({ occasion: wedding })} />);
    expect(screen.getByText(`Wedding · ${formatCalendarDate('2026-06-12')}`)).toBeInTheDocument();
  });

  it('shows nothing for a list without one, or one saved before occasions existed', () => {
    for (const occasion of [null, undefined]) {
      const { container, unmount } = render(<WishlistCard wishlist={wishlist({ occasion })} />);
      expect(container.querySelector('time')).toBeNull();
      expect(container).not.toHaveTextContent('·');
      unmount();
    }
  });
});
