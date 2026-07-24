// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ImageUpload pulls in react-easy-crop; stub it out.
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import ItemForm, { type ItemFormData } from '@/components/ItemForm';

const filled: ItemFormData = {
  name: 'Existing',
  imageUrl: '',
  price: '',
  currency: 'USD',
  link: '',
  notes: '',
  isDraft: false,
};

beforeEach(() => cleanup());

describe('ItemForm — status toggle visibility', () => {
  it('shows the Published/Draft toggle when creating', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" />);
    expect(screen.getByRole('button', { name: /published/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draft/i })).toBeInTheDocument();
  });

  it('shows the toggle when reviewing a proposal', () => {
    render(
      <ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="review" initialData={filled} />
    );
    expect(screen.getByRole('button', { name: /published/i })).toBeInTheDocument();
  });

  it('hides the toggle in propose mode', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="propose" />);
    expect(screen.queryByRole('button', { name: /published/i })).toBeNull();
  });

  // Regression: editing an existing item must NOT expose a status toggle — sending
  // status on a content edit used to clobber a booking (owners can't see bookings).
  it('regression: hides the status toggle when editing', () => {
    render(
      <ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="edit" initialData={filled} />
    );
    expect(screen.queryByRole('button', { name: /published/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^draft$/i })).toBeNull();
  });
});

describe('ItemForm — create submission', () => {
  it('submits status "available" when Published, "draft" when toggled', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" />);

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Gift', status: 'available' }))
    );

    onSubmit.mockClear();
    rerender(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" />);
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Draft gift' } });
    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }))
    );
  });
});
