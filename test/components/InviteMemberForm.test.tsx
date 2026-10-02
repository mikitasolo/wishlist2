// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

import InviteMemberForm, { type InviteMemberFormHandle } from '@/components/InviteMemberForm';

beforeEach(() => {
  cleanup();
  // The form fetches live username suggestions; keep it inert.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ json: async () => ({ success: true, data: { users: [] } }) })
  );
});

function openRoleMenu() {
  fireEvent.click(screen.getByRole('combobox', { name: /role/i }));
}

describe('InviteMemberForm — roles', () => {
  // A wishlist has exactly two relationships; there is no admin tier.
  it('offers only Member and Owner', () => {
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);
    openRoleMenu();
    expect(screen.getByRole('option', { name: 'Member' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Owner' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Admin' })).toBeNull();
  });

  it('warns what co-ownership costs before the invite is sent', async () => {
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);
    expect(screen.queryByText(/released when they accept/i)).toBeNull();

    openRoleMenu();
    fireEvent.click(screen.getByRole('option', { name: 'Owner' }));

    await waitFor(() => expect(screen.getByText(/released when they accept/i)).toBeInTheDocument());
    expect(screen.getByText(/appears on their profile as their own/i)).toBeInTheDocument();
  });

  it('submits the selected owner role', async () => {
    const onInvite = vi.fn().mockResolvedValue(undefined);
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    fireEvent.change(screen.getByPlaceholderText(/search by username/i), {
      target: { value: '@Bob' },
    });
    openRoleMenu();
    fireEvent.click(screen.getByRole('option', { name: 'Owner' }));
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith({ username: 'bob', role: 'owner' }));
  });

  it('defaults to member', async () => {
    const onInvite = vi.fn().mockResolvedValue(undefined);
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    fireEvent.change(screen.getByPlaceholderText(/search by username/i), {
      target: { value: 'bob' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith({ username: 'bob', role: 'member' }));
  });
});

describe('InviteMemberForm — username suggestions', () => {
  function stubSearch(users: { username: string; image: string | null }[]) {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ json: async () => ({ success: true, data: { users, wishlists: [] } }) });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const type = (value: string) =>
    fireEvent.change(screen.getByPlaceholderText(/search by username/i), { target: { value } });

  // It only shows people, so it asks the search for its people section only.
  it('asks the search for people only, without the @', async () => {
    const fetchMock = stubSearch([{ username: 'alice', image: null }]);
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);

    type('@alice');
    expect(await screen.findByRole('button', { name: '@alice' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=alice&sections=users');
  });

  it('keeps everything typed inside q, encoded', async () => {
    const fetchMock = stubSearch([]);
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);

    type('al&sections=all');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=al%26sections%3Dall&sections=users');
    expect(await screen.findByText(/No people match/)).toBeInTheDocument();
  });
});

describe('InviteMemberForm — startOwnerInvite', () => {
  // jsdom has no scrollIntoView: stand one in, to see what the form scrolls to.
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  function renderWithHandle(onInvite = vi.fn().mockResolvedValue(undefined)) {
    const handle = createRef<InviteMemberFormHandle>();
    render(<InviteMemberForm ref={handle} onInvite={onInvite} isInviting={false} />);
    return { handle, onInvite };
  }

  it('picks the Owner role, shows its warning, and puts the cursor in the username field', () => {
    const { handle } = renderWithHandle();
    const field = screen.getByPlaceholderText(/search by username/i);
    expect(field).not.toHaveFocus();

    act(() => handle.current!.startOwnerInvite());

    expect(screen.getByRole('button', { name: 'Role' })).toHaveTextContent('Owner');
    expect(screen.getByText(/released when they accept/i)).toBeInTheDocument();
    expect(field).toHaveFocus();
    // The whole form, from its heading, not just the field.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const scrolled = scrollIntoView.mock.contexts[0] as HTMLElement;
    expect(scrolled).toContainElement(screen.getByRole('heading', { name: 'Invite someone' }));
    expect(scrolled).toContainElement(field);
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: 'start' });
  });

  it('sends an owner invite for the username typed next', async () => {
    const { handle, onInvite } = renderWithHandle();
    act(() => handle.current!.startOwnerInvite());

    fireEvent.change(screen.getByPlaceholderText(/search by username/i), {
      target: { value: 'bob' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith({ username: 'bob', role: 'owner' }));
  });
});
