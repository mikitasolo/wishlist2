// @vitest-environment jsdom
// WIS-324: Ask for a wishlist on a friend's profile, and its Asked state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import AskForWishlist from '@/components/AskForWishlist';

const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

beforeEach(() => {
  fetchMock.mockReset();
  showToast.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AskForWishlist', () => {
  it('shows Asked when the friend was already asked', async () => {
    fetchMock.mockReturnValueOnce(answer(200, { success: true, data: { asked: true } }));
    render(<AskForWishlist userId="u1" username="anna" />);
    expect(await screen.findByRole('button', { name: 'Asked' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith('/api/users/u1/ask');
  });

  it('asks, then shows Asked and says what happens next', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(answer(200, { success: true, data: { asked: false } }))
      .mockReturnValueOnce(answer(201, { success: true, data: { asked: true } }));
    render(<AskForWishlist userId="u1" username="anna" />);
    await user.click(await screen.findByRole('button', { name: 'Ask for a wishlist' }));
    expect(await screen.findByRole('button', { name: 'Asked' })).toBeDisabled();
    expect(fetchMock.mock.calls[1][0]).toBe('/api/users/u1/ask');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    expect(showToast).toHaveBeenCalledWith(
      'Asked @anna. You’ll hear when they make a list you can open.',
      'success'
    );
  });

  it('keeps the button and says why when the ask is refused', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(answer(200, { success: true, data: { asked: false } }))
      .mockReturnValueOnce(
        answer(409, { success: false, error: 'They already have a wishlist you can open' })
      );
    render(<AskForWishlist userId="u1" username="anna" />);
    await user.click(await screen.findByRole('button', { name: 'Ask for a wishlist' }));
    expect(await screen.findByRole('button', { name: 'Ask for a wishlist' })).toBeEnabled();
    expect(showToast).toHaveBeenCalledWith('They already have a wishlist you can open', 'error');
  });

  it('offers the button when the state can’t be read', async () => {
    fetchMock.mockReturnValueOnce(Promise.reject(new Error('offline')));
    render(<AskForWishlist userId="u1" username="anna" />);
    expect(await screen.findByRole('button', { name: 'Ask for a wishlist' })).toBeEnabled();
  });
});
