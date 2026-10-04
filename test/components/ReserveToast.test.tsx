// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '@/components/ToastProvider';
import { useReserveToast } from '@/lib/hooks/useReserveToast';
import { RESERVE_TOAST_SEEN_KEY } from '@/lib/utils/reserveToast';

function ActionTrigger({ onClick }: { onClick: () => void }) {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast('Marked', 'success', { action: { label: 'Undo', onClick } })}>
      fire
    </button>
  );
}

function LinkTrigger() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast('Hi', 'info', { action: { label: 'View', href: '/booked' } })}>
      fire
    </button>
  );
}

function Reserve({
  update,
  isOwner = false,
  owners = ['ben_carter'],
}: {
  update: () => Promise<object | null>;
  isOwner?: boolean;
  owners?: string[];
}) {
  const reserve = useReserveToast(update, { isOwner, ownerUsernames: owners });
  return <button onClick={() => reserve('i1', { status: 'booked' })}>reserve</button>;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe('toast action', () => {
  it('runs a button action by mouse and by keyboard, then dismisses', async () => {
    const onClick = vi.fn();
    render(
      <ToastProvider>
        <ActionTrigger onClick={onClick} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('fire'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Marked')).toBeNull();

    fireEvent.click(screen.getByText('fire'));
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Undo' }).focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('renders a link action inside the status', () => {
    render(
      <ToastProvider>
        <LinkTrigger />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('fire'));
    const link = screen.getByRole('link', { name: 'View' });
    expect(link).toHaveAttribute('href', '/booked');
    expect(screen.getByRole('status')).toContainElement(link);
  });
});

describe('reserve toast', () => {
  it('shows the long copy once, then the short copy', async () => {
    render(
      <ToastProvider>
        <Reserve update={async () => ({})} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('reserve'));
    expect(
      await screen.findByText(
        "Reserved. @ben_carter won't see it; others on the list see it's taken."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/booked');
    expect(localStorage.getItem(RESERVE_TOAST_SEEN_KEY)).not.toBeNull();

    cleanup();
    render(
      <ToastProvider>
        <Reserve update={async () => ({})} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('reserve'));
    expect(await screen.findByText("Reserved — it's in Reserved by you")).toBeInTheDocument();
  });

  it('says "the owners" with several owners', async () => {
    render(
      <ToastProvider>
        <Reserve update={async () => ({})} owners={[]} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('reserve'));
    expect(await screen.findByText(/^Reserved\. the owners won't see it/)).toBeInTheDocument();
  });

  // regression: a failed reserve resolves null after its own error toast, and must not also confirm.
  it('regression: no success toast on a failed reserve', async () => {
    render(
      <ToastProvider>
        <Reserve update={async () => null} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('reserve'));
    await Promise.resolve();
    expect(screen.queryByRole('status')).toBeNull();
    expect(localStorage.getItem(RESERVE_TOAST_SEEN_KEY)).toBeNull();
  });

  it('gives an owner nothing', async () => {
    render(
      <ToastProvider>
        <Reserve update={async () => ({})} isOwner />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('reserve'));
    await Promise.resolve();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
