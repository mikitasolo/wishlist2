// @vitest-environment jsdom
// WIS-387: the Undo toast and its deferred commit, with the real ToastProvider.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '@/components/ToastProvider';
import { flushUndoableActions, useUndoableAction } from '@/lib/hooks/useUndoableAction';
import { UNDO_WINDOW_MS, type PendingCommit } from '@/lib/utils/deferredCommit';

const hooks = {} as {
  offer: ReturnType<typeof useUndoableAction>;
  show: ReturnType<typeof useToast>['showToast'];
};

function Harness() {
  const offer = useUndoableAction();
  const { showToast } = useToast();
  useEffect(() => {
    hooks.offer = offer;
    hooks.show = showToast;
  }, [offer, showToast]);
  return null;
}

function setup() {
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>
  );
}

function defer(message = 'Item deleted') {
  const commit = vi.fn();
  const onUndo = vi.fn();
  let pending!: PendingCommit;
  act(() => {
    pending = hooks.offer({ message, commit, onUndo });
  });
  return { commit, onUndo, pending };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  flushUndoableActions();
  cleanup();
  vi.useRealTimers();
});

describe('useUndoableAction', () => {
  it('shows the line with Undo, and commits once the window has passed, taking the toast down', () => {
    setup();
    const { commit } = defer();
    expect(screen.getByRole('status')).toHaveTextContent('Item deleted');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS - 1));
    expect(commit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(commit).toHaveBeenCalledExactlyOnceWith({ keepalive: false });
    expect(screen.queryByText('Item deleted')).toBeNull();
  });

  it('never commits once Undo is pressed, and puts things back', () => {
    setup();
    const { commit, onUndo } = defer();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Item deleted')).toBeNull();

    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS * 2));
    flushUndoableActions(true);
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits at once when the toast is dismissed', () => {
    setup();
    const { commit } = defer();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(commit).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commits when other toasts push it off a full stack', () => {
    setup();
    const { commit } = defer();
    act(() => {
      hooks.show('One');
      hooks.show('Two');
      hooks.show('Three');
    });
    expect(screen.queryByText('Item deleted')).toBeNull();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('keeps two Undo toasts with the same line apart', () => {
    setup();
    const first = defer();
    const second = defer();
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]);
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS));
    expect(first.commit).not.toHaveBeenCalled();
    expect(first.onUndo).toHaveBeenCalledTimes(1);
    expect(second.commit).toHaveBeenCalledTimes(1);
  });

  it('takes the toast down when undone some other way', () => {
    setup();
    const { commit, pending } = defer('Released');
    act(() => {
      expect(pending.undo()).toBe(true);
    });
    expect(screen.queryByText('Released')).toBeNull();
    act(() => vi.advanceTimersByTime(UNDO_WINDOW_MS));
    expect(commit).not.toHaveBeenCalled();
  });

  it('sends everything waiting, with keepalive, when the page goes away', () => {
    setup();
    const a = defer('Item deleted');
    const b = defer('Released');
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(a.commit).toHaveBeenCalledExactlyOnceWith({ keepalive: true });
    expect(b.commit).toHaveBeenCalledExactlyOnceWith({ keepalive: true });
  });

  it('sends everything waiting when the tab is hidden', () => {
    setup();
    const { commit } = defer();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    visibility.mockRestore();
    expect(commit).toHaveBeenCalledExactlyOnceWith({ keepalive: true });
  });
});
