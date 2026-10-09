// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const { showToast, push } = vi.hoisted(() => ({ showToast: vi.fn(), push: vi.fn() }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { user: { id: 'me' } } }),
}));

import StartFromListModal from '@/components/StartFromListModal';
import { track } from '@/lib/analytics';

// What GET /api/wishlists/[id]/copy answers.
const SOURCE = {
  name: 'Birthday 2026',
  visibility: 'friends',
  occasion: { kind: 'birthday', date: '2000-03-14', recurrence: 'yearly' },
  archived: false,
  items: [
    { _id: 'i1', name: 'Blue mug', imageUrl: null, mostWanted: true, draft: false },
    { _id: 'i2', name: 'Socks', imageUrl: null, mostWanted: false, draft: true },
  ],
};
// What GET /api/wishlists/[id]/members answers: me, a co-owner, a member, one without a username.
const PEOPLE = [
  { user: { _id: 'me', username: 'me' }, role: 'owner' },
  { user: { _id: 'u-bob', username: 'bob' }, role: 'owner' },
  { user: { _id: 'u-carol', username: 'carol' }, role: 'member' },
  { user: { _id: 'u-anon', username: null }, role: 'member' },
];
const NEW_LIST = { _id: 'w-new', name: 'Birthday 2027', slug: 'birthday-2027' };

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };
let calls: Call[];
let source: unknown;
let people: unknown;
let inviteReply: (body: { username: string }) => { status: number; body: unknown };
let archiveFails = false;
let copyGateway = false;

beforeEach(() => {
  calls = [];
  archiveFails = false;
  copyGateway = false;
  source = SOURCE;
  people = PEOPLE;
  inviteReply = () => ({ status: 201, body: { success: true, data: {} } });
  showToast.mockReset();
  push.mockReset();
  vi.mocked(track).mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body, headers: (init.headers ?? {}) as Record<string, string> });
      const reply = (status: number, b: unknown) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url === '/api/wishlists/w-old/copy' && method === 'GET')
        return reply(200, { success: true, data: source });
      if (url === '/api/wishlists/w-old/copy' && method === 'POST') {
        // The platform's own error page, not the route's JSON.
        if (copyGateway) return new Response('<html>504</html>', { status: 504 });
        return reply(201, { success: true, data: NEW_LIST });
      }
      if (url === '/api/wishlists/w-old/members')
        return reply(200, { success: true, data: people });
      if (url === '/api/wishlists/w-new/members') {
        const r = inviteReply(body);
        return reply(r.status, r.body);
      }
      if (url === '/api/wishlists/w-old' && method === 'PATCH')
        return archiveFails
          ? reply(500, { success: false, error: 'Failed to update wishlist' })
          : reply(200, { success: true, data: {} });
      return reply(500, { success: false });
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const onClose = vi.fn();
function open() {
  onClose.mockReset();
  render(<StartFromListModal sourceId="w-old" isOpen onClose={onClose} />);
}

const posts = (url: string) => calls.filter((c) => c.url === url && c.method === 'POST');

describe('StartFromListModal', () => {
  it('prefills the old list’s settings and picks no item to start with', async () => {
    open();

    expect(await screen.findByLabelText('Wishlist name *')).toHaveValue('Birthday 2026');
    expect(screen.getByRole('radio', { name: /Friends/ })).toBeChecked();
    const boxes = within(screen.getByRole('group', { name: 'Items to bring over' })).getAllByRole(
      'checkbox'
    );
    expect(boxes).toHaveLength(2);
    for (const box of boxes) expect(box).not.toBeChecked();
    expect(screen.getByText('0 items picked')).toBeInTheDocument();
  });

  it('creates the list with the picked items and a key, then offers its people with their old roles', async () => {
    open();
    fireEvent.change(await screen.findByLabelText('Wishlist name *'), {
      target: { value: 'Birthday 2027' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Socks/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));

    await screen.findByRole('dialog', { name: 'Invite people again' });
    const [post] = posts('/api/wishlists/w-old/copy');
    expect(post.body).toEqual({
      name: 'Birthday 2027',
      visibility: 'friends',
      occasion: { kind: 'birthday', date: '2000-03-14', recurrence: 'yearly' },
      itemIds: ['i2'],
    });
    expect(post.headers['Idempotency-Key']).toMatch(/.{16,}/);

    // Everyone but me, and only people with a username, all ticked, as they were.
    const bob = await screen.findByRole('checkbox', { name: /@bob/ });
    const carol = screen.getByRole('checkbox', { name: /@carol/ });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(bob).toBeChecked();
    expect(carol).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Role for @bob' })).toHaveTextContent('Owner');
    expect(screen.getByRole('combobox', { name: 'Role for @carol' })).toHaveTextContent('Member');
    // WIS-329: one new list, counted with its visibility only.
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('list_created', { visibility: 'friends', source: 'copy' });
  });

  it('invites only those still ticked, each with their role, and shows who couldn’t be invited', async () => {
    inviteReply = ({ username }) =>
      username === 'carol'
        ? {
            status: 403,
            body: { success: false, error: 'This person isn’t accepting wishlist invites.' },
          }
        : { status: 201, body: { success: true, data: {} } };
    people = [...PEOPLE, { user: { _id: 'u-dan', username: 'dan' }, role: 'member' }];
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Create list' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /@dan/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Invite 2 people' }));

    expect(
      await screen.findByText('This person isn’t accepting wishlist invites.')
    ).toBeInTheDocument();
    expect(posts('/api/wishlists/w-new/members').map((c) => c.body)).toEqual([
      { username: 'bob', role: 'owner' },
      { username: 'carol', role: 'member' },
    ]);
    // Bob's row says he was invited; carol's can be tried again.
    const dialog = screen.getByRole('dialog', { name: 'Invite people again' });
    expect(within(dialog).getByText('Invited')).toBeInTheDocument();
    // WIS-329: only the invite that went out is counted, with its role.
    const invites = vi.mocked(track).mock.calls.filter(([event]) => event === 'invite_sent');
    expect(invites).toEqual([['invite_sent', { role: 'owner', to: 'person' }]]);
    expect(screen.getByRole('button', { name: 'Invite 1 person' })).toBeEnabled();

    // Moving on offers to archive the old list, which is only done when asked.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('dialog', { name: 'Archive “Birthday 2026”?' });
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(push).toHaveBeenCalledWith('/wishlists/birthday-2027');
  });

  it('archives the old list when asked, then goes to the new one', async () => {
    people = [PEOPLE[0]];
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Create list' }));
    // Nobody else was on it: straight to the archive question.
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday-2027'));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe('/api/wishlists/w-old');
    expect(patch.body).toEqual({ archived: true });
    expect(posts('/api/wishlists/w-new/members')).toHaveLength(0);
  });

  // regression (review): a failed archive still closed the dialog and left
  // for the new list, with no way to try again from there.
  it('stays on the archive question when archiving fails, so it can be tried again', async () => {
    people = [PEOPLE[0]];
    archiveFails = true;
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Create list' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Failed to update wishlist', 'error')
    );
    expect(push).not.toHaveBeenCalled();
    archiveFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday-2027'));
  });

  it('doesn’t offer to archive a list that already is', async () => {
    source = { ...SOURCE, archived: true };
    people = [PEOPLE[0]];
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Create list' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday-2027'));
    expect(screen.queryByRole('dialog', { name: /Archive/ })).not.toBeInTheDocument();
  });

  it('leaves a one-off occasion for the owner to pick', async () => {
    source = { ...SOURCE, occasion: null, items: [] };
    open();

    expect(await screen.findByText('No items to bring over.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
    await screen.findByRole('dialog', { name: 'Invite people again' });
    expect(posts('/api/wishlists/w-old/copy')[0].body).toMatchObject({
      occasion: null,
      itemIds: [],
    });
  });

  it('shows a failed read as an error with Try again, never as an empty list', async () => {
    source = undefined;
    vi.mocked(fetch).mockImplementationOnce(async () => new Response('oops', { status: 500 }));
    open();

    expect(await screen.findByText('Couldn’t load this wishlist')).toBeInTheDocument();
    expect(screen.queryByText('No items to bring over.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create list' })).toBeDisabled();
  });

  // regression (review): a 504 page from the platform isn't JSON; the dialog
  // must say to try again, with the same key, rather than fail on parsing.
  it('treats a gateway timeout as worth trying again, with the same key', async () => {
    copyGateway = true;
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Create list' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Couldn’t create the list. Try again.', 'error')
    );
    expect(track).not.toHaveBeenCalled();
    copyGateway = false;
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }));
    await screen.findByRole('dialog', { name: 'Invite people again' });
    const [first, second] = posts('/api/wishlists/w-old/copy');
    expect(second.headers['Idempotency-Key']).toBe(first.headers['Idempotency-Key']);
  });

  // regression (review): Pick all could pick more items than one copy takes.
  it('picks at most 100 items with Pick the first 100', async () => {
    source = {
      ...SOURCE,
      items: Array.from({ length: 101 }, (_, i) => ({
        _id: `i${i}`,
        name: `Item ${i}`,
        imageUrl: null,
        mostWanted: false,
        draft: false,
      })),
    };
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Pick the first 100' }));

    expect(screen.getByText('100 items picked, up to 100')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create list' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  // Should fix (review): the invite limit used to fill every remaining row with
  // the same refusal.
  it('stops at the invite limit and says how many weren’t sent', async () => {
    people = [
      ...PEOPLE,
      { user: { _id: 'u-dan', username: 'dan' }, role: 'member' },
      { user: { _id: 'u-eve', username: 'eve' }, role: 'member' },
    ];
    inviteReply = ({ username }) =>
      username === 'bob'
        ? { status: 201, body: { success: true, data: {} } }
        : { status: 429, body: { success: false, error: 'Too many requests. Please slow down.' } };
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Create list' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Invite 4 people' }));

    expect(await screen.findByText(/so 3 invitations weren’t sent/)).toBeInTheDocument();
    // It stopped at the first refusal: bob, then carol, and nobody after.
    expect(posts('/api/wishlists/w-new/members').map((c) => c.body)).toEqual([
      { username: 'bob', role: 'owner' },
      { username: 'carol', role: 'member' },
    ]);
    expect(screen.queryByText('Too many requests. Please slow down.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite 3 people' })).toBeEnabled();
  });

  it('archives through the page’s own archive when it’s given one', async () => {
    people = [PEOPLE[0]];
    const onArchiveSource = vi.fn().mockResolvedValue(true);
    render(
      <StartFromListModal
        sourceId="w-old"
        isOpen
        onClose={onClose}
        onArchiveSource={onArchiveSource}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Create list' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday-2027'));
    expect(onArchiveSource).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });
});
