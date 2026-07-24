// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { ApiItem } from '@/types/api';

const ME = 'user-me';

// Stub next-auth session as the current user.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: ME } }, status: 'authenticated' }),
}));

// BannerImage wraps next/image — render a plain <img> so we can assert presence.
vi.mock('@/components/BannerImage', () => ({
  default: ({ alt }: { alt?: string }) => <img alt={alt ?? ''} data-testid="banner-image" />,
}));

// Simplify ConfirmDialog to expose its message + confirm/cancel buttons.
vi.mock('@/components/ConfirmDialog', () => ({
  default: ({
    isOpen,
    title,
    message,
    confirmText,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div role="dialog">
        <h2>{title}</h2>
        <p>{message}</p>
        <button onClick={onConfirm}>{confirmText}</button>
        <button onClick={onCancel}>cancel</button>
      </div>
    ) : null,
}));

import WishlistItem from '@/components/WishlistItem';

function item(overrides: Partial<ApiItem>): ApiItem {
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

beforeEach(() => cleanup());

describe('WishlistItem — booking visibility', () => {
  // Regression: owners must never see booking status ("booked" folds to available).
  it('regression: hides booking badges from the owner', () => {
    render(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: 'someone-else' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isOwner
      />
    );
    expect(screen.queryByText(/booked/i)).toBeNull();
  });

  it('shows "Booked by you" to the member who booked it', () => {
    render(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: ME })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    expect(screen.getByText(/booked by you/i)).toBeInTheDocument();
  });
});

describe('WishlistItem — owner status actions', () => {
  // Regression: draft items get a Publish action (safe), not a status toggle in edit.
  it('regression: a draft item shows Edit + Publish for the owner', () => {
    render(
      <WishlistItem
        item={item({ status: 'draft' })}
        onUpdate={vi.fn()}
        onEdit={vi.fn()}
        isAuthenticated
        isOwner
      />
    );
    expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^complete$/i })).toBeNull();
  });

  it('publishing a draft calls onUpdate with status available', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <WishlistItem item={item({ status: 'draft' })} onUpdate={onUpdate} isAuthenticated isOwner />
    );
    fireEvent.click(screen.getByRole('button', { name: /publish/i }));
    expect(onUpdate).toHaveBeenCalledWith('item-1', { status: 'available' });
    await act(async () => {}); // flush async state after onUpdate resolves
  });

  // Regression: moving a live item to draft is dangerous (may be booked) → warn.
  it('regression: move-to-draft warns before applying', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <WishlistItem
        item={item({ status: 'available' })}
        onUpdate={onUpdate}
        isAuthenticated
        isOwner
      />
    );
    // Draft button is present on a live item…
    fireEvent.click(screen.getByRole('button', { name: /draft/i }));
    // …and shows a warning dialog rather than applying immediately.
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(/cancel their reservation/i);
    // Confirming applies status: draft.
    fireEvent.click(screen.getByRole('button', { name: /move to draft/i }));
    expect(onUpdate).toHaveBeenCalledWith('item-1', { status: 'draft' });
    await act(async () => {}); // flush async state after onUpdate resolves
  });

  it('completed items offer Uncomplete and no move-to-draft', () => {
    render(
      <WishlistItem
        item={item({ status: 'completed' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isOwner
      />
    );
    // The button's accessible name comes from its aria-label.
    expect(screen.getByRole('button', { name: /mark item as available/i })).toBeInTheDocument();
    expect(screen.getByText('Uncomplete')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /move item to draft/i })).toBeNull();
  });
});

describe('WishlistItem — notes overlay', () => {
  // Regression: notes render OVER the image, not by replacing it with a gray box.
  it('regression: shows the note text while the image stays rendered', () => {
    render(
      <WishlistItem
        item={item({ notes: 'Size L, blue please', imageUrl: 'https://x/y.jpg' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    // Toggle notes on.
    fireEvent.click(screen.getByRole('button', { name: /show notes/i }));
    expect(screen.getByText('Size L, blue please')).toBeInTheDocument();
    expect(screen.getByTestId('banner-image')).toBeInTheDocument();
  });
});

describe('WishlistItem — price conversion', () => {
  // Regression: the currency selector converts displayed prices via rates.
  it('regression: converts the displayed price to the picked currency', () => {
    const rates = { pln: 4 }; // 1 USD = 4 PLN
    const priced = item({ price: { value: 400, currency: 'pln' } }); // 4 PLN

    const { rerender } = render(
      <WishlistItem item={priced} onUpdate={vi.fn()} isAuthenticated priceCurrency="original" rates={rates} />
    );
    expect(screen.getByText('PLN 4.00')).toBeInTheDocument();

    rerender(
      <WishlistItem item={priced} onUpdate={vi.fn()} isAuthenticated priceCurrency="usd" rates={rates} />
    );
    expect(screen.getByText('USD 1.00')).toBeInTheDocument();
  });
});
