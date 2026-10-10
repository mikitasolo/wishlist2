// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ToastProvider, useToast } from '@/components/ToastProvider';

function Trigger() {
  const { showToast } = useToast();
  return <button onClick={() => showToast('Saved successfully', 'success')}>fire</button>;
}

beforeEach(() => cleanup());

describe('ToastProvider', () => {
  it('shows a toast on demand and dismisses it', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('fire'));
    expect(screen.getByText('Saved successfully')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));
    expect(screen.queryByText('Saved successfully')).toBeNull();
  });

  // Regression: toast content was top-aligned; it should be vertically centered.
  it('regression: toast row is vertically centered', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('fire'));
    const toast = screen.getByRole('status');
    expect(toast.className).toContain('items-center');
    expect(toast.className).not.toContain('items-start');
  });
});

describe('ToastProvider stack', () => {
  function Many() {
    const { showToast } = useToast();
    return (
      <>
        {['a', 'b', 'c', 'd'].map((m) => (
          <button key={m} onClick={() => showToast(`msg ${m}`, 'info')}>
            {m}
          </button>
        ))}
        <button onClick={() => showToast('Saved twice', 'success')}>same</button>
        <button
          onClick={() =>
            showToast('with action', 'info', { action: { label: 'View', href: '/x' } })
          }
        >
          act
        </button>
      </>
    );
  }
  const setup = () =>
    render(
      <ToastProvider>
        <Many />
      </ToastProvider>
    );
  const tick = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps at most 3 toasts, dropping the oldest', () => {
    setup();
    for (const m of ['a', 'b', 'c', 'd']) fireEvent.click(screen.getByText(m));
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(screen.queryByText('msg a')).toBeNull();
    expect(screen.getByText('msg d')).toBeInTheDocument();
  });

  it('merges identical toasts into one with a count and restarts the timer', () => {
    setup();
    fireEvent.click(screen.getByText('same'));
    tick(3000);
    fireEvent.click(screen.getByText('same'));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText('×2')).toBeInTheDocument();
    tick(3000);
    expect(screen.getByRole('status')).toBeInTheDocument();
    tick(1100);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('times out after 4s, or 8s with an action', () => {
    setup();
    fireEvent.click(screen.getByText('a'));
    fireEvent.click(screen.getByText('act'));
    tick(3900);
    expect(screen.getAllByRole('status')).toHaveLength(2);
    tick(200);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    tick(4000);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pauses every timer while hovered and resumes with the time left', () => {
    setup();
    fireEvent.click(screen.getByText('a'));
    tick(3000);
    const region = screen.getByRole('status').closest('.toast-region')!;
    fireEvent.pointerEnter(region, { pointerType: 'mouse' });
    expect(region).toHaveAttribute('data-expanded', 'true');
    tick(60000);
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.pointerLeave(region, { pointerType: 'mouse' });
    tick(900);
    expect(screen.getByRole('status')).toBeInTheDocument();
    tick(200);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('pauses while focus is inside the stack', () => {
    setup();
    fireEvent.click(screen.getByText('act'));
    const region = screen.getByRole('status').closest('.toast-region')!;
    fireEvent.focus(screen.getByRole('button', { name: /dismiss notification/i }));
    expect(region).toHaveAttribute('data-expanded', 'true');
    tick(60000);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('dismisses on a sideways swipe, not on a short drag', () => {
    setup();
    fireEvent.click(screen.getByText('a'));
    const card = screen.getByRole('status');
    const touch = { pointerType: 'touch', clientY: 0 };
    fireEvent.pointerDown(card, { ...touch, clientX: 0 });
    fireEvent.pointerMove(card, { ...touch, clientX: 30 });
    fireEvent.pointerUp(card, { ...touch, clientX: 30 });
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.pointerDown(card, { ...touch, clientX: 0 });
    fireEvent.pointerMove(card, { ...touch, clientX: 120 });
    fireEvent.pointerUp(card, { ...touch, clientX: 120 });
    expect(screen.queryByRole('status')).toBeNull();
  });

  // regression: the toast holding hover/focus is removed with no mouseleave/blur, which left the rest frozen.
  it('regression: dismissing a toast un-pauses the rest of the stack', () => {
    setup();
    fireEvent.click(screen.getByText('a'));
    fireEvent.click(screen.getByText('b'));
    const region = screen.getAllByRole('status')[0].closest('.toast-region')!;
    fireEvent.pointerEnter(region, { pointerType: 'mouse' });
    fireEvent.click(screen.getAllByRole('button', { name: /dismiss notification/i })[0]);
    expect(region).toHaveAttribute('data-expanded', 'false');
    tick(4100);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not merge toasts whose button actions run different callbacks', () => {
    function Undo() {
      const { showToast } = useToast();
      return (
        <button
          onClick={() =>
            showToast('Removed', 'info', { action: { label: 'Undo', onClick: () => {} } })
          }
        >
          undo
        </button>
      );
    }
    render(
      <ToastProvider>
        <Undo />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('undo'));
    fireEvent.click(screen.getByText('undo'));
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });
});
