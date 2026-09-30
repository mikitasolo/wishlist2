// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import WishlistCard from '@/components/WishlistCard';
import { coverGradient } from '@/lib/utils/cover';

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
});
