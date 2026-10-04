// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const showToast = vi.fn();
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import DeleteAccount from '@/components/DeleteAccount';

const fetchMock = vi.fn();
const onDeleted = vi.fn();

function answer(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function preview(lists: Array<{ _id: string; name: string }>) {
  return answer(200, { success: true, data: { soleOwnedLists: lists } });
}

beforeEach(() => {
  fetchMock.mockReset();
  onDeleted.mockReset();
  showToast.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function openDialog(username = 'ann') {
  const user = userEvent.setup();
  render(<DeleteAccount username={username} email="ann@x.com" onDeleted={onDeleted} />);
  await user.click(screen.getByRole('button', { name: 'Delete account…' }));
  return user;
}

describe('DeleteAccount', () => {
  it('names the lists owned alone, and holds Delete until the username is typed', async () => {
    fetchMock.mockReturnValueOnce(
      preview([
        { _id: '1', name: 'Birthday' },
        { _id: '2', name: 'Wedding' },
      ])
    );
    const user = await openDialog();

    const dialog = await screen.findByRole('alertdialog', { name: 'Delete your account?' });
    expect(dialog).toBeTruthy();
    const listed = await screen.findByRole('list', { name: 'Lists deleted with your account' });
    expect(listed.textContent).toContain('Birthday');
    expect(listed.textContent).toContain('Wedding');

    const confirm = screen.getByRole('button', { name: 'Delete account' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Type ann to confirm' }), 'an');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Type ann to confirm' }), 'n');
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends what was typed, and signs out once the account is deleted', async () => {
    fetchMock.mockReturnValueOnce(preview([]));
    const user = await openDialog();
    expect(await screen.findByText(/You don't own any lists alone/)).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Type ann to confirm' }), '@ann');

    fetchMock.mockReturnValueOnce(answer(200, { success: true, data: {} }));
    await user.click(screen.getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/users/me');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ confirm: '@ann' });
  });

  it('says so and stays signed in when the deletion fails', async () => {
    fetchMock.mockReturnValueOnce(preview([]));
    const user = await openDialog();
    await screen.findByText(/You don't own any lists alone/);
    await user.type(screen.getByRole('textbox', { name: 'Type ann to confirm' }), 'ann');
    fetchMock.mockReturnValueOnce(
      answer(500, { success: false, error: 'Failed to delete account' })
    );
    await user.click(screen.getByRole('button', { name: 'Delete account' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Failed to delete account', 'error')
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('never reads a failed check of the lists as none, and keeps Delete held', async () => {
    fetchMock.mockReturnValueOnce(answer(500, { success: false }));
    const user = await openDialog();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/You don't own any lists alone/)).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Type ann to confirm' }), 'ann');
    expect(
      (screen.getByRole('button', { name: 'Delete account' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('asks for the email from an account with no username', async () => {
    fetchMock.mockReturnValueOnce(preview([]));
    const user = await openDialog('');
    await screen.findByText(/You don't own any lists alone/);
    const field = screen.getByRole('textbox', { name: 'Type your email to confirm' });
    await user.type(field, 'ANN@x.com');
    expect(
      (screen.getByRole('button', { name: 'Delete account' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('Cancel closes it without deleting anything', async () => {
    fetchMock.mockReturnValueOnce(preview([]));
    const user = await openDialog();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
