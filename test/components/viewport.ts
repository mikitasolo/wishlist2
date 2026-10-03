import { vi } from 'vitest';
import { SM_UP_QUERY } from '@/lib/hooks/useMediaQuery';

/**
 * Puts the page at a viewport width: jsdom has no `matchMedia`, so this gives
 * it one that answers the `sm` query (40rem = 640px) for that width. Without
 * it, the width is unknown, as in a server render, and a component that shows
 * one thing on a phone and another from `sm` up renders both. `resize` moves
 * it. Undo it with `vi.unstubAllGlobals()`.
 */
export function atWidth(width: number) {
  let current = width;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === SM_UP_QUERY && current >= 640;
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return {
    resize(next: number) {
      current = next;
      listeners.forEach((fn) => fn());
    },
  };
}
