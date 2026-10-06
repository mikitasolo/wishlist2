// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// WIS-27: Settings → Groups and a profile's Tag into groups.

const showToast = vi.fn();
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/lib/hooks/useKnownSession', () => ({
  useKnownSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }),
}));

import GroupsSettings from '@/components/GroupsSettings';
import TagIntoGroups from '@/components/TagIntoGroups';

const fetchMock = vi.fn();

const bo = { id: 'bo1', username: 'bo', displayName: 'bo', image: null };
const cy = { id: 'cy1', username: 'cy', displayName: 'cy', image: null };

function answer(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

type Route = (url: string, init?: RequestInit) => Promise<Response> | undefined;

/** Answers each request with the first route that takes it; anything else fails the test. */
function serve(...routes: Route[]) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    for (const route of routes) {
      const res = route(url, init);
      if (res) return res;
    }
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`);
  });
}

const groupsRead =
  (groups: unknown[], status = 200): Route =>
  (url, init) =>
    url === '/api/users/me/groups' && !init?.method
      ? answer(status, status === 200 ? { success: true, data: groups } : { success: false })
      : undefined;

function calls(method: string, url: string) {
  return fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === method);
}

beforeEach(() => {
  fetchMock.mockReset();
  showToast.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('Settings → Groups', () => {
  it('says a failed read failed, never that there are no groups', async () => {
    serve(groupsRead([], 500));
    render(<GroupsSettings />);
    expect(await screen.findByText('Couldn’t load your groups')).toBeInTheDocument();
    expect(screen.queryByText('No groups yet')).toBeNull();
  });

  it('makes a group and shows it', async () => {
    serve(groupsRead([]), (url, init) =>
      url === '/api/users/me/groups' && init?.method === 'POST'
        ? answer(201, { success: true, data: { id: 'g1', name: 'Family', members: [] } })
        : undefined
    );
    const user = userEvent.setup();
    render(<GroupsSettings />);
    expect(await screen.findByText('No groups yet')).toBeInTheDocument();
    await user.type(screen.getByLabelText('New group'), 'Family');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('heading', { name: 'Family' })).toBeInTheDocument();
    expect(JSON.parse(calls('POST', '/api/users/me/groups')[0][1].body)).toEqual({
      name: 'Family',
    });
    expect(screen.getByLabelText('New group')).toHaveValue('');
  });

  it('shows why a name was refused, under the field', async () => {
    serve(groupsRead([{ id: 'g1', name: 'Family', members: [] }]), (url, init) =>
      url === '/api/users/me/groups' && init?.method === 'POST'
        ? answer(409, { success: false, error: 'You already have a group with that name.' })
        : undefined
    );
    const user = userEvent.setup();
    render(<GroupsSettings />);
    await user.type(await screen.findByLabelText('New group'), 'family');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('You already have a group with that name.')).toBeVisible();
  });

  it('holds New group at the limit', async () => {
    const groups = Array.from({ length: 20 }, (_, i) => ({
      id: `g${i}`,
      name: `G${i}`,
      members: [],
    }));
    serve(groupsRead(groups));
    render(<GroupsSettings />);
    expect(await screen.findByLabelText('New group')).toBeDisabled();
    expect(screen.getByText('You have 20 groups, the most you can have.')).toBeVisible();
  });

  it('takes someone out at once, and puts them back if that fails', async () => {
    let fail = true;
    serve(groupsRead([{ id: 'g1', name: 'Family', members: [bo, cy] }]), (url, init) =>
      url === '/api/users/me/groups/g1/members/bo1' && init?.method === 'DELETE'
        ? answer(fail ? 500 : 200, { success: !fail })
        : undefined
    );
    const user = userEvent.setup();
    render(<GroupsSettings />);
    await user.click(await screen.findByRole('button', { name: 'Remove @bo from Family' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Couldn’t save. Try again.', 'error')
    );
    expect(screen.getByRole('link', { name: '@bo' })).toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Remove @bo from Family' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: '@bo' })).toBeNull());
    expect(screen.getByText('1 person')).toBeInTheDocument();
  });

  it('deletes a group after asking, saying nothing else changes', async () => {
    serve(groupsRead([{ id: 'g1', name: 'Family', members: [bo] }]), (url, init) =>
      url === '/api/users/me/groups/g1' && init?.method === 'DELETE'
        ? answer(200, { success: true })
        : undefined
    );
    const user = userEvent.setup();
    render(<GroupsSettings />);
    await user.click(await screen.findByRole('button', { name: 'Actions for Family' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete group' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(
        'Only the group goes. Nobody is told, and no list or invite changes.'
      )
    ).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Delete group' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Family' })).toBeNull());
    expect(await screen.findByText('No groups yet')).toBeInTheDocument();
  });

  it('adds people you follow from Add people', async () => {
    serve(
      groupsRead([{ id: 'g1', name: 'Family', members: [bo] }]),
      (url) =>
        url === '/api/users/me/following'
          ? answer(200, {
              success: true,
              data: [
                { _id: 'bo1', username: 'bo', image: null },
                { _id: 'cy1', username: 'cy', image: null },
              ],
            })
          : undefined,
      (url, init) =>
        url === '/api/users/me/groups/g1/members' && init?.method === 'POST'
          ? answer(200, { success: true })
          : undefined
    );
    const user = userEvent.setup();
    render(<GroupsSettings />);
    await user.click(await screen.findByRole('button', { name: 'Add people to Family' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('checkbox', { name: '@bo' })).toBeChecked();
    await user.click(within(dialog).getByRole('checkbox', { name: '@cy' }));
    expect(within(dialog).getByRole('checkbox', { name: '@cy' })).toBeChecked();
    expect(JSON.parse(calls('POST', '/api/users/me/groups/g1/members')[0][1].body)).toEqual({
      userId: 'cy1',
    });
  });
});

describe('Tag into groups', () => {
  it('ticks the groups they are in, and tags them in as a box is ticked', async () => {
    serve(
      groupsRead([
        { id: 'g1', name: 'Family', members: [bo] },
        { id: 'g2', name: 'Close friends', members: [] },
      ]),
      (url, init) =>
        url === '/api/users/me/groups/g2/members' && init?.method === 'POST'
          ? answer(200, { success: true })
          : undefined
    );
    const user = userEvent.setup();
    render(<TagIntoGroups person={bo} />);
    // Nothing is read until it's opened.
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Tag @bo into groups' }));
    expect(await screen.findByRole('checkbox', { name: 'Family' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Close friends' }));
    expect(screen.getByRole('checkbox', { name: 'Close friends' })).toBeChecked();
    expect(JSON.parse(calls('POST', '/api/users/me/groups/g2/members')[0][1].body)).toEqual({
      userId: 'bo1',
    });
  });

  it('unticks the box again when tagging fails', async () => {
    serve(groupsRead([{ id: 'g1', name: 'Family', members: [] }]), (url, init) =>
      url === '/api/users/me/groups/g1/members' && init?.method === 'POST'
        ? answer(400, { success: false, error: 'You can only add people you follow.' })
        : undefined
    );
    const user = userEvent.setup();
    render(<TagIntoGroups person={bo} />);
    await user.click(screen.getByRole('button', { name: 'Tag @bo into groups' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Family' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('You can only add people you follow.', 'error')
    );
    expect(screen.getByRole('checkbox', { name: 'Family' })).not.toBeChecked();
  });

  it('makes a new group with them in it', async () => {
    serve(
      groupsRead([]),
      (url, init) =>
        url === '/api/users/me/groups' && init?.method === 'POST'
          ? answer(201, { success: true, data: { id: 'g9', name: 'Parents', members: [] } })
          : undefined,
      (url, init) =>
        url === '/api/users/me/groups/g9/members' && init?.method === 'POST'
          ? answer(200, { success: true })
          : undefined
    );
    const user = userEvent.setup();
    render(<TagIntoGroups person={bo} />);
    await user.click(screen.getByRole('button', { name: 'Tag @bo into groups' }));
    expect(await screen.findByText('You have no groups yet. Make one for @bo:')).toBeVisible();
    await user.type(screen.getByLabelText('New group'), 'Parents');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('checkbox', { name: 'Parents' })).toBeChecked();
    expect(calls('POST', '/api/users/me/groups/g9/members')).toHaveLength(1);
  });
});
