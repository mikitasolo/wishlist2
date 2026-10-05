// @vitest-environment jsdom
// The note a list's page shows anyone who isn't on it: who can reserve, and
// how to get invited (Ask to join signed in, Sign in signed out).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock('next-auth/react', () => ({ signIn }));

import JoinListCallout from '@/components/JoinListCallout';
import type { JoinRequestControl } from '@/lib/hooks/useJoinRequest';
import type { LinkJoinControl } from '@/lib/hooks/useLinkJoin';

const note = () => screen.getByRole('note');

beforeEach(() => {
  signIn.mockReset();
});
afterEach(() => cleanup());

describe('JoinListCallout', () => {
  const control = (over: Partial<JoinRequestControl> = {}): JoinRequestControl => ({
    state: 'none',
    busy: false,
    ask: vi.fn(),
    cancel: vi.fn(),
    ...over,
  });

  it('tells a signed-in non-member who can reserve, and offers Ask to join', async () => {
    const user = userEvent.setup();
    const request = control();
    render(
      <JoinListCallout ownerUsernames={['anna_m']} ownerCount={1} signedIn joinRequest={request} />
    );
    expect(note()).toHaveTextContent(
      'Want to reserve a gift? Only people @anna_m invites can reserve items, so nobody buys the same thing twice. Ask to join, and they can invite you.'
    );
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(request.ask).toHaveBeenCalledTimes(1);
  });

  it('reads Requested once asked, with Cancel request', async () => {
    const user = userEvent.setup();
    const request = control({ state: 'requested' });
    render(
      <JoinListCallout ownerUsernames={['anna_m']} ownerCount={1} signedIn joinRequest={request} />
    );
    expect(note()).toHaveTextContent('You’ve asked them to invite you.');
    expect(screen.getByRole('button', { name: 'Requested' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(request.cancel).toHaveBeenCalledTimes(1);
  });

  it('holds its buttons while an ask or a cancel is in flight', () => {
    render(
      <JoinListCallout
        ownerUsernames={['anna_m']}
        ownerCount={1}
        signedIn
        joinRequest={control({ busy: true })}
      />
    );
    expect(screen.getByRole('button', { name: 'Ask to join' })).toBeDisabled();
  });

  it('offers no button until it knows whether they’ve asked (a failed read included)', () => {
    render(
      <JoinListCallout
        ownerUsernames={['anna_m']}
        ownerCount={1}
        signedIn
        joinRequest={control({ state: 'unknown' })}
      />
    );
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Requested' })).toBeNull();
  });

  it('offers a signed-out visitor Sign in, back to this list', async () => {
    window.history.pushState({}, '', '/wishlists/anna-30?from=chat');
    const user = userEvent.setup();
    render(<JoinListCallout ownerUsernames={['anna_m']} ownerCount={1} signedIn={false} />);

    expect(note()).toHaveTextContent(
      'Want to reserve a gift? Only people @anna_m invites can reserve items, so nobody buys the same thing twice.'
    );
    // Asking needs an account, so it isn't asked of them yet, and nobody's username shows.
    expect(note()).not.toHaveTextContent('Ask to join');
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledWith(undefined, {
      redirectTo: `${window.location.origin}/wishlists/anna-30?from=chat`,
    });
  });

  it('names both owners of a co-owned list', () => {
    render(<JoinListCallout ownerUsernames={['anna_m', 'chloe_r']} ownerCount={2} signedIn />);
    expect(note()).toHaveTextContent(
      'Only people @anna_m and @chloe_r invite can reserve items, so nobody buys the same thing twice.'
    );
  });

  it('says "the owners" when there are more than two', () => {
    render(<JoinListCallout ownerUsernames={['a', 'b', 'c']} ownerCount={3} signedIn={false} />);
    expect(note()).toHaveTextContent('Only people the owners invite can reserve items');
    expect(note()).not.toHaveTextContent('@');
  });

  it('says "the owner" of a list whose only owner has no username', () => {
    render(<JoinListCallout ownerUsernames={[]} ownerCount={1} signedIn={false} />);
    expect(note()).toHaveTextContent('Only people the owner invites can reserve items');
  });
});

describe('JoinListCallout on a Join link (WIS-337)', () => {
  const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
  const linkJoin = (over: Partial<LinkJoinControl> = {}): LinkJoinControl => ({
    busy: false,
    join: vi.fn().mockResolvedValue(undefined),
    ...over,
  });
  const shareLink = (control: LinkJoinControl, confirmOnArrival = false) => ({
    token: TOKEN,
    highlightAsk: false,
    join: { control, confirmOnArrival },
  });

  it('says to join, and opens the confirmation instead of joining', async () => {
    const user = userEvent.setup();
    const control = linkJoin();
    render(
      <JoinListCallout
        ownerUsernames={['masha']}
        ownerCount={1}
        signedIn
        shareLink={shareLink(control)}
      />
    );
    expect(note()).toHaveTextContent(
      'Want to reserve a gift? Join the list so nobody buys the same thing twice.'
    );
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Join this list' }));
    expect(control.join).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'Join @masha’s list?' })).toHaveTextContent(
      'You’ll be able to reserve gifts. @masha won’t see what you reserve.'
    );
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(control.join).toHaveBeenCalledTimes(1);
  });

  it('holds the dialog pending while the join is in flight', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const control = linkJoin({
      join: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    });
    render(
      <JoinListCallout
        ownerUsernames={['masha']}
        ownerCount={1}
        signedIn
        shareLink={shareLink(control)}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Join this list' }));
    await user.click(screen.getByRole('button', { name: 'Join' }));
    expect(screen.getByRole('button', { name: 'Joining…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(control.join).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('holds Join this list while a join is busy', () => {
    render(
      <JoinListCallout
        ownerUsernames={['masha']}
        ownerCount={1}
        signedIn
        shareLink={shareLink(linkJoin({ busy: true }))}
      />
    );
    expect(screen.getByRole('button', { name: 'Join this list' })).toBeDisabled();
  });

  it('opens the confirmation at once when back from signing in, never joining by itself', () => {
    const control = linkJoin();
    render(
      <JoinListCallout
        ownerUsernames={['masha', 'ivan']}
        ownerCount={2}
        signedIn
        shareLink={shareLink(control, true)}
      />
    );
    expect(screen.getByRole('alertdialog', { name: 'Join this list?' })).toHaveTextContent(
      '@masha and @ivan won’t see what you reserve.'
    );
    expect(control.join).not.toHaveBeenCalled();
  });

  it('signed out: Sign in to join, back to the link with then=join, and no dialog', async () => {
    const user = userEvent.setup();
    render(
      <JoinListCallout
        ownerUsernames={[]}
        ownerCount={3}
        signedIn={false}
        shareLink={shareLink(linkJoin(), true)}
      />
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Sign in to join' }));
    expect(signIn).toHaveBeenCalledWith(undefined, { redirectTo: `/l/${TOKEN}?then=join` });
  });
});
