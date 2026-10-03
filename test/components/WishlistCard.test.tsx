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

describe('WishlistCard — item count', () => {
  it('shows the published items alone on a list with no drafts or proposals to show', () => {
    render(<WishlistCard wishlist={wishlist({ itemCount: 1 })} />);
    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  it('adds the drafts and proposals to review, on a list you own', () => {
    render(
      <WishlistCard wishlist={wishlist({ itemCount: 11, draftCount: 2, proposalCount: 1 })} />
    );
    expect(screen.getByText('11 items · 2 drafts · 1 to review')).toBeInTheDocument();
  });

  it('leaves out what there is none of', () => {
    render(<WishlistCard wishlist={wishlist({ itemCount: 0, draftCount: 0, proposalCount: 3 })} />);
    expect(screen.getByText('0 items · 3 to review')).toBeInTheDocument();
  });
});

describe('WishlistCard — archived', () => {
  // regression: an archived card showed its visibility ("Public") next to the
  // Archived pill, though only its owners can open it.
  it('regression: shows Archived in place of the visibility pill', () => {
    const { container } = render(
      <WishlistCard
        wishlist={wishlist({ archived: true, visibility: 'everyone', userRole: 'owner' })}
      />
    );
    expect(coverOf(container)).toHaveTextContent('Archived');
    expect(screen.getAllByText('Archived')).toHaveLength(1);
    expect(screen.queryByText('Public')).toBeNull();
    // Nor the role or Pinned: the band says only that it's archived, as before.
    expect(screen.queryByText('owner')).toBeNull();
  });

  it('shows its visibility again, and the role, once it is unarchived', () => {
    render(
      <WishlistCard
        wishlist={wishlist({ archived: false, visibility: 'friends', userRole: 'owner' })}
      />
    );
    expect(screen.getByText('Friends')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.queryByText('Archived')).toBeNull();
  });
});

describe('WishlistCard — owner', () => {
  it('names the owner and counts the co-owners, as the list’s phone row does', () => {
    render(
      <WishlistCard
        showOwner
        wishlist={wishlist({
          owners: ['dan-id', 'x-id'],
          ownerUsername: 'dan',
          // A co-owner without a username isn't in here, but is still counted.
          ownerUsernames: ['dan'],
        })}
      />
    );
    expect(screen.getByText('@dan +1')).toBeInTheDocument();
  });

  // regression: an owner without a username showed as "@unknown"; a user is
  // named to others by publicDisplayName.
  it('regression: names an owner without a username "Someone"', () => {
    render(
      <WishlistCard
        showOwner
        wishlist={wishlist({ owners: ['x-id'], ownerUsername: null, ownerUsernames: [] })}
      />
    );
    expect(screen.getByText('Someone')).toBeInTheDocument();
    expect(screen.queryByText(/unknown/)).toBeNull();
  });
});

describe('WishlistCard — shared with you', () => {
  it('shows how many items you have reserved on a list shared with you', () => {
    render(
      <WishlistCard wishlist={wishlist({ userRole: 'member', reservedByYou: 2 })} showOwner />
    );
    expect(screen.getByText('2 reserved by you')).toBeInTheDocument();
  });

  it('shows no chip when you have reserved nothing there, or the list has no count', () => {
    for (const reservedByYou of [0, undefined]) {
      const { container, unmount } = render(
        <WishlistCard wishlist={wishlist({ userRole: 'member', reservedByYou })} showOwner />
      );
      expect(container).not.toHaveTextContent('reserved by you');
      unmount();
    }
  });

  it('leaves the role off when asked, where the section already says it', () => {
    const { unmount } = render(
      <WishlistCard wishlist={wishlist({ userRole: 'member' })} showOwner showRole={false} />
    );
    expect(screen.queryByText('member')).toBeNull();
    unmount();

    // Elsewhere (a profile), the role still shows.
    render(<WishlistCard wishlist={wishlist({ userRole: 'member' })} showOwner />);
    expect(screen.getByText('member')).toBeInTheDocument();
  });

  // WIS-302: the pin button is the one sign that a list is pinned.
  it('never says Pinned on the cover, with or without the role', () => {
    const { unmount } = render(
      <WishlistCard
        wishlist={wishlist({ userRole: 'member', featured: true })}
        showOwner
        showRole={false}
      />
    );
    expect(screen.queryByText('Pinned')).toBeNull();
    unmount();

    render(<WishlistCard wishlist={wishlist({ userRole: 'owner', featured: true })} />);
    expect(screen.queryByText('Pinned')).toBeNull();
    expect(screen.getByText('owner')).toBeInTheDocument();
  });
});

describe('WishlistCard — Pin to top', () => {
  const pin = (pinned: boolean, busy = false) => ({ pinned, busy, onToggle: vi.fn() });

  it('offers Pin to top over the cover, outside the card’s link, and toggles it', () => {
    const control = pin(false);
    const { container } = render(<WishlistCard wishlist={wishlist()} pin={control} />);
    const button = screen.getByRole('button', { name: 'Pin to top', pressed: false });
    expect(button).toHaveAttribute('title', 'Pin to top');
    expect(container.querySelector('a')).not.toContainElement(button);
    fireEvent.click(button);
    expect(control.onToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Pinned')).toBeNull();
  });

  // WIS-302: the pin button alone says the list is pinned, as a toggle: its
  // name stays Pin to top (a name that flipped to Unpin would read "Unpin,
  // pressed"), aria-pressed says it's on, and the tooltip says Unpin.
  it('is pressed and filled on the pinned list, with Unpin as its tooltip and no Pinned badge', () => {
    render(<WishlistCard wishlist={wishlist({ featured: true })} pin={pin(true)} />);
    const button = screen.getByRole('button', { name: 'Pin to top', pressed: true });
    expect(button).toHaveAttribute('title', 'Unpin');
    expect(button.querySelector('svg')).toHaveClass('fill-current');
    expect(screen.queryByText('Pinned')).toBeNull();
  });

  it('holds the button while a pin is on its way', () => {
    render(<WishlistCard wishlist={wishlist()} pin={pin(false, true)} />);
    expect(screen.getByRole('button', { name: 'Pin to top' })).toBeDisabled();
  });

  it('has no pin button without one', () => {
    render(<WishlistCard wishlist={wishlist({ featured: true })} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
