// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ApiItem } from '@/types/api';

vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import EditItemModal from '@/components/EditItemModal';

const item = {
  _id: 'item-1',
  wishlist: 'w1',
  name: 'Bike',
  status: 'available',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
} as ApiItem;

function open(initialFocus?: 'link') {
  render(
    <EditItemModal
      isOpen
      onClose={vi.fn()}
      onSave={vi.fn()}
      item={item}
      wishlistCurrency="USD"
      userCurrency="USD"
      initialFocus={initialFocus}
    />
  );
}

describe('EditItemModal initial focus', () => {
  it('starts on the Link field when asked to (an owner\'s "+ link")', () => {
    open('link');
    expect(screen.getByLabelText('Product link')).toHaveFocus();
  });

  it('otherwise leaves focus off the Link field', () => {
    open();
    expect(screen.getByLabelText('Product link')).not.toHaveFocus();
  });
});
