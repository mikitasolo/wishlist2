import { vi } from 'vitest';

/**
 * Coming back to the tab after being away (hidden, then shown in a focused
 * window), which a live screen answers with a background read (WIS-376,
 * `useRefreshOnReturn`; a polled screen reads on a return only after being
 * away). jsdom has no window focus, so it's faked for the two events. Wrap the
 * call in `act`.
 */
export function returnToTab(): void {
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  try {
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  } finally {
    visibility.mockRestore();
    focus.mockRestore();
  }
}

/**
 * The browser going offline and back online in a focused window: a return
 * read like `returnToTab`'s, without hiding the tab (which sends deferred
 * commits waiting in an Undo window). Wrap the call in `act`.
 */
export function reconnect(): void {
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  try {
    window.dispatchEvent(new Event('offline'));
    window.dispatchEvent(new Event('online'));
  } finally {
    focus.mockRestore();
  }
}
