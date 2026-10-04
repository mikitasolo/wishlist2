// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCallback, useMemo, useState } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { useItemDeepLink } from '@/lib/hooks/useItemDeepLink';
import { itemAnchorId, itemDeepLink } from '@/lib/utils/itemDeepLink';

/**
 * A list page reduced to what `?item=` needs: its items, a chip that hides the
 * received ones, and the grid of what's shown, each card marked when it's the
 * highlighted one.
 */
function ListPage({
  items,
  ready = true,
  startOn = 'all',
}: {
  items: { id: string; received?: boolean }[];
  ready?: boolean;
  startOn?: 'all' | 'live';
}) {
  const [chip, setChip] = useState(startOn);
  const shown = useMemo(() => items.filter((i) => chip === 'all' || !i.received), [items, chip]);
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);
  const isShown = useCallback((id: string) => shown.some((i) => i.id === id), [shown]);
  const reveal = useCallback(() => setChip('all'), []);
  const highlighted = useItemDeepLink({ listKey: 'birthday', ready, itemIds, isShown, reveal });
  return (
    <div>
      <p data-testid="chip">{chip}</p>
      {shown.map((i) => (
        <div
          key={i.id}
          id={itemAnchorId(i.id)}
          data-testid={i.id}
          data-highlighted={i.id === highlighted || undefined}
        />
      ))}
    </div>
  );
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  cleanup();
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
});

function at(url: string) {
  window.history.replaceState(null, '', url);
}

describe('?item= on a list (WIS-263)', () => {
  it('builds the link View on list sends', () => {
    expect(itemDeepLink('birthday', 'abc')).toBe('/wishlists/birthday?item=abc');
  });

  it('scrolls to the item and highlights it', () => {
    at('/wishlists/birthday?item=b');
    render(<ListPage items={[{ id: 'a' }, { id: 'b' }]} />);
    expect(screen.getByTestId('b')).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('a')).not.toHaveAttribute('data-highlighted');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByTestId('b'));
  });

  it('shows and highlights an item the current chip hides', () => {
    at('/wishlists/birthday?item=b');
    render(<ListPage items={[{ id: 'a' }, { id: 'b', received: true }]} startOn="live" />);
    expect(screen.getByTestId('chip')).toHaveTextContent('all');
    expect(screen.getByTestId('b')).toHaveAttribute('data-highlighted', 'true');
  });

  it('waits for the items to be read', () => {
    at('/wishlists/birthday?item=b');
    const { rerender } = render(<ListPage items={[]} ready={false} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(<ListPage items={[{ id: 'a' }, { id: 'b' }]} />);
    expect(screen.getByTestId('b')).toHaveAttribute('data-highlighted', 'true');
  });

  it('does nothing for an item the viewer wasn’t given, leaving the chip alone', () => {
    at('/wishlists/birthday?item=hidden');
    render(<ListPage items={[{ id: 'a' }, { id: 'b', received: true }]} startOn="live" />);
    expect(screen.getByTestId('chip')).toHaveTextContent('live');
    expect(document.querySelector('[data-highlighted]')).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('acts once: a later read leaves the viewer where they are, and the highlight goes at their first click', () => {
    at('/wishlists/birthday?item=b');
    const { rerender } = render(<ListPage items={[{ id: 'a' }, { id: 'b' }]} />);
    rerender(<ListPage items={[{ id: 'a' }, { id: 'b' }, { id: 'c' }]} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    act(() => {
      fireEvent.pointerDown(window);
    });
    expect(document.querySelector('[data-highlighted]')).toBeNull();
  });
});
