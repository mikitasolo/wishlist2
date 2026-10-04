// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import InviteMemberForm, { type InviteMemberFormHandle } from '@/components/InviteMemberForm';
import { listStatusByUsername } from '@/lib/utils/inviteSuggestions';

type User = { username: string; image: string | null };

const ok = (users: User[]) => ({
  json: async () => ({ success: true, data: { users, wishlists: [] } }),
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cleanup();
  // The form fetches live username suggestions; keep it inert.
  fetchMock = vi.fn().mockResolvedValue(ok([]));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSearch(users: User[]) {
  fetchMock.mockResolvedValue(ok(users));
}

const field = () => screen.getByRole('combobox', { name: 'Search by username' });
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const people = (...names: string[]) => names.map((username) => ({ username, image: null }));

describe('InviteMemberForm — role', () => {
  // A wishlist has exactly two relationships; there is no admin tier.
  it('offers only Member and Co-owner, as a switch', () => {
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);
    const group = screen.getByRole('radiogroup', { name: 'Role' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent)
    ).toEqual(['Member', 'Co-owner']);
    expect(screen.getByRole('radio', { name: 'Member' })).toBeChecked();
  });

  it('says in one line what the picked role can do', async () => {
    const user = userEvent.setup();
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);
    const group = screen.getByRole('radiogroup', { name: 'Role' });
    expect(group).toHaveAccessibleDescription('Can reserve gifts and propose items.');

    await user.click(screen.getByRole('radio', { name: 'Co-owner' }));

    expect(group).toHaveAccessibleDescription('Can edit everything, and never sees reservations.');
    // The old four-line warning is gone.
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('sends the same role values as before: owner for Co-owner', async () => {
    const onInvite = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    type('@Bob');
    await user.click(screen.getByRole('radio', { name: 'Co-owner' }));
    await user.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith({ username: 'bob', role: 'owner' }));
    // And back to Member for the next one.
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Member' })).toBeChecked());
  });

  it('picks the role with the arrow keys too', async () => {
    const onInvite = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    type('bob');
    screen.getByRole('radio', { name: 'Member' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Co-owner' })).toBeChecked();
    await user.keyboard('{ArrowLeft}');
    await user.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith({ username: 'bob', role: 'member' }));
  });

  it('defaults to member', async () => {
    const onInvite = vi.fn().mockResolvedValue(true);
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    type('bob');
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith({ username: 'bob', role: 'member' }));
  });
});

describe('InviteMemberForm — username suggestions', () => {
  // It only shows people, so it asks the search for its people section only.
  it('asks the search for people only, without the @', async () => {
    stubSearch(people('alice'));
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);

    type('@alice');
    expect(await screen.findByRole('option', { name: '@alice' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=alice&sections=users');
  });

  it('keeps everything typed inside q, encoded', async () => {
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);

    type('al&sections=all');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/search?q=al%26sections%3Dall&sections=users');
    expect(await screen.findByText(/No people match/)).toBeInTheDocument();
  });

  it('says three letters are needed under three, and searches nothing', async () => {
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);

    for (const value of ['a', '@ab']) {
      type(value);
      expect(screen.getByText('Type at least 3 letters of their username')).toBeInTheDocument();
    }
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(field()).toHaveAttribute('aria-expanded', 'false');

    // Nothing at all for an empty field.
    type('');
    expect(screen.queryByText('Type at least 3 letters of their username')).toBeNull();
  });

  it('moves through the suggestions with the arrow keys and picks one with Enter', async () => {
    stubSearch(people('alice', 'alina', 'alfred'));
    const onInvite = vi.fn();
    const user = userEvent.setup();
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    await user.click(field());
    await user.keyboard('ali');
    await screen.findByRole('option', { name: '@alfred' });
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(field()).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}');
    const active = () =>
      document.getElementById(field().getAttribute('aria-activedescendant') ?? '');
    expect(active()).toHaveAccessibleName('@alice');
    expect(active()).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    // It stops at the last.
    expect(active()).toHaveAccessibleName('@alfred');
    await user.keyboard('{ArrowUp}');
    expect(active()).toHaveAccessibleName('@alina');

    await user.keyboard('{Enter}');

    expect(field()).toHaveValue('alina');
    expect(field()).toHaveFocus();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    // Picking fills the field; it doesn't send the invite.
    expect(onInvite).not.toHaveBeenCalled();
  });

  it('closes the list on Escape without the key reaching a dialog around it, and reopens on ↓', async () => {
    stubSearch(people('alice'));
    const onDocumentEscape = vi.fn();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDocumentEscape();
    };
    document.addEventListener('keydown', listener);
    const user = userEvent.setup();
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);

    await user.click(field());
    await user.keyboard('ali');
    await screen.findByRole('option', { name: '@alice' });

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(field()).toHaveValue('ali');
    expect(onDocumentEscape).not.toHaveBeenCalled();
    document.removeEventListener('keydown', listener);

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: '@alice' })).toHaveAttribute('aria-selected', 'true');
  });

  it('sends the invite as typed on Enter with no suggestion active', async () => {
    stubSearch(people('alice'));
    const onInvite = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    await user.click(field());
    await user.keyboard('alice');
    await screen.findByRole('option', { name: '@alice' });
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(onInvite).toHaveBeenCalledWith({ username: 'alice', role: 'member' })
    );
  });

  it('forgets the active suggestion once the list closes, so Enter then sends what was typed', async () => {
    stubSearch(people('alice'));
    const onInvite = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(
      <>
        <InviteMemberForm onInvite={onInvite} isInviting={false} />
        <button type="button">elsewhere</button>
      </>
    );

    await user.click(field());
    await user.keyboard('ali');
    await screen.findByRole('option', { name: '@alice' });
    await user.keyboard('{ArrowDown}');
    expect(field()).toHaveAttribute('aria-activedescendant');

    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    await user.click(field());
    expect(await screen.findByRole('option', { name: '@alice' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(field()).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith({ username: 'ali', role: 'member' }));
  });

  it('sends the username the way the search reads it', async () => {
    const onInvite = vi.fn().mockResolvedValue(true);
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    type(' @ Bob ');
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith({ username: 'bob', role: 'member' }));
  });

  it('fills the field with a clicked suggestion', async () => {
    stubSearch(people('alice'));
    const user = userEvent.setup();
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);

    await user.click(field());
    await user.keyboard('ali');
    await user.click(await screen.findByRole('option', { name: '@alice' }));

    expect(field()).toHaveValue('alice');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('InviteMemberForm — who is on the list already', () => {
  const statuses = listStatusByUsername({
    owners: ['olga'],
    members: [{ userId: 'u-mia', username: 'Mia' }],
    invited: ['ivy'],
  });

  function renderWithStatuses(onPromote?: (m: { userId: string; username: string }) => void) {
    stubSearch(people('olga', 'mia', 'ivy', 'nora'));
    render(
      <InviteMemberForm
        onInvite={vi.fn()}
        isInviting={false}
        statuses={statuses}
        onPromote={onPromote}
      />
    );
  }

  it('shows each one as Owner, Member or Invited, and they cannot be picked', async () => {
    const user = userEvent.setup();
    renderWithStatuses(vi.fn());

    await user.click(field());
    await user.keyboard('xyz');
    await screen.findByRole('option', { name: '@nora' });

    const owner = screen.getByRole('option', { name: '@olga' });
    const member = screen.getByRole('option', { name: '@mia' });
    const invited = screen.getByRole('option', { name: '@ivy' });
    expect(owner).toHaveAccessibleDescription('Owner');
    expect(member).toHaveAccessibleDescription('Member');
    expect(invited).toHaveAccessibleDescription('Invited');
    for (const row of [owner, member, invited]) {
      expect(row).toHaveAttribute('aria-disabled', 'true');
    }
    const nora = screen.getByRole('option', { name: '@nora' });
    expect(nora).not.toHaveAttribute('aria-disabled');
    expect(nora).toHaveAccessibleDescription('');

    // A click does nothing.
    await user.click(owner);
    expect(field()).toHaveValue('xyz');

    // Nor does Enter on one that's active (the pointer made Olga's so).
    expect(field()).toHaveAttribute('aria-activedescendant', owner.id);
    await user.keyboard('{Enter}');
    expect(field()).toHaveValue('xyz');
    await user.keyboard('{ArrowDown}');
    expect(field()).toHaveAttribute('aria-activedescendant', member.id);
    await user.keyboard('{Enter}');
    expect(field()).toHaveValue('xyz');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it("offers to make a member a co-owner instead, through the page's promotion", async () => {
    const onPromote = vi.fn();
    const user = userEvent.setup();
    renderWithStatuses(onPromote);

    await user.click(field());
    await user.keyboard('xyz');
    const promote = await screen.findByRole('option', {
      name: 'Make co-owner instead, @mia',
    });
    // Only on the member's row.
    expect(screen.getAllByRole('option', { name: /Make co-owner instead/ })).toHaveLength(1);

    await user.click(promote);

    expect(onPromote).toHaveBeenCalledTimes(1);
    expect(onPromote).toHaveBeenCalledWith({ userId: 'u-mia', username: 'mia' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('reaches Make co-owner instead from the keyboard', async () => {
    const onPromote = vi.fn();
    const user = userEvent.setup();
    renderWithStatuses(onPromote);

    await user.click(field());
    await user.keyboard('xyz');
    await screen.findByRole('option', { name: '@nora' });
    // Olga, Mia, Mia's promotion.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');

    expect(onPromote).toHaveBeenCalledWith({ userId: 'u-mia', username: 'mia' });
  });

  it('offers no promotion when the page gives it none', async () => {
    const user = userEvent.setup();
    renderWithStatuses(undefined);

    await user.click(field());
    await user.keyboard('xyz');
    await screen.findByRole('option', { name: '@mia' });
    expect(screen.queryByRole('option', { name: /Make co-owner instead/ })).toBeNull();
  });
});

describe('InviteMemberForm — a stale or failed search (WIS-186)', () => {
  function deferred() {
    let resolve!: (v: unknown) => void;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  }

  // regression (WIS-186): the effect's cleanup only cleared the debounce timer,
  // so a slower answer for an earlier term landed over the current one's.
  it("shows only the current term's people when two answers land out of order", async () => {
    const answers = new Map<string, ReturnType<typeof deferred>>();
    fetchMock.mockImplementation((url: string) => {
      const q = new URL(url, 'http://x').searchParams.get('q')!;
      const d = deferred();
      answers.set(q, d);
      return d.promise;
    });
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);

    type('alic');
    await waitFor(() => expect(answers.has('alic')).toBe(true));
    type('alice');
    await waitFor(() => expect(answers.has('alice')).toBe(true));

    // The newer answers first, the older one after it.
    await act(async () => answers.get('alice')!.resolve(ok(people('alice'))));
    expect(await screen.findByRole('option', { name: '@alice' })).toBeInTheDocument();
    await act(async () => answers.get('alic')!.resolve(ok(people('alicia', 'malick'))));

    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: '@alice' })).toBeInTheDocument();
    expect(screen.queryByText('Searching…')).toBeNull();
  });

  // regression (WIS-186): a sent invite clears the field, and a late answer for
  // what it held used to fill the suggestions again.
  it('drops an answer that lands after the field was cleared', async () => {
    const d = deferred();
    fetchMock.mockImplementation(() => d.promise);
    const onInvite = vi.fn().mockResolvedValue(true);
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    type('alice');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));
    await waitFor(() => expect(field()).toHaveValue(''));
    await act(async () => d.resolve(ok(people('alice'))));

    fetchMock.mockImplementation(() => new Promise(() => {}));
    type('bob');
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByText('Searching…')).toBeInTheDocument();
  });

  // regression (WIS-186): a 429 or 500 (success: false) or a network error
  // read as nobody matching, so the owner thought the person had no account.
  it.each([
    [
      'an answer with success: false',
      () => Promise.resolve({ json: async () => ({ success: false, error: 'Too many requests' }) }),
    ],
    ['a rejected fetch', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('says the search failed, not that nobody matches, after %s', async (_label, answer) => {
    const onInvite = vi.fn().mockResolvedValue(true);
    fetchMock.mockImplementation(answer);
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    type('bobby');
    expect(
      await screen.findByText(
        'Suggestions aren’t available right now. You can still invite them by username.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/No people match/)).toBeNull();
    expect(screen.queryByText('Searching…')).toBeNull();

    // The field still works.
    expect(field()).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));
    await waitFor(() =>
      expect(onInvite).toHaveBeenCalledWith({ username: 'bobby', role: 'member' })
    );
  });

  it('says nobody matches only once that term has been searched', async () => {
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);
    type('abc');
    await screen.findByText('No people match “abc”.');

    fetchMock.mockImplementation(() => new Promise(() => {}));
    type('abcd');
    expect(screen.queryByText(/No people match/)).toBeNull();
    expect(screen.getByText('Searching…')).toBeInTheDocument();
  });

  it("doesn't keep an earlier term's people after a failed search", async () => {
    fetchMock.mockResolvedValueOnce(ok(people('bobby')));
    render(<InviteMemberForm onInvite={vi.fn()} isInviting={false} />);
    type('bob');
    await screen.findByRole('option', { name: '@bobby' });

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    type('bobb');
    await screen.findByText(/Suggestions aren’t available/);
    expect(screen.queryByRole('option')).toBeNull();
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

  function renderWithHandle(onInvite = vi.fn().mockResolvedValue(true)) {
    const handle = createRef<InviteMemberFormHandle>();
    render(<InviteMemberForm ref={handle} onInvite={onInvite} isInviting={false} />);
    return { handle, onInvite };
  }

  it('picks Co-owner, says what it means, and puts the cursor in the username field', () => {
    const { handle } = renderWithHandle();
    expect(field()).not.toHaveFocus();

    act(() => handle.current!.startOwnerInvite());

    expect(screen.getByRole('radio', { name: 'Co-owner' })).toBeChecked();
    expect(
      screen.getByText('Can edit everything, and never sees reservations.')
    ).toBeInTheDocument();
    expect(field()).toHaveFocus();
    // The whole form, from its heading, not just the field.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const scrolled = scrollIntoView.mock.contexts[0] as HTMLElement;
    expect(scrolled).toContainElement(screen.getByRole('heading', { name: 'Invite someone' }));
    expect(scrolled).toContainElement(field());
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: 'start' });
  });

  it('sends an owner invite for the username typed next', async () => {
    const { handle, onInvite } = renderWithHandle();
    act(() => handle.current!.startOwnerInvite());

    type('bob');
    fireEvent.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => expect(onInvite).toHaveBeenCalledWith({ username: 'bob', role: 'owner' }));
  });
});

describe('InviteMemberForm — refused invites and emails (WIS-307)', () => {
  it('keeps the text and the role, and focus, when the invite is refused', async () => {
    // regression: submit cleared the field whatever onInvite's outcome, so a
    // refused invite (the page only toasts) made the person retype it.
    const onInvite = vi.fn().mockResolvedValue(false);
    const user = userEvent.setup();
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    type('@Bobby');
    await user.click(screen.getByRole('radio', { name: 'Co-owner' }));
    await user.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => expect(onInvite).toHaveBeenCalledTimes(1));
    expect(field()).toHaveValue('@Bobby');
    expect(screen.getByRole('radio', { name: 'Co-owner' })).toBeChecked();
    await waitFor(() => expect(field()).toHaveFocus());
  });

  it('clears the form once the invite is sent', async () => {
    const onInvite = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    type('bobby');
    await user.click(screen.getByRole('radio', { name: 'Co-owner' }));
    await user.click(screen.getByRole('button', { name: /^invite$/i }));

    await waitFor(() => expect(field()).toHaveValue(''));
    expect(screen.getByRole('radio', { name: 'Member' })).toBeChecked();
  });

  it('hints at usernames for an email, keeps it as typed, and sends and searches nothing', async () => {
    const onInvite = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<InviteMemberForm onInvite={onInvite} isInviting={false} />);

    type('ann+x@example.com');
    expect(
      screen.getByText('Invite people by their username. Ask them for their @handle.')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^invite$/i }));
    await new Promise((r) => setTimeout(r, 300));

    expect(onInvite).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(field()).toHaveValue('ann+x@example.com');

    type('ann');
    expect(screen.queryByText(/Ask them for their @handle/)).toBeNull();
  });
});
