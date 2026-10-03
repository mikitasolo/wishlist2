// @vitest-environment jsdom
// The note a list's page shows anyone who isn't on it: who can reserve, and
// how to get invited (your username and Copy signed in, Sign in signed out).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { signIn, showToast } = vi.hoisted(() => ({ signIn: vi.fn(), showToast: vi.fn() }));
vi.mock('next-auth/react', () => ({ signIn }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import JoinListCallout from '@/components/JoinListCallout';

const note = () => screen.getByRole('note');

beforeEach(() => {
  signIn.mockReset();
  showToast.mockReset();
});
afterEach(() => cleanup());

describe('JoinListCallout', () => {
  it('tells a signed-in non-member who can reserve, to ask, and their own username', () => {
    render(
      <JoinListCallout
        ownerUsernames={['anna_m']}
        ownerCount={1}
        viewer={{ username: 'ivan_petrov' }}
      />
    );
    expect(note()).toHaveTextContent(
      'Want to reserve a gift? Only people @anna_m invites can reserve items, so nobody buys the same thing twice. Ask them to invite you.'
    );
    expect(note()).toHaveTextContent('Your username is @ivan_petrov');
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('puts the viewer’s own username on the clipboard with Copy', async () => {
    const user = userEvent.setup();
    render(
      <JoinListCallout
        ownerUsernames={['anna_m']}
        ownerCount={1}
        viewer={{ username: 'ivan_petrov' }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Copy your username' }));
    await expect(navigator.clipboard.readText()).resolves.toBe('@ivan_petrov');
    expect(showToast).toHaveBeenCalledWith('Username copied to clipboard', 'success');
    // Its name says so too, not just its text.
    expect(screen.getByRole('button', { name: 'Copied your username' })).toHaveTextContent(
      'Copied'
    );
  });

  it('says so when the username can’t be copied', async () => {
    const user = userEvent.setup();
    render(
      <JoinListCallout
        ownerUsernames={['anna_m']}
        ownerCount={1}
        viewer={{ username: 'ivan_petrov' }}
      />
    );
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: /Copy your username/ }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Could not copy your username', 'error')
    );
    expect(screen.getByRole('button', { name: 'Copy your username' })).toHaveTextContent('Copy');
  });

  it('leaves the username out for a viewer who has none yet', () => {
    render(<JoinListCallout ownerUsernames={['anna_m']} ownerCount={1} viewer={{}} />);
    expect(note()).toHaveTextContent('Ask them to invite you.');
    expect(note()).not.toHaveTextContent('Your username');
    expect(screen.queryByRole('button', { name: /Copy/ })).toBeNull();
  });

  it('offers a signed-out visitor Sign in, back to this list', async () => {
    window.history.pushState({}, '', '/wishlists/anna-30?from=chat');
    const user = userEvent.setup();
    render(<JoinListCallout ownerUsernames={['anna_m']} ownerCount={1} viewer={null} />);

    expect(note()).toHaveTextContent(
      'Want to reserve a gift? Only people @anna_m invites can reserve items, so nobody buys the same thing twice.'
    );
    // Asking needs an account, so it isn't asked of them yet, and nobody's username shows.
    expect(note()).not.toHaveTextContent('Ask them');
    expect(note()).not.toHaveTextContent('Your username');

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith(undefined, {
      redirectTo: `${window.location.origin}/wishlists/anna-30?from=chat`,
    });
  });

  it('names both owners of a co-owned list', () => {
    render(
      <JoinListCallout
        ownerUsernames={['anna_m', 'chloe_r']}
        ownerCount={2}
        viewer={{ username: 'ivan_petrov' }}
      />
    );
    expect(note()).toHaveTextContent(
      'Only people @anna_m and @chloe_r invite can reserve items, so nobody buys the same thing twice.'
    );
  });

  it('says "the owners" when there are more than two', () => {
    render(<JoinListCallout ownerUsernames={['a', 'b', 'c']} ownerCount={3} viewer={null} />);
    expect(note()).toHaveTextContent('Only people the owners invite can reserve items');
    expect(note()).not.toHaveTextContent('@');
  });

  it('says "the owner" of a list whose only owner has no username', () => {
    render(<JoinListCallout ownerUsernames={[]} ownerCount={1} viewer={null} />);
    expect(note()).toHaveTextContent('Only people the owner invites can reserve items');
  });
});
