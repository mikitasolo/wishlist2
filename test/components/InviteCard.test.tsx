// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import InviteCard, { type PendingInvite } from '@/components/InviteCard';

const base: PendingInvite = {
  _id: 'inv-1',
  role: 'member',
  wishlistId: 'w1',
  wishlistName: 'Garden',
  wishlistSlug: 'garden',
  invitedByUsername: 'chloe_r',
  invitedByImage: null,
};

const renderCard = (fields: Partial<PendingInvite> = {}) =>
  render(
    <InviteCard
      invite={{ ...base, ...fields }}
      busy={false}
      onAccept={vi.fn()}
      onDecline={vi.fn()}
    />
  );

describe('InviteCard', () => {
  it('shows a member invite’s role chip and what it means', () => {
    renderCard();
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(
      screen.getByText(
        'You can reserve gifts and suggest items. @chloe_r won’t see who reserved what.'
      )
    ).toBeInTheDocument();
  });

  it('shows a co-owner invite’s role chip and what it means', () => {
    renderCard({ role: 'owner', yourReservations: 0 });
    expect(screen.getByText('Co-owner')).toBeInTheDocument();
    expect(
      screen.getByText(
        'You’ll edit the list, manage who’s on it, and it will show on your profile.'
      )
    ).toBeInTheDocument();
  });

  it('warns about releasing reservations only when the invitee holds some there', () => {
    const { unmount } = renderCard({ role: 'owner', yourReservations: 0 });
    expect(screen.queryByText(/accepting releases/)).toBeNull();
    unmount();

    renderCard({ role: 'owner', yourReservations: 2 });
    expect(
      screen.getByText(
        'You’ve reserved 2 gifts here. Co-owners can’t see reservations, so accepting releases them.'
      )
    ).toBeInTheDocument();
  });

  it('links the name, and shows the list’s size, only when the invitee can already open it', () => {
    const { unmount } = renderCard({ preview: null });
    expect(screen.queryByRole('link', { name: 'Garden' })).toBeNull();
    expect(screen.getByText('Garden')).toBeInTheDocument();
    expect(screen.getByText('from @chloe_r')).toBeInTheDocument();
    unmount();

    renderCard({ preview: { bannerUrl: null, occasion: null, itemCount: 12 } });
    expect(screen.getByRole('link', { name: 'Garden' })).toHaveAttribute(
      'href',
      '/wishlists/garden'
    );
    expect(screen.getByText('from @chloe_r · 12 items')).toBeInTheDocument();
  });

  it('links a list with no slug by its id', () => {
    renderCard({ wishlistSlug: null, preview: { bannerUrl: null, occasion: null, itemCount: 0 } });
    expect(screen.getByRole('link', { name: 'Garden' })).toHaveAttribute('href', '/wishlists/w1');
  });
});
