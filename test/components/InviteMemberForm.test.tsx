// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import InviteMemberForm from '@/components/InviteMemberForm';

beforeEach(() => {
  cleanup();
  // The form fetches live username suggestions; keep it inert.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ json: async () => ({ success: true, data: { users: [] } }) })
  );
});

function openRoleMenu() {
  fireEvent.click(screen.getByRole('button', { name: /role/i }));
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
