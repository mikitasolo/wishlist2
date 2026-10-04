// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ToastProvider } from '@/components/ToastProvider';
import { useReceivedToast } from '@/lib/hooks/useReceivedToast';

function Mark({
  update,
}: {
  update: (id: string, u: { status?: string }) => Promise<object | null>;
}) {
  const run = useReceivedToast(update);
  return (
    <>
      <button onClick={() => run('i1', { status: 'completed' })}>receive</button>
      <button onClick={() => run('i1', { status: 'draft' })}>draft</button>
    </>
  );
}

beforeEach(cleanup);

describe('received toast', () => {
  it('says it was marked as received, and Undo sends the reopen', async () => {
    const update = vi.fn().mockResolvedValue({});
    render(
      <ToastProvider>
        <Mark update={update} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('receive'));
    expect(await screen.findByText('Marked as received')).toBeInTheDocument();
    expect(update).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(update).toHaveBeenLastCalledWith('i1', { status: 'available' });
    // Nothing about whether it was reserved.
    expect(screen.queryByText(/reserv/i)).toBeNull();
  });

  it('says nothing when the update failed or was another status', async () => {
    const update = vi.fn().mockResolvedValue(null);
    render(
      <ToastProvider>
        <Mark update={update} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('receive'));
    await Promise.resolve();
    update.mockResolvedValue({});
    fireEvent.click(screen.getByText('draft'));
    await Promise.resolve();
    expect(screen.queryByText('Marked as received')).toBeNull();
  });
});
