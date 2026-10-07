// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import InviteMemberForm from '@/components/InviteMemberForm';
import type { GroupView } from '@/lib/utils/groupRules';
import type { GroupInviteResult } from '@/lib/utils/groupInviteResult';

// WIS-37: the People tab's invite form can invite one of your groups.

const person = (id: string, username: string = id) => ({
  id,
  username,
  displayName: username,
  image: null,
});
const groups: GroupView[] = [
  { id: 'g1', name: 'Family', members: [person('bo'), person('cy'), person('di')] },
  { id: 'g2', name: 'Parents', members: [person('mum')] },
];

beforeEach(() => {
  cleanup();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ success: true }) }));
});
afterEach(() => vi.unstubAllGlobals());

async function pickGroup(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole('radio', { name: 'Group' }));
  await user.click(screen.getByRole('combobox', { name: 'Group' }));
  await user.click(screen.getByRole('option', { name }));
}

describe('InviteMemberForm — groups', () => {
  it('offers no group picker without groups', () => {
    render(
      <InviteMemberForm onInvite={vi.fn()} isInviting={false} groups={[]} onInviteGroup={vi.fn()} />
    );
    expect(screen.queryByRole('radiogroup', { name: 'Invite' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Search by username' })).toBeInTheDocument();
  });

  it('invites the picked group with the picked role', async () => {
    const user = userEvent.setup();
    const onInviteGroup = vi
      .fn()
      .mockResolvedValue({ invited: [], skipped: [], notInvited: 0 } satisfies GroupInviteResult);
    render(
      <InviteMemberForm
        onInvite={vi.fn()}
        isInviting={false}
        groups={groups}
        onInviteGroup={onInviteGroup}
      />
    );
    await user.click(screen.getByRole('radio', { name: 'Group' }));
    expect(screen.queryByRole('combobox', { name: 'Search by username' })).toBeNull();
    // Nothing picked yet: nothing to send.
    expect(screen.getByRole('button', { name: 'Invite group' })).toBeDisabled();

    await user.click(screen.getByRole('combobox', { name: 'Group' }));
    await user.click(screen.getByRole('option', { name: 'Family · 3 people' }));
    await user.click(screen.getByRole('radio', { name: 'Co-owner' }));
    await user.click(screen.getByRole('button', { name: 'Invite group' }));

    expect(onInviteGroup).toHaveBeenCalledWith({ groupId: 'g1', role: 'owner' });
  });

  it('shows who was invited, who was skipped and why, and how many the limit left out', async () => {
    const user = userEvent.setup();
    const result: GroupInviteResult = {
      invited: [
        { id: 'bo', username: 'bo', displayName: 'bo' },
        { id: 'sam', username: 'sam', displayName: 'sam' },
      ],
      skipped: [
        { id: 'cy', username: 'cy', displayName: 'cy', reason: 'This person is already a member' },
      ],
      notInvited: 2,
    };
    render(
      <InviteMemberForm
        onInvite={vi.fn()}
        isInviting={false}
        groups={groups}
        onInviteGroup={vi.fn().mockResolvedValue(result)}
      />
    );
    await pickGroup(user, /Family/);
    await user.click(screen.getByRole('button', { name: 'Invite group' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Invited 2 people.');
    expect(status).toHaveTextContent('@bo, @sam');
    expect(status).toHaveTextContent('Not invited (1)');
    expect(status).toHaveTextContent('@cy: This person is already a member');
    expect(status).toHaveTextContent('2 more people weren’t invited');

    // Back to one person: the result goes with the group mode.
    await user.click(screen.getByRole('radio', { name: 'Person' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says a failed read of the groups failed, with Try again, never as no groups', async () => {
    const user = userEvent.setup();
    const onRetryGroups = vi.fn();
    render(
      <InviteMemberForm
        onInvite={vi.fn()}
        isInviting={false}
        groups={null}
        groupsFailed
        onRetryGroups={onRetryGroups}
        onInviteGroup={vi.fn()}
      />
    );
    await user.click(screen.getByRole('radio', { name: 'Group' }));
    expect(screen.getByText('Couldn’t load your groups')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite group' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetryGroups).toHaveBeenCalledOnce();
  });

  it('shows nothing new when the whole request was refused', async () => {
    const user = userEvent.setup();
    const onInviteGroup = vi.fn().mockResolvedValue(null);
    render(
      <InviteMemberForm
        onInvite={vi.fn()}
        isInviting={false}
        groups={groups}
        onInviteGroup={onInviteGroup}
      />
    );
    await pickGroup(user, /Parents/);
    await user.click(screen.getByRole('button', { name: 'Invite group' }));
    await waitFor(() => expect(onInviteGroup).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });
});
