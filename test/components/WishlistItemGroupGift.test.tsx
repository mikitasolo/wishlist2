// @vitest-environment jsdom
// Group gifts on the item card and its sheet (WIS-362).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import type { ApiItem } from '@/types/api';
import type { GroupGiftSummary } from '@/lib/utils/groupGiftSummary';

const ME = 'user-me';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: ME } }, status: 'authenticated' }),
}));
vi.mock('@/components/ConfirmDialog', () => ({
  default: ({
    title,
    message,
    confirmText,
    onConfirm,
  }: {
    title: string;
    message: string;
    confirmText: string;
    onConfirm: () => void;
  }) => (
    <div role="dialog">
      <h2>{title}</h2>
      <p>{message}</p>
      <button onClick={onConfirm}>{confirmText}</button>
    </div>
  ),
}));

import WishlistItem from '@/components/WishlistItem';
import { resetDiscreetModeForTests, setDiscreetMode } from '@/lib/hooks/useDiscreetMode';

const notIn: GroupGiftSummary = {
  contributing: false,
  percentFunded: 40,
  target: { currency: 'USD' },
};
const contributor = (organizer: boolean): GroupGiftSummary => ({
  contributing: true,
  organizer,
  status: 'open',
  target: { value: 30000, currency: 'USD' },
  pledgedTotal: 12000,
  percentFunded: 40,
  contributors: [
    { name: 'Ann', pledged: 7000, organizer: !organizer, you: false },
    { name: 'Me', pledged: 5000, organizer, you: true },
  ],
});

function item(overrides: Partial<ApiItem> = {}): ApiItem {
  return {
    _id: 'item-1',
    wishlist: 'w1',
    name: 'Cool Gift',
    status: 'available',
    price: { value: 30000, currency: 'USD' },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ApiItem;
}

const booked = (groupGift: GroupGiftSummary, extra: Partial<ApiItem> = {}) =>
  item({ status: 'booked', groupGift, ...extra });

function renderCard(i: ApiItem, props: { isOwner?: boolean } = {}) {
  const onGroupGift = vi.fn().mockResolvedValue(null);
  render(
    <WishlistItem
      item={i}
      onUpdate={vi.fn()}
      onGroupGift={props.isOwner ? undefined : onGroupGift}
      isAuthenticated
      isMember={!props.isOwner}
      isOwner={props.isOwner}
    />
  );
  return onGroupGift;
}

function pick(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  cleanup();
  resetDiscreetModeForTests();
});
afterEach(() => cleanup());

describe('group gift: starting', () => {
  it('offers Start a group gift on an available item, next to Reserve', () => {
    renderCard(item());
    expect(screen.getByRole('button', { name: 'Reserve this item' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: 'Start a group gift' })).toBeInTheDocument();
  });

  it('starts one with the item price as the target unless changed', async () => {
    const onGroupGift = renderCard(item());
    pick('Start a group gift');
    expect(screen.getByLabelText('Target')).toHaveValue('300.00');
    type('Your pledge', '50');
    fireEvent.click(screen.getByRole('button', { name: 'Start group gift' }));
    await waitFor(() =>
      expect(onGroupGift).toHaveBeenCalledWith('item-1', {
        type: 'start',
        pledged: 5000,
        target: undefined,
      })
    );
  });

  it('sends the target when it differs from the price', async () => {
    const onGroupGift = renderCard(item());
    pick('Start a group gift');
    type('Target', '250');
    type('Your pledge', '25');
    fireEvent.click(screen.getByRole('button', { name: 'Start group gift' }));
    await waitFor(() =>
      expect(onGroupGift).toHaveBeenCalledWith('item-1', {
        type: 'start',
        pledged: 2500,
        target: { value: 25000, currency: 'USD' },
      })
    );
  });

  it('refuses an empty pledge', () => {
    const onGroupGift = renderCard(item());
    pick('Start a group gift');
    fireEvent.click(screen.getByRole('button', { name: 'Start group gift' }));
    expect(onGroupGift).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter an amount like/)).toBeInTheDocument();
  });

  it('is not offered on an item already reserved whole', () => {
    renderCard(item({ status: 'booked', bookedBy: ME }));
    expect(screen.queryByRole('menuitem', { name: 'Start a group gift' })).toBeNull();
  });
});

describe('group gift: another member’s view', () => {
  it('shows the percent funded with Join, and no names or amounts', () => {
    renderCard(booked(notIn));
    expect(screen.getByText('Group gift · 40% funded')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(screen.queryByText(/pledged/)).toBeNull();
    expect(screen.queryByText('Ann')).toBeNull();
  });

  it('joins with a pledge', async () => {
    const onGroupGift = renderCard(booked(notIn));
    fireEvent.click(screen.getByRole('button', { name: 'Join this group gift' }));
    type('Your pledge', '20');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() =>
      expect(onGroupGift).toHaveBeenCalledWith('item-1', { type: 'join', pledged: 2000 })
    );
  });

  it('regression: asks for a pledge in the gift’s currency, not the item price’s (WIS-363)', () => {
    // Cause: the summary had no currency, so Join assumed the item's price's.
    renderCard(booked({ ...notIn, target: { currency: 'EUR' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Join this group gift' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('€');
    expect(dialog).not.toHaveTextContent('$');
  });

  it('offers no way to leave or end it', () => {
    renderCard(booked(notIn));
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});

describe('group gift: a contributor', () => {
  it('sees the funding as theirs, the others’ names and pledges in the sheet', () => {
    renderCard(booked(contributor(false)));
    expect(screen.getByText('$120.00 of $300.00 pledged')).toBeInTheDocument();
    expect(screen.getByText('Reserved by you')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cool Gift' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('Ann')).toBeInTheDocument();
    expect(within(sheet).getByText('$70.00')).toBeInTheDocument();
    expect(within(sheet).getByText('You')).toBeInTheDocument();
  });

  it('changes their pledge, starting from the current one', async () => {
    const onGroupGift = renderCard(booked(contributor(false)));
    fireEvent.click(screen.getByRole('button', { name: 'Change your pledge' }));
    expect(screen.getByLabelText('Your pledge')).toHaveValue('50.00');
    type('Your pledge', '60');
    fireEvent.click(screen.getByRole('button', { name: 'Save pledge' }));
    await waitFor(() =>
      expect(onGroupGift).toHaveBeenCalledWith('item-1', { type: 'pledge', pledged: 6000 })
    );
  });

  // WIS-387: leaving asks nothing; the page offers Undo before it's sent.
  it('leaves at once, and has no organizer actions', async () => {
    const onGroupGift = renderCard(booked(contributor(false)));
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Cancel group gift' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Mark as given' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Reserve it just for me' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave group gift' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(onGroupGift).toHaveBeenCalledWith('item-1', { type: 'leave' }));
  });
});

describe('group gift: the organizer', () => {
  it.each([
    ['Mark as given', 'Mark as given', 'give', /in their history/],
    ['Reserve it just for me', 'Reserve for me', 'convert', /Everyone else’s reservation/],
  ])('%s asks first, saying what happens to the others', async (item_, confirm, kind, copy) => {
    const onGroupGift = renderCard(booked(contributor(true), { bookedBy: ME }));
    pick(item_);
    expect(screen.getByRole('dialog')).toHaveTextContent(copy);
    expect(onGroupGift).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: confirm }));
    await waitFor(() => expect(onGroupGift).toHaveBeenCalledWith('item-1', { type: kind }));
  });

  // WIS-387: cancelling and leaving ask nothing; the page offers Undo before
  // either is sent (its toast says what happens, see leaveGroupGiftToast).
  it.each([
    ['Cancel group gift', 'cancel'],
    ['Leave group gift', 'leave'],
  ])('%s goes at once, without a confirmation', async (item_, kind) => {
    const onGroupGift = renderCard(booked(contributor(true), { bookedBy: ME }));
    pick(item_);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(onGroupGift).toHaveBeenCalledWith('item-1', { type: kind }));
  });
});

describe('group gift: who never sees it', () => {
  it('regression: an owner sees a booked item as plain available, whatever it carries', () => {
    // An owner's answer never carries a summary (WIS-361); even if one got through,
    // the card draws nothing of it and offers no group action.
    renderCard(booked(contributor(true)), { isOwner: true });
    expect(screen.queryByTestId('group-gift')).toBeNull();
    expect(screen.queryByText(/group gift|funded|reserved/i)).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /group gift/i })).toBeNull();
  });

  it('discreet mode hides the group gift and every action on it', () => {
    setDiscreetMode(true);
    renderCard(booked(contributor(true), { bookedBy: ME }));
    expect(screen.queryByTestId('group-gift')).toBeNull();
    expect(screen.queryByText(/funded|Reserved by you/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change your pledge' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    setDiscreetMode(false);
  });

  it('discreet mode does not offer starting one either', () => {
    setDiscreetMode(true);
    renderCard(item());
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    setDiscreetMode(false);
  });
});
