// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import GlobalSearch from '@/components/GlobalSearch';

const fetchMock = vi.fn();

beforeEach(() => {
  cleanup();
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    json: async () => ({
      success: true,
      data: {
        users: [{ username: 'alice', image: null }],
        wishlists: [
          { _id: 'w1', name: 'Alice birthday', slug: 'alice-birthday', ownerUsername: 'bob' },
          { _id: 'w2', name: 'Alice old list', slug: null, ownerUsername: null },
        ],
      },
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

const field = () => screen.getByRole('textbox', { name: 'Search people and wishlists' });
const type = (value: string) => fireEvent.change(field(), { target: { value } });

describe('GlobalSearch — inline (landing page)', () => {
  it('is an open field from the start, searching /api/search once there are 3 characters', async () => {
    render(<GlobalSearch variant="inline" />);
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();

    type('al');
    expect(screen.getByText(/at least 3 characters/i)).toBeInTheDocument();

    type('ali');
    expect(await screen.findByText('@alice')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=ali');
    expect(screen.getByText('Alice birthday')).toBeInTheDocument();
  });

  it('opens a person’s profile and a list by its slug, or its id when it has none', async () => {
    render(<GlobalSearch variant="inline" />);
    type('ali');
    fireEvent.click(await screen.findByText('@alice'));
    expect(push).toHaveBeenLastCalledWith('/users/alice');
    // Navigating clears the field and closes the results.
    expect(field()).toHaveValue('');
    expect(screen.queryByText('Alice birthday')).toBeNull();

    type('ali');
    fireEvent.click(await screen.findByText('Alice birthday'));
    expect(push).toHaveBeenLastCalledWith('/wishlists/alice-birthday');

    type('ali');
    fireEvent.click(await screen.findByText('Alice old list'));
    expect(push).toHaveBeenLastCalledWith('/wishlists/w2');
  });

  it('hides its results on Escape but keeps the field and what was typed', async () => {
    render(<GlobalSearch variant="inline" />);
    type('ali');
    await screen.findByText('@alice');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('@alice')).toBeNull());
    expect(field()).toHaveValue('ali');

    // The field kept focus, so it's a click that brings the results back.
    fireEvent.click(field());
    expect(await screen.findByText('@alice')).toBeInTheDocument();
  });

  it('opens the exact username match on Enter, and nothing else', async () => {
    render(<GlobalSearch variant="inline" />);
    type('ali');
    await screen.findByText('@alice');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(push).not.toHaveBeenCalled();

    type('Alice');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await screen.findByText('@alice');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/users/alice');
  });

  // regression: the debounced fetch set the results from whichever response
  // landed, with no check that its term was still the one in the field. A slow
  // response for a cleared or replaced term refilled the dropdown, and the next
  // search showed those stale rows instead of "Searching…".
  it('regression: drops a response that arrives after the field was cleared', async () => {
    let respond!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (respond = resolve)));
    render(<GlobalSearch variant="inline" />);
    type('ali');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    respond({
      json: async () => ({
        success: true,
        data: { users: [{ username: 'alice', image: null }], wishlists: [] },
      }),
    });
    type('bob');
    // Still searching for "bob": the stale "ali" rows must not stand in for its results.
    expect(await screen.findByText('Searching…')).toBeInTheDocument();
    expect(screen.queryByText('@alice')).toBeNull();
  });

  it('empties the field with the clear button', async () => {
    render(<GlobalSearch variant="inline" />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    type('ali');
    await screen.findByText('@alice');

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(field()).toHaveValue('');
    expect(screen.queryByText('@alice')).toBeNull();
  });
});

describe('GlobalSearch — a handle typed as it’s shown, with its @', () => {
  it.each(['inline', 'header'] as const)(
    'sends it as typed and opens the exact match on Enter (%s)',
    async (variant) => {
      render(<GlobalSearch variant={variant} />);
      if (variant === 'header') fireEvent.click(screen.getByRole('button', { name: 'Search' }));
      type('@Alice');
      await screen.findByText('@alice');
      // As typed: the server drops the @ for people and keeps it for list names.
      expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=%40Alice');

      fireEvent.keyDown(field(), { key: 'Enter' });
      expect(push).toHaveBeenCalledWith('/users/alice');
    }
  );

  it('doesn’t open a partial match on Enter', async () => {
    render(<GlobalSearch variant="inline" />);
    type('@ali');
    await screen.findByText('@alice');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(push).not.toHaveBeenCalled();
  });
});

describe('GlobalSearch — header', () => {
  it('starts as an icon that expands into the field and folds back on close', async () => {
    render(<GlobalSearch />);
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    type('ali');
    expect(await screen.findByText('@alice')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });
});
