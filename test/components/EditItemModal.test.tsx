// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ApiItem } from '@/types/api';

// ImageUpload pulls in react-easy-crop; stub it out.
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import EditItemModal from '@/components/EditItemModal';

function item(overrides: Partial<ApiItem>): ApiItem {
  return {
    _id: 'item-1',
    wishlist: 'w1',
    name: 'Bike',
    status: 'available',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ApiItem;
}

const mostWantedSwitch = () => screen.queryByRole('switch', { name: /most wanted/i });
const currencies = { wishlistCurrency: 'USD', userCurrency: 'USD' };

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());

describe('EditItemModal — most wanted', () => {
  // Owners are booking-blind, so an edit that sent a status could wipe a
  // booking they can't see. Flagging an item is a content edit like any other.
  it('saves the flag without sending a status', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EditItemModal isOpen onClose={vi.fn()} onSave={onSave} item={item({})} {...currencies} />
    );

    fireEvent.click(mostWantedSwitch()!);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({ mostWanted: true });
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('status');
  });

  it('offers no switch to a proposer editing their own proposal', () => {
    render(
      <EditItemModal
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        item={item({ status: 'proposed' })}
        {...currencies}
      />
    );
    expect(mostWantedSwitch()).toBeNull();
  });
});
