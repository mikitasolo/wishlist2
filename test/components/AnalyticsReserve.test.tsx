// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/ToastProvider';
import { useReserveToast } from '@/lib/hooks/useReserveToast';
import { track } from '@/lib/analytics';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
const tracked = vi.mocked(track);

function Card({
  update,
  isOwner = false,
}: {
  update: () => Promise<object | null>;
  isOwner?: boolean;
}) {
  const send = useReserveToast(update, { isOwner, ownerUsernames: ['ben'] });
  return (
    <>
      <button onClick={() => send('i1', { status: 'booked' })}>reserve</button>
      <button onClick={() => send('i1', { status: 'available' })}>release</button>
      <button onClick={() => send('i1', { status: 'completed' })}>received</button>
    </>
  );
}

function renderCard(update: () => Promise<object | null>, isOwner = false) {
  render(
    <ToastProvider>
      <Card update={update} isOwner={isOwner} />
    </ToastProvider>
  );
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  tracked.mockReset();
});

// WIS-329: reservation events are counted once the server took the change, and
// never from an owner's view of a list.
describe('analytics on a list’s reserve and release', () => {
  it('counts a member’s reserve once it has succeeded', async () => {
    const update = vi.fn(async () => ({}));
    renderCard(update);
    fireEvent.click(screen.getByText('reserve'));
    await waitFor(() => expect(tracked).toHaveBeenCalledTimes(1));
    expect(tracked).toHaveBeenCalledWith('reserve');
  });

  it('counts a member’s release from the list once it has succeeded', async () => {
    renderCard(async () => ({}));
    fireEvent.click(screen.getByText('release'));
    await waitFor(() => expect(tracked).toHaveBeenCalledTimes(1));
    expect(tracked).toHaveBeenCalledWith('release', { from: 'list' });
  });

  it('counts nothing for a failed or rolled-back update (it resolves null)', async () => {
    const update = vi.fn(async () => null);
    renderCard(update);
    fireEvent.click(screen.getByText('reserve'));
    fireEvent.click(screen.getByText('release'));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(tracked).not.toHaveBeenCalled();
  });

  it('counts nothing an owner does, a reopen (available) included', async () => {
    const update = vi.fn(async () => ({}));
    renderCard(update, true);
    fireEvent.click(screen.getByText('reserve'));
    fireEvent.click(screen.getByText('release'));
    fireEvent.click(screen.getByText('received'));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(3));
    await Promise.resolve();
    expect(tracked).not.toHaveBeenCalled();
  });

  it('counts no other status change as a reservation event', async () => {
    const update = vi.fn(async () => ({}));
    renderCard(update);
    fireEvent.click(screen.getByText('received'));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(tracked).not.toHaveBeenCalled();
  });
});
