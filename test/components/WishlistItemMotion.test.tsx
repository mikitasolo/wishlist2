// @vitest-environment jsdom
// The item card's motion (WIS-407): played by the viewer's own successful
// action only, never by a change in the data; no reservation motion for an
// owner or in discreet mode, and nothing at all under reduced motion.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { ApiItem } from '@/types/api';
import type { GroupGiftSummary } from '@/lib/utils/groupGiftSummary';

const ME = 'user-me';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: ME } }, status: 'authenticated' }),
}));

vi.mock('@/components/ConfirmDialog', () => ({
  default: ({
    isOpen,
    confirmText,
    onConfirm,
  }: {
    isOpen: boolean;
    confirmText: string;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <div role="dialog">
        <button onClick={onConfirm}>{confirmText}</button>
      </div>
    ) : null,
}));

import WishlistItem from '@/components/WishlistItem';
import { resetDiscreetModeForTests, setDiscreetMode } from '@/lib/hooks/useDiscreetMode';
import { cueItemCard, MOTION_MS, REDUCED_MOTION_QUERY } from '@/lib/utils/motion';

function item(overrides: Partial<ApiItem> = {}): ApiItem {
  return {
    _id: 'item-1',
    wishlist: 'w1',
    name: 'Cool Gift',
    status: 'available',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ApiItem;
}

type Props = ComponentProps<typeof WishlistItem>;

function renderCard(props: Partial<Props> = {}) {
  const onUpdate = props.onUpdate ?? vi.fn(async (_id: string, u: Partial<ApiItem>) => item(u));
  const view = render(
    <WishlistItem item={item()} isAuthenticated isMember {...props} onUpdate={onUpdate} />
  );
  return { ...view, onUpdate };
}

const card = () => screen.getByRole('article');

/** An update the test settles by hand. */
function heldUpdate() {
  let settle!: (value: ApiItem | null) => void;
  const onUpdate = vi.fn(
    () =>
      new Promise<ApiItem | null>((resolve) => {
        settle = resolve;
      })
  );
  return { onUpdate, settle: (value: ApiItem | null) => act(async () => settle(value)) };
}

function pick(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

/** jsdom has no matchMedia: give it one where the viewer asked for reduced motion. */
function withReducedMotion() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  resetDiscreetModeForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => setDiscreetMode(false));
});

describe('WishlistItem motion — a member reserving and releasing', () => {
  it('morphs the card once a reserve has succeeded, not while it is on its way', async () => {
    const { onUpdate, settle } = heldUpdate();
    renderCard({ onUpdate });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve this item' }));
    expect(card()).not.toHaveAttribute('data-motion');

    await settle(item({ status: 'booked', bookedBy: ME }));
    expect(card()).toHaveAttribute('data-motion', 'reserve');
    expect(card()).toHaveClass('motion-reserve');

    // Once, then it's over.
    await waitFor(() => expect(card()).not.toHaveAttribute('data-motion'), {
      timeout: MOTION_MS.reserve + 500,
    });
  });

  it('settles the card once a release has succeeded', async () => {
    const { onUpdate, settle } = heldUpdate();
    renderCard({ onUpdate, item: item({ status: 'booked', bookedBy: ME }) });
    fireEvent.click(screen.getByRole('button', { name: 'Release this item' }));
    await settle(item({ status: 'available' }));
    expect(card()).toHaveAttribute('data-motion', 'release');
  });

  it('plays nothing when the reserve fails', async () => {
    const { onUpdate, settle } = heldUpdate();
    renderCard({ onUpdate });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve this item' }));
    await settle(null);
    expect(card()).not.toHaveAttribute('data-motion');
  });

  it('plays nothing when a poll shows someone else reserved it', () => {
    const { rerender, onUpdate } = renderCard();
    rerender(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: 'someone-else' })}
        onUpdate={onUpdate}
        isAuthenticated
        isMember
      />
    );
    expect(card()).toHaveAttribute('data-status', 'bookedByOthers');
    expect(card()).not.toHaveAttribute('data-motion');
  });

  it('plays nothing under reduced motion', async () => {
    withReducedMotion();
    const { onUpdate, settle } = heldUpdate();
    renderCard({ onUpdate });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve this item' }));
    await settle(item({ status: 'booked', bookedBy: ME }));
    expect(card()).not.toHaveAttribute('data-motion');
  });
});

describe('WishlistItem motion — discreet mode', () => {
  // The reserve's answer lands after No spoiler mode went on: the card is drawn
  // as plain available by then, and a morph would say it was just reserved.
  it('plays no reservation motion when discreet mode went on while the reserve was on its way', async () => {
    const { onUpdate, settle } = heldUpdate();
    renderCard({ onUpdate });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve this item' }));
    act(() => setDiscreetMode(true));
    await settle(item({ status: 'booked', bookedBy: ME }));
    expect(card()).not.toHaveAttribute('data-motion');
    expect(card()).not.toHaveClass('motion-reserve');
  });

  it('stops a reservation moment at once when discreet mode goes on', async () => {
    const { onUpdate, settle } = heldUpdate();
    renderCard({ onUpdate });
    fireEvent.click(screen.getByRole('button', { name: 'Reserve this item' }));
    await settle(item({ status: 'booked', bookedBy: ME }));
    expect(card()).toHaveAttribute('data-motion', 'reserve');
    act(() => setDiscreetMode(true));
    expect(card()).not.toHaveAttribute('data-motion');
  });

  it('plays no given moment for a group gift whose give lands in discreet mode', async () => {
    const { onGroupGift, settle } = organizerGivingGift();
    act(() => setDiscreetMode(true));
    await settle(item({ status: 'booked', bookedBy: ME, givenByMe: true }));
    expect(card()).not.toHaveAttribute('data-motion');
    expect(screen.queryByTestId('given-moment')).toBeNull();
    expect(onGroupGift).toHaveBeenCalledWith('item-1', { type: 'give' });
  });
});

const organizing: GroupGiftSummary = {
  contributing: true,
  organizer: true,
  status: 'funded',
  target: { value: 30000, currency: 'USD' },
  pledgedTotal: 30000,
  percentFunded: 100,
  contributors: [
    { name: 'Ann', pledged: 10000, organizer: false, you: false },
    { name: 'Me', pledged: 20000, organizer: true, you: true },
  ],
};

/** The organizer's card, its group gift's Mark as given picked and confirmed, its answer held. */
function organizerGivingGift() {
  let settle!: (value: ApiItem | null) => void;
  const onGroupGift = vi.fn(
    () =>
      new Promise<ApiItem | null>((resolve) => {
        settle = resolve;
      })
  );
  renderCard({
    item: item({ status: 'booked', bookedBy: ME, groupGift: organizing }),
    onGroupGift,
  });
  pick('Mark as given');
  fireEvent.click(screen.getByRole('button', { name: 'Mark as given' }));
  return { onGroupGift, settle: (value: ApiItem | null) => act(async () => settle(value)) };
}

describe('WishlistItem motion — a group gift given', () => {
  it("plays the given moment on the organizer's card once it has succeeded", async () => {
    const { settle } = organizerGivingGift();
    expect(screen.queryByTestId('given-moment')).toBeNull();
    await settle(item({ status: 'booked', bookedBy: ME, givenByMe: true }));
    expect(card()).toHaveAttribute('data-motion', 'given');
    expect(screen.getByTestId('given-moment')).toHaveAttribute('aria-hidden');
  });

  it('plays nothing when it fails', async () => {
    const { settle } = organizerGivingGift();
    await settle(null);
    expect(screen.queryByTestId('given-moment')).toBeNull();
  });
});

describe('WishlistItem motion — owners', () => {
  // Owners are booking-blind: nothing about a reservation may move on their card.
  it('never plays reservation motion for an owner, whatever a poll brings', () => {
    const onUpdate = vi.fn();
    const { rerender } = render(
      <WishlistItem item={item()} onUpdate={onUpdate} isAuthenticated isOwner />
    );
    for (const next of [
      item({ status: 'booked', bookedBy: 'someone-else' }),
      item({ status: 'available', bookedBy: null }),
    ]) {
      rerender(<WishlistItem item={next} onUpdate={onUpdate} isAuthenticated isOwner />);
      expect(card()).not.toHaveAttribute('data-motion');
      expect(card()).toHaveAttribute('data-status', 'available');
    }
  });

  it('cues the card once a Publish has succeeded', async () => {
    const { onUpdate, settle } = heldUpdate();
    render(
      <WishlistItem
        item={item({ status: 'draft' })}
        onUpdate={onUpdate}
        onEdit={vi.fn()}
        isAuthenticated
        isOwner
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish item' }));
    expect(card()).not.toHaveAttribute('data-motion');
    await settle(item({ status: 'available' }));
    expect(card()).toHaveAttribute('data-motion', 'cue');
  });

  it('cues the card once Mark as received has succeeded, and not for a failed one', async () => {
    const { onUpdate, settle } = heldUpdate();
    render(<WishlistItem item={item()} onUpdate={onUpdate} isAuthenticated isOwner />);
    pick('Mark as received');
    fireEvent.click(screen.getByRole('button', { name: 'Mark as received' }));
    await settle(null);
    expect(card()).not.toHaveAttribute('data-motion');

    pick('Mark as received');
    fireEvent.click(screen.getByRole('button', { name: 'Mark as received' }));
    await settle(item({ status: 'completed' }));
    expect(card()).toHaveAttribute('data-motion', 'cue');
  });

  it("cues an owner's card when its proposal is accepted, and no one else's", () => {
    const onUpdate = vi.fn();
    render(
      <>
        <WishlistItem item={item()} onUpdate={onUpdate} isAuthenticated isOwner />
        <WishlistItem
          item={item({ _id: 'item-2', name: 'Other' })}
          onUpdate={onUpdate}
          isAuthenticated
          isOwner
        />
      </>
    );
    act(() => cueItemCard('item-1'));
    expect(screen.getByRole('article', { name: 'Item: Cool Gift' })).toHaveAttribute(
      'data-motion',
      'cue'
    );
    expect(screen.getByRole('article', { name: 'Item: Other' })).not.toHaveAttribute('data-motion');
  });

  it("ignores the cue on a member's card", () => {
    renderCard();
    act(() => cueItemCard('item-1'));
    expect(card()).not.toHaveAttribute('data-motion');
  });

  it('plays no cue under reduced motion', async () => {
    withReducedMotion();
    const { onUpdate, settle } = heldUpdate();
    render(
      <WishlistItem item={item({ status: 'draft' })} onUpdate={onUpdate} isAuthenticated isOwner />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish item' }));
    await settle(item({ status: 'available' }));
    expect(card()).not.toHaveAttribute('data-motion');
  });
});
