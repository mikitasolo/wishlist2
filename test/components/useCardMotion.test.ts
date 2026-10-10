// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useStaggeredEntrance } from '@/lib/hooks/useCardMotion';
import { STAGGER_TOTAL_MS } from '@/lib/utils/motion';

afterEach(() => vi.useRealTimers());

// WIS-407: the list's cards come in one after another once, as the grid first
// shows; a card a poll or a filter brings in later just appears.
describe('useStaggeredEntrance', () => {
  it('staggers as the grid first shows, then stops for good', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ ready, shown }) => useStaggeredEntrance(ready, shown),
      { initialProps: { ready: false, shown: false } }
    );
    expect(result.current).toBe(false);

    rerender({ ready: true, shown: true });
    expect(result.current).toBe(true);

    act(() => vi.advanceTimersByTime(STAGGER_TOTAL_MS));
    expect(result.current).toBe(false);

    // Hidden by a filter and shown again: no second entrance.
    rerender({ ready: true, shown: false });
    rerender({ ready: true, shown: true });
    expect(result.current).toBe(false);
  });

  it('never staggers a grid that was not showing when the items loaded', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ ready, shown }) => useStaggeredEntrance(ready, shown),
      { initialProps: { ready: true, shown: false } }
    );
    // An empty list (or a filter hiding every card) that a poll then fills.
    rerender({ ready: true, shown: true });
    expect(result.current).toBe(false);
  });
});
