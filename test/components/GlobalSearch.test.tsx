// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next-auth/react', () => ({
  useSession: () =>
    auth.userId
      ? { data: { user: { id: auth.userId } }, status: 'authenticated' }
      : { data: null, status: 'unauthenticated' },
}));

import GlobalSearch from '@/components/GlobalSearch';

const fetchMock = vi.fn();

const SEARCH_RESULTS = {
  users: [
    { username: 'alice', image: null, relation: null },
    { username: 'alicia', image: null, relation: 'friend' },
  ],
  wishlists: [
    {
      _id: 'w1',
      name: 'Alice birthday',
      slug: 'alice-birthday',
      ownerUsername: 'bob',
      relation: 'member',
    },
    { _id: 'w2', name: 'Alice old list', slug: null, ownerUsername: null, relation: null },
    { _id: 'w3', name: 'Alice mine', slug: 'alice-mine', ownerUsername: 'me', relation: 'owner' },
  ],
};

const FOLLOWING = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((username) => ({
  _id: `id-${username}`,
  username,
  image: null,
}));

const json = (body: unknown, ok = true) => ({ ok, json: async () => body });

beforeEach(() => {
  cleanup();
  push.mockReset();
  auth.userId = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    url.includes('/following')
      ? json({ success: true, data: FOLLOWING })
      : json({ success: true, data: SEARCH_RESULTS })
  );
  vi.stubGlobal('fetch', fetchMock);
});

const field = () => screen.getByRole('combobox', { name: 'Search people and wishlists' });
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const key = (k: string) => fireEvent.keyDown(field(), { key: k });
const activeName = () => {
  const id = field().getAttribute('aria-activedescendant');
  return id ? document.getElementById(`${id}-name`)?.textContent : null;
};
/** A row's name and its label, as "@alicia | Friend" (the avatar's initials left out). */
const rowText = (option: HTMLElement) =>
  Array.from(option.querySelectorAll('[id$="-name"], [id$="-meta"]'))
    .map((e) => e.textContent)
    .join(' | ');
const searchCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/search'));

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

    key('Escape');
    await waitFor(() => expect(screen.queryByText('@alice')).toBeNull());
    expect(field()).toHaveValue('ali');
    expect(field()).toHaveAttribute('aria-expanded', 'false');

    // The field kept focus, so it's a click (or ↓) that brings the results back.
    fireEvent.click(field());
    expect(await screen.findByText('@alice')).toBeInTheDocument();
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
    respond(json({ success: true, data: { users: [{ username: 'alice' }], wishlists: [] } }));
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

describe('GlobalSearch — results as a listbox', () => {
  it('groups people and wishlists as options, each with the searcher’s own relation', async () => {
    render(<GlobalSearch variant="inline" />);
    type('ali');
    const listbox = await screen.findByRole('listbox', { name: 'Search results' });
    expect(field()).toHaveAttribute('aria-controls', listbox.id);

    const people = within(listbox).getByRole('group', { name: 'People' });
    const lists = within(listbox).getByRole('group', { name: 'Wishlists' });
    expect(within(people).getAllByRole('option').map(rowText)).toEqual([
      '@alice',
      '@alicia | Friend',
    ]);
    expect(within(lists).getAllByRole('option').map(rowText)).toEqual([
      'Alice birthday | @bob · Member',
      'Alice old list',
      'Alice mine | Your list',
    ]);
    // Named by the name alone, and described by the label.
    expect(screen.getByRole('option', { name: '@alicia' })).toHaveAccessibleDescription('Friend');
    expect(screen.getByRole('option', { name: 'Alice mine' })).toHaveAccessibleDescription(
      'Your list'
    );
  });

  it('makes the first result active, moves with ↑ and ↓, and opens the active one on Enter', async () => {
    render(<GlobalSearch variant="inline" />);
    type('ali');
    await screen.findByText('@alice');
    await waitFor(() => expect(activeName()).toBe('@alice'));
    expect(screen.getByRole('option', { name: '@alice' })).toHaveAttribute('aria-selected', 'true');

    key('ArrowDown');
    expect(activeName()).toBe('@alicia');
    key('ArrowDown');
    expect(activeName()).toBe('Alice birthday');
    key('ArrowUp');
    expect(activeName()).toBe('@alicia');
    // It stops at the ends.
    key('ArrowUp');
    key('ArrowUp');
    expect(activeName()).toBe('@alice');
    for (let i = 0; i < 6; i++) key('ArrowDown');
    expect(activeName()).toBe('Alice mine');

    key('Enter');
    expect(push).toHaveBeenCalledWith('/wishlists/alice-mine');
  });

  it('opens the first result on Enter, the exact username match ranked first', async () => {
    render(<GlobalSearch variant="inline" />);
    type('ali');
    await screen.findByText('@alice');
    await waitFor(() => expect(activeName()).toBe('@alice'));
    key('Enter');
    expect(push).toHaveBeenCalledWith('/users/alice');
  });

  it('does nothing on Enter while a new term is still being searched', async () => {
    render(<GlobalSearch variant="inline" />);
    type('ali');
    await screen.findByText('@alice');
    type('alic');
    expect(field()).not.toHaveAttribute('aria-activedescendant');
    key('Enter');
    expect(push).not.toHaveBeenCalled();
  });

  it('closes the results on Escape and stops it at the field', async () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    render(<GlobalSearch variant="inline" />);
    type('ali');
    await screen.findByText('@alice');

    key('Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outer);

    // ↓ opens them again, on the first option.
    key('ArrowDown');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(activeName()).toBe('@alice');
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
      expect(searchCalls()[0][0]).toBe('/api/search?q=%40Alice');

      key('Enter');
      expect(push).toHaveBeenCalledWith('/users/alice');
    }
  );
});

describe('GlobalSearch — the open, empty search', () => {
  it('offers up to 5 of the people you follow, and the keys move through them', async () => {
    auth.userId = 'me';
    render(<GlobalSearch />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    const listbox = await screen.findByRole('listbox', { name: 'People you follow' });
    expect(fetchMock).toHaveBeenCalledWith('/api/users/me/following', { cache: 'no-store' });
    expect(within(listbox).getByRole('group', { name: 'People you follow' })).toBeInTheDocument();
    expect(within(listbox).getAllByRole('option').map(rowText)).toEqual([
      '@f1',
      '@f2',
      '@f3',
      '@f4',
      '@f5',
    ]);
    // Nothing is active until the keys move there, so Enter on an empty field opens no one.
    expect(field()).not.toHaveAttribute('aria-activedescendant');
    key('Enter');
    expect(push).not.toHaveBeenCalled();

    key('ArrowDown');
    key('ArrowDown');
    expect(activeName()).toBe('@f2');
    key('Enter');
    expect(push).toHaveBeenCalledWith('/users/f2');
  });

  it('gives way to the search once you type', async () => {
    auth.userId = 'me';
    render(<GlobalSearch variant="inline" />);
    fireEvent.focus(field());
    await screen.findByText('@f1');

    type('ali');
    await screen.findByText('@alice');
    expect(screen.queryByText('@f1')).toBeNull();
  });

  it('shows a hint, not an empty list, when you follow no one', async () => {
    auth.userId = 'me';
    fetchMock.mockResolvedValue(json({ success: true, data: [] }));
    render(<GlobalSearch variant="inline" />);
    fireEvent.focus(field());
    expect(
      await screen.findByText('Search for people by username, or for wishlists by name.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows nothing when the read fails, or signed out', async () => {
    auth.userId = 'me';
    fetchMock.mockResolvedValue(json({ success: false }, false));
    render(<GlobalSearch variant="inline" />);
    fireEvent.focus(field());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    cleanup();
    fetchMock.mockClear();
    auth.userId = null;
    render(<GlobalSearch variant="inline" />);
    fireEvent.focus(field());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('GlobalSearch — header', () => {
  it('starts as an icon that expands into the field and folds back on close', async () => {
    render(<GlobalSearch />);
    expect(screen.queryByRole('combobox')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    type('ali');
    expect(await screen.findByText('@alice')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  it('closes its results on the first Escape and folds back on the second', async () => {
    const onOpenChange = vi.fn();
    render(<GlobalSearch onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    type('ali');
    await screen.findByText('@alice');

    key('Escape');
    expect(screen.queryByText('@alice')).toBeNull();
    expect(field()).toHaveValue('ali');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    key('Escape');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
